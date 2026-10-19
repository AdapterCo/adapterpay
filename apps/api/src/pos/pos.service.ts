import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import {
  assertCanActivate,
  assertTenantOperational,
  collectAllPages,
  createPos as createRemotePos,
  getPosV2,
  isPosOrderReady,
  isValidExternalPosId,
  mapRemotePos,
  PlanLimitError,
  randomSlug,
  randomToken,
  searchPos,
  sha256Hex,
  syncPos,
  updatePos as updateRemotePos,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import { isUniqueViolation, type PosStatus, type PosTerminal } from '@adapterpay/database';
import { roleHasPermission, validateBrCode, type createPosSchema, type importPosConfirmSchema, type updatePosSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { assertStoreAccess, storeScope } from '../common/access';
import { Errors } from '../common/errors';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';

type CreateInput = z.infer<typeof createPosSchema>;
type UpdateInput = z.infer<typeof updatePosSchema>;
type ImportInput = z.infer<typeof importPosConfirmSchema>;

function newExternalPosId(): string {
  return `AP${randomToken(16).replace(/[^A-Za-z0-9]/g, '').slice(0, 14).toUpperCase()}`;
}

@Injectable()
export class PosService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  publicUrl(slug: string): string {
    return new URL(`/p/${slug}`, this.deps.config.APP_URL).toString();
  }

  private view(pos: PosTerminal & { store?: { name: string } | null }, auth: AuthContext) {
    const ready = isPosOrderReady(pos);
    return {
      id: pos.id,
      name: pos.name,
      storeId: pos.storeId,
      storeName: pos.store?.name ?? null,
      mpConnectionId: pos.mpConnectionId,
      mpPosId: pos.mpPosId,
      externalId: pos.externalId,
      operatingMode: pos.operatingMode,
      status: pos.status,
      remoteStatus: pos.remoteStatus,
      orderReady: ready.ready,
      notReadyReason: ready.reason ?? null,
      hasBrCode: !!pos.qrCode,
      publicSlug: pos.publicSlug,
      publicUrl: this.publicUrl(pos.publicSlug),
      activeChargeId: pos.activeChargeId,
      createdRemotely: pos.createdRemotely,
      lastSyncAt: pos.lastSyncAt,
      syncError: pos.syncError,
      qrUpdatedAt: pos.qrUpdatedAt,
      canReadBrCode: !!auth.role && roleHasPermission(auth.role, 'pos:read_brcode'),
    };
  }

  async list(auth: AuthContext) {
    const items = await this.deps.prisma.posTerminal.findMany({
      where: { tenantId: auth.tenantId!, ...storeScope(auth) },
      include: { store: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((p) => this.view(p, auth));
  }

  async get(auth: AuthContext, id: string) {
    const pos = await this.deps.prisma.posTerminal.findFirst({
      where: { id, tenantId: auth.tenantId! },
      include: { store: { select: { name: true } } },
    });
    if (!pos) throw Errors.notFound('POS');
    assertStoreAccess(auth, pos.storeId);
    return pos;
  }

  /** Fluxo A, passos 4–6: cria POS no Mercado Pago, sincroniza o QR e ativa conforme plano. */
  async create(auth: AuthContext, input: CreateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const store = await this.deps.prisma.store.findFirst({ where: { id: input.storeId, tenantId } });
    if (!store) throw Errors.notFound('Loja');
    if (store.status !== 'ACTIVE') throw Errors.validation('A loja precisa estar ativa');
    if (!store.mpConnectionId || !store.mpStoreId) {
      throw Errors.validation('Vincule a loja a uma loja do Mercado Pago (crie ou importe) antes de criar POS');
    }
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id: store.mpConnectionId, tenantId, status: 'ACTIVE' } });
    if (!conn) throw Errors.validation('Conexão Mercado Pago da loja não está ativa');

    // Verificação antecipada de assinatura/limite (repetida na gravação, sob lock).
    await this.deps.prisma.$transaction(async (tx) => {
      if (input.activate) await assertCanActivate(tx, tenantId, 'pos');
      else await assertTenantOperational(tx, tenantId);
    });

    const externalId = newExternalPosId();
    const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
    const created = await this.deps.guard.run(conn.id, () =>
      createRemotePos(
        this.deps.mpApi,
        accessToken,
        {
          name: input.name,
          fixed_amount: false,
          store_id: Number(store.mpStoreId),
          external_store_id: store.mpExternalId ?? undefined,
          external_id: externalId,
          category: input.category,
        },
        `pos-${randomToken(12)}`,
      ),
    );
    const mpPosId = String(created.id);
    const remote = await this.deps.guard.run(conn.id, () => getPosV2(this.deps.mpApi, accessToken, mpPosId));
    const mapped = mapRemotePos(remote);
    const brValid = validateBrCode(mapped.qrCode).valid;
    const extOk = isValidExternalPosId(mapped.externalId ?? externalId);

    const pos = await this.deps.prisma.$transaction(async (tx) => {
      let status: PosStatus = 'PENDING_REVIEW';
      if (!extOk) status = 'NEEDS_REGULARIZATION';
      else if (input.activate && brValid) {
        try {
          await assertCanActivate(tx, tenantId, 'pos');
          status = 'ACTIVE';
        } catch (err) {
          if (!(err instanceof PlanLimitError)) throw err;
        }
      }
      const p = await tx.posTerminal.create({
        data: {
          tenantId,
          storeId: store.id,
          mpConnectionId: conn.id,
          mpPosId,
          mpStoreId: mapped.mpStoreId ?? store.mpStoreId,
          externalId: mapped.externalId ?? externalId,
          name: input.name,
          operatingMode: mapped.operatingMode,
          qrCode: brValid ? mapped.qrCode : null,
          qrCodeHash: brValid && mapped.qrCode ? sha256Hex(mapped.qrCode) : null,
          qrUuid: mapped.qrUuid,
          qrImageUrl: mapped.qrImageUrl,
          qrTemplateDocument: mapped.qrTemplateDocument,
          qrTemplateImage: mapped.qrTemplateImage,
          qrUpdatedAt: new Date(),
          remoteStatus: mapped.remoteStatus,
          publicSlug: randomSlug(),
          status,
          createdRemotely: true,
          lastSyncAt: new Date(),
          syncError: brValid ? null : 'BR Code ausente ou inválido no POS remoto',
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'pos',
        resourceId: p.id,
        action: 'pos.created_remote',
        after: { mpPosId, externalId: p.externalId, status },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return p;
    });
    return this.view({ ...pos, store }, auth);
  }

  /** Fluxo B: POS remotos disponíveis na conta, com prevenção de duplicatas. */
  async importPreview(auth: AuthContext, mpConnectionId: string) {
    const tenantId = auth.tenantId!;
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id: mpConnectionId, tenantId, status: 'ACTIVE' } });
    if (!conn) throw Errors.notFound('Conexão Mercado Pago');
    const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
    const remote = await collectAllPages((offset, limit) =>
      this.deps.guard.run(conn.id, () => searchPos(this.deps.mpApi, accessToken, { offset, limit })),
    );
    const [localPos, localStores] = await Promise.all([
      this.deps.prisma.posTerminal.findMany({ where: { mpConnectionId: conn.id }, select: { id: true, mpPosId: true, name: true } }),
      this.deps.prisma.store.findMany({ where: { tenantId, mpConnectionId: conn.id }, select: { id: true, name: true, mpStoreId: true } }),
    ]);
    const imported = new Map(localPos.map((p) => [p.mpPosId, p]));
    const storeByRemote = new Map(localStores.filter((s) => s.mpStoreId).map((s) => [s.mpStoreId!, s]));
    return remote.map((r) => ({
      mpPosId: String(r.id),
      name: r.name ?? `POS ${r.id}`,
      externalId: r.external_id ?? null,
      externalIdValid: isValidExternalPosId(r.external_id),
      mpStoreId: r.store_id !== undefined ? String(r.store_id) : null,
      suggestedStore: r.store_id !== undefined ? (storeByRemote.get(String(r.store_id)) ?? null) : null,
      importedAs: imported.get(String(r.id)) ?? null,
    }));
  }

  async importConfirm(auth: AuthContext, input: ImportInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id: input.mpConnectionId, tenantId, status: 'ACTIVE' } });
    if (!conn) throw Errors.notFound('Conexão Mercado Pago');
    const { accessToken, mpUserId } = await this.deps.tokens.getAccessToken(conn.id);
    const results: Array<{ mpPosId: string; posId?: string; status: string; error?: string }> = [];

    for (const item of input.items) {
      try {
        const store = await this.deps.prisma.store.findFirst({ where: { id: item.storeId, tenantId } });
        if (!store) throw Errors.notFound('Loja');
        if (store.mpConnectionId !== conn.id) throw Errors.validation('A loja interna deve usar a mesma conta Mercado Pago do POS');
        const existing = await this.deps.prisma.posTerminal.findUnique({
          where: { mpConnectionId_mpPosId: { mpConnectionId: conn.id, mpPosId: item.mpPosId } },
        });
        if (existing) {
          results.push({ mpPosId: item.mpPosId, posId: existing.id, status: 'already_imported' });
          continue;
        }
        const remote = await this.deps.guard.run(conn.id, () => getPosV2(this.deps.mpApi, accessToken, item.mpPosId));
        if (remote.user_id !== undefined && String(remote.user_id) !== mpUserId) {
          throw Errors.conflict('POS pertence a outra conta Mercado Pago');
        }
        const mapped = mapRemotePos(remote);
        const brValid = validateBrCode(mapped.qrCode).valid;
        const pos = await this.deps.prisma.$transaction(async (tx) => {
          await assertTenantOperational(tx, tenantId);
          let status: PosStatus = 'PENDING_REVIEW';
          if (!isValidExternalPosId(mapped.externalId)) status = 'NEEDS_REGULARIZATION';
          else if (item.activate && brValid) {
            try {
              await assertCanActivate(tx, tenantId, 'pos');
              status = 'ACTIVE';
            } catch (err) {
              if (!(err instanceof PlanLimitError)) throw err;
            }
          }
          return tx.posTerminal.create({
            data: {
              tenantId,
              storeId: store.id,
              mpConnectionId: conn.id,
              mpPosId: item.mpPosId,
              mpStoreId: mapped.mpStoreId,
              externalId: mapped.externalId,
              name: (mapped.name ?? `POS ${item.mpPosId}`).slice(0, 60),
              operatingMode: mapped.operatingMode,
              qrCode: brValid ? mapped.qrCode : null,
              qrCodeHash: brValid && mapped.qrCode ? sha256Hex(mapped.qrCode) : null,
              qrUuid: mapped.qrUuid,
              qrImageUrl: mapped.qrImageUrl,
              qrTemplateDocument: mapped.qrTemplateDocument,
              qrTemplateImage: mapped.qrTemplateImage,
              qrUpdatedAt: new Date(),
              remoteStatus: mapped.remoteStatus,
              publicSlug: randomSlug(),
              status,
              lastSyncAt: new Date(),
              syncError: brValid ? null : 'BR Code ausente ou inválido no POS remoto',
            },
          });
        });
        results.push({ mpPosId: item.mpPosId, posId: pos.id, status: pos.status });
      } catch (err) {
        const msg = isUniqueViolation(err) ? 'POS já importado ou external_id em uso' : (err as Error).message;
        results.push({ mpPosId: item.mpPosId, status: 'error', error: msg.slice(0, 200) });
      }
    }
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'pos',
      action: 'pos.imported',
      after: { connectionId: conn.id, results },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { results };
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const before = await this.get(auth, id);
    const updated = await this.deps.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pos_terminals WHERE id = ${id}::uuid FOR UPDATE`;
      const pos = await tx.posTerminal.findUniqueOrThrow({ where: { id } });
      const data: Record<string, unknown> = {};
      if (input.storeId && input.storeId !== pos.storeId) {
        if (pos.activeChargeId) throw Errors.conflict('Não é possível mover um POS com cobrança em andamento');
        const store = await tx.store.findFirst({ where: { id: input.storeId, tenantId } });
        if (!store) throw Errors.notFound('Loja');
        if (store.mpConnectionId !== pos.mpConnectionId) throw Errors.validation('A loja de destino usa outra conta Mercado Pago');
        data.storeId = store.id;
      }
      if (input.status === 'ACTIVE' && pos.status !== 'ACTIVE') {
        const ready = isPosOrderReady({ ...pos, status: 'ACTIVE' });
        if (!ready.ready) throw Errors.validation(`POS não pode ser ativado: ${ready.reason}`);
        const conn = await tx.mpConnection.findUniqueOrThrow({ where: { id: pos.mpConnectionId } });
        if (conn.status !== 'ACTIVE') throw Errors.validation('Conexão Mercado Pago do POS não está ativa');
        await assertCanActivate(tx, tenantId, 'pos');
        data.status = 'ACTIVE';
      }
      if (input.status === 'INACTIVE' && pos.status !== 'INACTIVE') {
        if (pos.activeChargeId) throw Errors.conflict('Aguarde o fim da cobrança em andamento');
        data.status = 'INACTIVE';
      }
      if (input.rotatePublicSlug) {
        if (pos.activeChargeId) throw Errors.conflict('Aguarde o fim da cobrança em andamento');
        data.publicSlug = randomSlug();
      }
      if (input.name) data.name = input.name;
      return tx.posTerminal.update({ where: { id }, data, include: { store: { select: { name: true } } } });
    });

    if (input.name && input.name !== before.name) {
      // Edição do nome no MP é best-effort (contrato PUT /pos/{id} a validar).
      try {
        const { accessToken } = await this.deps.tokens.getAccessToken(updated.mpConnectionId);
        await this.deps.guard.run(updated.mpConnectionId, () => updateRemotePos(this.deps.mpApi, accessToken, updated.mpPosId, { name: input.name }));
      } catch (err) {
        await this.deps.prisma.posTerminal.update({
          where: { id },
          data: { syncError: `Nome não atualizado no Mercado Pago: ${(err as Error).message}`.slice(0, 300) },
        });
      }
    }
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'pos',
      resourceId: id,
      action: input.rotatePublicSlug ? 'pos.public_slug_rotated' : 'pos.updated',
      before: { name: before.name, status: before.status, storeId: before.storeId },
      after: { name: updated.name, status: updated.status, storeId: updated.storeId },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return this.view(updated, auth);
  }

  /**
   * Regularização de external_id inválido para Orders — SOMENTE via operação remota suportada
   * (PUT /pos/{id}) e confirmada por GET /v2/pos/{id}. Nunca altera apenas o banco local.
   */
  async regularize(auth: AuthContext, id: string, meta: RequestMeta) {
    const pos = await this.get(auth, id);
    if (pos.activeChargeId) throw Errors.conflict('Aguarde o fim da cobrança em andamento');
    if (isValidExternalPosId(pos.externalId)) return { ok: true, externalId: pos.externalId, changed: false };
    const externalId = newExternalPosId();
    const { accessToken } = await this.deps.tokens.getAccessToken(pos.mpConnectionId);
    await this.deps.guard.run(pos.mpConnectionId, () => updateRemotePos(this.deps.mpApi, accessToken, pos.mpPosId, { external_id: externalId }));
    const result = await syncPos(this.deps, pos.id, { userId: auth.userId, correlationId: meta.correlationId });
    const fresh = await this.deps.prisma.posTerminal.findUniqueOrThrow({ where: { id } });
    if (fresh.externalId !== externalId) {
      throw Errors.conflict('O Mercado Pago não confirmou o novo external_id. Verifique o POS na conta.', result.divergences);
    }
    await writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'pos',
      resourceId: id,
      action: 'pos.external_id_regularized',
      before: { externalId: pos.externalId },
      after: { externalId },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true, externalId, changed: true };
  }

  async sync(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.get(auth, id);
    return syncPos(this.deps, id, { userId: auth.userId, correlationId: meta.correlationId });
  }

  async deactivate(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.update(auth, id, { status: 'INACTIVE' }, meta);
  }

  /** QR da URL pública AdapterPay (placa/NFC) — NÃO é o BR Code. */
  async publicQr(auth: AuthContext, id: string) {
    const pos = await this.get(auth, id);
    const url = this.publicUrl(pos.publicSlug);
    const [svg, png] = await Promise.all([
      QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
      QRCode.toDataURL(url, { margin: 2, width: 1024, errorCorrectionLevel: 'M' }),
    ]);
    // QR principal da placa: o BR Code estático do POS (qr_response.qr_code). O Mercado Pago aplica
    // o valor da Order ativa no momento do pagamento; a confirmação continua sendo feita pelo polling.
    const brCodeValid = !!pos.qrCode && validateBrCode(pos.qrCode).valid;
    const brCode = brCodeValid
      ? {
          value: pos.qrCode!,
          svg: await QRCode.toString(pos.qrCode!, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
          pngDataUrl: await QRCode.toDataURL(pos.qrCode!, { margin: 2, width: 1024, errorCorrectionLevel: 'M' }),
        }
      : null;
    return {
      url,
      svg,
      pngDataUrl: png,
      brCode,
      // Registro NDEF URI para gravação em tag NFC (sem app próprio).
      nfc: { recordType: 'U', uri: url },
      storeName: pos.store?.name ?? null,
      posName: pos.name,
    };
  }

  /** BR Code do POS — acesso controlado e auditado. */
  async brCode(auth: AuthContext, id: string, meta: RequestMeta) {
    const pos = await this.get(auth, id);
    await writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'pos',
      resourceId: id,
      action: 'pos.brcode_viewed',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { qrCode: pos.qrCode, valid: validateBrCode(pos.qrCode).valid, updatedAt: pos.qrUpdatedAt };
  }
}
