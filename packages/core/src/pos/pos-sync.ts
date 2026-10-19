import type { PosStatus, Prisma } from '@adapterpay/database';
import { validateBrCode } from '@adapterpay/shared';
import { writeAudit } from '../audit';
import type { CoreDeps } from '../context';
import { sha256Hex } from '../crypto';
import { getPosV2, isValidExternalPosId, MpApiError, type MpPosV2 } from '../mercado-pago';
import { createNotification } from '../notifications';

export interface PosSyncResult {
  status: PosStatus;
  divergences: string[];
}

/** Campos do POS remoto mapeados para o registro local (GET /v2/pos/{id} — contrato comprovado). */
export function mapRemotePos(remote: MpPosV2): {
  externalId: string | null;
  operatingMode: string | null;
  qrCode: string | null;
  qrUuid: string | null;
  qrImageUrl: string | null;
  qrTemplateDocument: string | null;
  qrTemplateImage: string | null;
  remoteStatus: string | null;
  mpStoreId: string | null;
  name: string | null;
} {
  return {
    externalId: remote.external_id ?? null,
    operatingMode: remote.config?.qr?.operating_mode ?? null,
    qrCode: remote.qr_response?.qr_code ?? null,
    qrUuid: remote.qr_response?.uuid ?? null,
    qrImageUrl: remote.qr_response?.image ?? null,
    qrTemplateDocument: remote.qr_response?.template_document ?? null,
    qrTemplateImage: remote.qr_response?.template_image ?? null,
    remoteStatus: remote.status ?? null,
    mpStoreId: remote.store_id !== undefined && remote.store_id !== null ? String(remote.store_id) : null,
    name: remote.name ?? null,
  };
}

/**
 * Sincroniza um POS local com o Mercado Pago, registra divergências e mudanças de BR Code
 * (proteção contra QR adulterado) e ajusta o status operacional. Nunca altera o vínculo de um
 * POS com cobrança ativa.
 */
export async function syncPos(
  deps: CoreDeps,
  posId: string,
  actor: { userId?: string | null; correlationId?: string | null } = {},
): Promise<PosSyncResult> {
  const pos = await deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: posId }, include: { mpConnection: true } });
  const divergences: string[] = [];
  const { accessToken, mpUserId } = await deps.tokens.getAccessToken(pos.mpConnectionId);

  let remote: MpPosV2;
  try {
    remote = await deps.guard.run(pos.mpConnectionId, () => getPosV2(deps.mpApi, accessToken, pos.mpPosId));
  } catch (err) {
    if (err instanceof MpApiError && err.notFound) {
      const status: PosStatus = pos.activeChargeId ? pos.status : 'REMOTE_MISSING';
      await deps.prisma.posTerminal.update({
        where: { id: posId },
        data: { status, syncError: 'POS removido ou inacessível no Mercado Pago', lastSyncAt: new Date() },
      });
      await createNotification(deps.prisma, deps.events, {
        tenantId: pos.tenantId,
        kind: 'pos.remote_missing',
        title: 'POS não encontrado no Mercado Pago',
        body: `O POS "${pos.name}" não foi encontrado na conta Mercado Pago vinculada.`,
        link: '/app/pos',
      });
      return { status, divergences: ['REMOTE_MISSING'] };
    }
    await deps.prisma.posTerminal.update({
      where: { id: posId },
      data: { syncError: (err as Error).message.slice(0, 300) },
    });
    throw err;
  }

  const mapped = mapRemotePos(remote);
  if (remote.user_id !== undefined && String(remote.user_id) !== mpUserId) divergences.push('OWNER_ACCOUNT_MISMATCH');
  if (String(remote.id) !== pos.mpPosId) divergences.push('POS_ID_MISMATCH');

  const data: Prisma.PosTerminalUpdateInput = {
    operatingMode: mapped.operatingMode,
    qrUuid: mapped.qrUuid,
    qrImageUrl: mapped.qrImageUrl,
    qrTemplateDocument: mapped.qrTemplateDocument,
    qrTemplateImage: mapped.qrTemplateImage,
    remoteStatus: mapped.remoteStatus,
    mpStoreId: mapped.mpStoreId,
    lastSyncAt: new Date(),
    syncError: null,
  };

  // external_id: nunca alterar com cobrança ativa (o payload da Order depende dele).
  if (mapped.externalId !== pos.externalId) {
    if (pos.activeChargeId) divergences.push('EXTERNAL_ID_CHANGED_WITH_ACTIVE_CHARGE');
    else data.externalId = mapped.externalId;
  }

  // BR Code: validar integridade e registrar mudanças.
  if (mapped.qrCode) {
    const check = validateBrCode(mapped.qrCode);
    if (!check.valid) {
      divergences.push(`INVALID_BRCODE:${check.reasons.join('|')}`);
    } else {
      const hash = sha256Hex(mapped.qrCode);
      if (hash !== pos.qrCodeHash) {
        if (pos.activeChargeId) {
          divergences.push('BRCODE_CHANGED_WITH_ACTIVE_CHARGE');
        } else {
          data.qrCode = mapped.qrCode;
          data.qrCodeHash = hash;
          data.qrUpdatedAt = new Date();
          if (pos.qrCodeHash) {
            await writeAudit(deps.prisma, {
              tenantId: pos.tenantId,
              actorUserId: actor.userId ?? null,
              actorType: actor.userId ? 'USER' : 'WORKER',
              resourceType: 'pos',
              resourceId: pos.id,
              action: 'pos.brcode_changed',
              before: { qrCodeHash: pos.qrCodeHash },
              after: { qrCodeHash: hash },
              correlationId: actor.correlationId ?? null,
            });
          }
        }
      }
    }
  } else {
    divergences.push('BRCODE_MISSING');
  }

  const effectiveExternalId = (data.externalId as string | null | undefined) ?? pos.externalId;
  let status: PosStatus = pos.status;
  if (!isValidExternalPosId(effectiveExternalId)) {
    if (!pos.activeChargeId) status = 'NEEDS_REGULARIZATION';
    divergences.push('EXTERNAL_ID_INVALID_FOR_ORDERS');
  } else if (pos.status === 'REMOTE_MISSING' || pos.status === 'NEEDS_REGULARIZATION') {
    // Volta para revisão; ativação respeita limites do plano (feita pelo admin).
    status = 'PENDING_REVIEW';
  }
  data.status = status;
  if (divergences.length > 0) data.syncError = divergences.join(', ').slice(0, 500);

  await deps.prisma.posTerminal.update({ where: { id: posId }, data });
  await deps.events.publish({ type: 'pos.updated', tenantId: pos.tenantId, posId }).catch(() => undefined);
  return { status, divergences };
}

/** POS pronto para receber Orders: ativo, external_id válido e BR Code válido. */
export function isPosOrderReady(pos: {
  status: string;
  externalId: string | null;
  qrCode: string | null;
}): { ready: boolean; reason?: string } {
  if (pos.status !== 'ACTIVE') return { ready: false, reason: 'POS_INACTIVE' };
  if (!isValidExternalPosId(pos.externalId)) return { ready: false, reason: 'EXTERNAL_ID_INVALID' };
  if (!pos.qrCode || !validateBrCode(pos.qrCode).valid) return { ready: false, reason: 'BRCODE_INVALID' };
  return { ready: true };
}
