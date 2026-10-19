import type { MpOrder } from '@adapterpay/shared';
import { isoDurationToSeconds } from '../config';
import type { CoreDeps } from '../context';
import { MpReconnectRequiredError } from '../connections/token-service';
import { buildQrOrderPayload, createOrder, MpApiError } from '../mercado-pago';
import { CircuitOpenError, ConcurrencyLimitError } from '../mercado-pago/resilience';
import { applyChargeTransition } from './charge-sync';

export type SubmissionOutcome =
  | { kind: 'PENDING'; orderId: string }
  | { kind: 'RECONCILING'; reason: string }
  | { kind: 'FAILED'; reason: string }
  | { kind: 'DEFERRED'; reason: string }
  | { kind: 'NOOP'; status: string };

/**
 * Envia (ou reenvia) a criação da Order para uma cobrança em CREATING/RECONCILING sem order_id.
 * Reenvio usa EXATAMENTE o mesmo payload e a mesma X-Idempotency-Key, de modo que uma Order
 * criada antes de uma falha de comunicação é recuperada em vez de duplicada (seção 8).
 */
export async function submitOrder(deps: CoreDeps, chargeId: string): Promise<SubmissionOutcome> {
  const charge = await deps.prisma.charge.findUniqueOrThrow({ where: { id: chargeId } });
  if (charge.orderId) return { kind: 'NOOP', status: charge.status };
  if (charge.status !== 'CREATING' && charge.status !== 'RECONCILING') return { kind: 'NOOP', status: charge.status };

  const neverSent = charge.status === 'CREATING' && !(await hasPriorSubmission(deps, chargeId));

  let accessToken: string;
  try {
    ({ accessToken } = await deps.tokens.getAccessToken(charge.mpConnectionId));
  } catch (err) {
    if (err instanceof MpReconnectRequiredError) {
      // Nada foi enviado ao MP nesta tentativa. Se nunca houve envio, falha definitiva e libera o POS.
      if (neverSent) {
        await applyChargeTransition(deps.prisma, deps.events, {
          chargeId,
          target: 'FAILED',
          reasons: ['MP_RECONNECT_REQUIRED'],
        });
        return { kind: 'FAILED', reason: 'MP_RECONNECT_REQUIRED' };
      }
      await markSubmissionUncertain(deps, chargeId, 'MP_RECONNECT_REQUIRED');
      return { kind: 'RECONCILING', reason: 'MP_RECONNECT_REQUIRED' };
    }
    throw err;
  }

  const payload = buildQrOrderPayload({
    amountCents: charge.amountCents,
    externalReference: charge.externalReference,
    externalPosId: charge.externalPosId,
    expirationIso: deps.config.chargeExpirationIso,
  });

  await recordSubmissionAttempt(deps, chargeId);
  let order: MpOrder;
  try {
    order = await deps.guard.run(charge.mpConnectionId, () =>
      createOrder(deps.mpApi, accessToken, payload, charge.idempotencyKey),
    );
  } catch (err) {
    if (err instanceof CircuitOpenError || err instanceof ConcurrencyLimitError) {
      // Não enviado: reagendar. Se era a primeira tentativa, fica em CREATING (POS reservado).
      return { kind: 'DEFERRED', reason: err.name };
    }
    if (err instanceof MpApiError) {
      if (err.definitiveClientError) {
        const reason = `MP_REJECTED_${err.status}${err.providerCode ? `:${err.providerCode}` : ''}`;
        if (err.unauthorized) {
          await deps.tokens.markNeedsReconnect(charge.mpConnectionId, charge.tenantId, 'Orders API respondeu 401');
        }
        await applyChargeTransition(deps.prisma, deps.events, {
          chargeId,
          target: 'FAILED',
          reasons: [reason],
          providerPayload: err.body,
        });
        return { kind: 'FAILED', reason };
      }
      // Timeout, rede, 5xx, 409 (idempotência em processamento) ou 429: resultado incerto.
      const reason = `CREATE_OUTCOME_UNKNOWN:${err.kind}${err.status ? `_${err.status}` : ''}`;
      await markSubmissionUncertain(deps, chargeId, reason, err.body);
      return { kind: 'RECONCILING', reason };
    }
    await markSubmissionUncertain(deps, chargeId, 'CREATE_OUTCOME_UNKNOWN:exception');
    throw err;
  }

  if (!order?.id || typeof order.id !== 'string') {
    await markSubmissionUncertain(deps, chargeId, 'CREATE_RESPONSE_WITHOUT_ID', order);
    return { kind: 'RECONCILING', reason: 'CREATE_RESPONSE_WITHOUT_ID' };
  }

  // Coerência mínima da resposta de criação; a confirmação financeira é sempre feita pelo polling.
  const mismatches: string[] = [];
  if (order.external_reference !== undefined && order.external_reference !== charge.externalReference) {
    mismatches.push('CREATE_EXTERNAL_REFERENCE_MISMATCH');
  }
  if (order.config?.qr?.external_pos_id !== undefined && order.config.qr.external_pos_id !== charge.externalPosId) {
    mismatches.push('CREATE_EXTERNAL_POS_ID_MISMATCH');
  }

  const createdAt = parseDate(order.created_date) ?? new Date();
  const ttl = isoDurationToSeconds(order.expiration_time) ?? deps.config.CHARGE_EXPIRATION_SECONDS;
  const expiresAt = new Date(createdAt.getTime() + ttl * 1000);
  const paymentId = order.transactions?.payments?.[0]?.id ?? null;

  const target = mismatches.length > 0 ? 'RECONCILING' : 'PENDING';
  await applyChargeTransition(deps.prisma, deps.events, {
    chargeId,
    target,
    reasons: mismatches.length > 0 ? mismatches : ['ORDER_CREATED'],
    providerPayload: order,
    chargePatch: { orderId: order.id, mpPaymentId: paymentId, mpCreatedAt: createdAt, expiresAt },
  });
  // Mesmo que a transição seja neutra (ex.: já RECONCILING), grava o order_id para o polling.
  await deps.prisma.charge.updateMany({
    where: { id: chargeId, orderId: null },
    data: { orderId: order.id, mpPaymentId: paymentId, mpCreatedAt: createdAt, expiresAt },
  });
  await deps.prisma.pollingJob.updateMany({
    where: { chargeId },
    data: { nextAttemptAt: new Date(Date.now() + deps.config.POLL_INTERVAL_SECONDS * 1000), consecutiveErrors: 0 },
  });
  return target === 'PENDING' ? { kind: 'PENDING', orderId: order.id } : { kind: 'RECONCILING', reason: mismatches.join(',') };
}

async function hasPriorSubmission(deps: CoreDeps, chargeId: string): Promise<boolean> {
  const n = await deps.prisma.paymentEvent.count({ where: { chargeId, reason: 'ORDER_SUBMIT_ATTEMPT' } });
  return n > 0;
}

async function recordSubmissionAttempt(deps: CoreDeps, chargeId: string): Promise<void> {
  const charge = await deps.prisma.charge.findUniqueOrThrow({ where: { id: chargeId }, select: { status: true } });
  await deps.prisma.paymentEvent.create({
    data: { chargeId, previousState: charge.status, newState: charge.status, reason: 'ORDER_SUBMIT_ATTEMPT' },
  });
}

async function markSubmissionUncertain(deps: CoreDeps, chargeId: string, reason: string, payload?: unknown): Promise<void> {
  await applyChargeTransition(deps.prisma, deps.events, {
    chargeId,
    target: 'RECONCILING',
    reasons: [reason],
    providerPayload: payload,
  });
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
