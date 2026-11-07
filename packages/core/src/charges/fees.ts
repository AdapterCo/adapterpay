import { tryDecimalStringToCents } from '@adapterpay/shared';
import type { CoreDeps } from '../context';
import { getPayment, MpApiError, type MpPayment } from '../mercado-pago';

/** Tarifa do recebedor e líquido de um pagamento do MP. Campo ausente ou ilegível => null (nunca 0 inventado). */
export function paymentFees(remote: MpPayment): { feeCents: number | null; netAmountCents: number | null } {
  let feeCents: number | null = null;
  if (Array.isArray(remote.fee_details)) {
    feeCents = 0;
    for (const f of remote.fee_details.filter((x) => !x.fee_payer || x.fee_payer === 'collector')) {
      const c = tryDecimalStringToCents(f.amount);
      if (c === null) {
        feeCents = null;
        break;
      }
      feeCents += c;
    }
  }
  return { feeCents, netAmountCents: tryDecimalStringToCents(remote.transaction_details?.net_received_amount) };
}

/**
 * Tarifa efetiva e valor líquido (seção 16). Consulta GET /v1/payments/{reference_id} na conta
 * recebedora. Campos ausentes permanecem null — nunca assumimos tarifa zero.
 *
 * PREMISSA A VALIDAR: reference_id da transação da Order corresponde ao ID em /v1/payments.
 */
export async function syncPaymentFees(deps: CoreDeps, limit = 20): Promise<number> {
  const pending = await deps.prisma.payment.findMany({
    where: { feeSyncedAt: null, mpReferenceId: { not: null }, feeSyncAttempts: { lt: 10 } },
    orderBy: { confirmedAt: 'asc' },
    take: limit,
  });
  let synced = 0;
  for (const p of pending) {
    try {
      const { accessToken } = await deps.tokens.getAccessToken(p.mpConnectionId);
      const remote = await deps.guard.run(p.mpConnectionId, () => getPayment(deps.mpApi, accessToken, p.mpReferenceId!));
      const { feeCents, netAmountCents: net } = paymentFees(remote);
      await deps.prisma.payment.update({
        where: { id: p.id },
        data: { feeCents, netAmountCents: net, feeSyncedAt: new Date(), feeSyncAttempts: { increment: 1 } },
      });
      synced++;
    } catch (err) {
      const definitive = err instanceof MpApiError && (err.status === 403 || err.status === 404);
      await deps.prisma.payment.update({
        where: { id: p.id },
        data: { feeSyncAttempts: { increment: definitive ? 10 : 1 } },
      });
      deps.logger.warn({ paymentId: p.id, err: (err as Error).message }, 'falha ao sincronizar tarifa');
    }
  }
  return synced;
}
