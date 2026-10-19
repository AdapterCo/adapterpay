import { evaluateOrder, isActiveCharge, type ChargeStatus } from '@adapterpay/shared';
import type { CoreDeps } from '../context';
import { MpReconnectRequiredError } from '../connections/token-service';
import { getOrder, MpApiError } from '../mercado-pago';
import { backoffWithJitter, CircuitOpenError, ConcurrencyLimitError } from '../mercado-pago/resilience';
import { applyChargeTransition, decisionToStatus } from './charge-sync';
import { submitOrder } from './order-submission';

/**
 * Polling de uma cobrança (seção 9). Um job ativo por Order, com lease no banco
 * (polling_jobs.lease_owner/lease_until) para impedir consultas duplicadas entre workers.
 * Retorna o atraso até a próxima consulta, ou null quando não há mais nada a fazer.
 */

const LEASE_MS = 45_000;
/** Após este tempo além de expires_at sem estado terminal remoto, a cobrança vai para RECONCILING. */
const RECONCILE_AFTER_EXPIRY_MS = 2 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS_BEFORE_RECONCILING = 5;

export interface PollResult {
  nextDelayMs: number | null;
  status?: ChargeStatus;
  skipped?: string;
}

export function nextPollDelayMs(params: {
  baseSeconds: number;
  expiresAt: Date | null;
  now: Date;
  status: ChargeStatus;
}): number {
  const base = params.baseSeconds * 1000;
  if (!params.expiresAt) return base;
  const past = params.now.getTime() - params.expiresAt.getTime();
  if (past < 60_000) return base;
  if (past < 15 * 60_000) return 10_000;
  if (past < 24 * 3600_000) return 60_000;
  return 15 * 60_000; // casos antigos: cadência baixa para não sobrecarregar o provedor
}

export async function pollCharge(deps: CoreDeps, chargeId: string, workerId: string): Promise<PollResult> {
  const now = new Date();
  const lease = await deps.prisma.pollingJob.updateMany({
    where: {
      chargeId,
      done: false,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }, { leaseOwner: workerId }],
    },
    data: { leaseOwner: workerId, leaseUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now, attempts: { increment: 1 } },
  });
  if (lease.count === 0) return { nextDelayMs: null, skipped: 'LEASE_NOT_ACQUIRED' };

  try {
    return await pollWithLease(deps, chargeId, now);
  } finally {
    await deps.prisma.pollingJob.updateMany({
      where: { chargeId, leaseOwner: workerId },
      data: { leaseOwner: null, leaseUntil: null },
    });
  }
}

async function pollWithLease(deps: CoreDeps, chargeId: string, now: Date): Promise<PollResult> {
  const charge = await deps.prisma.charge.findUniqueOrThrow({
    where: { id: chargeId },
    include: { mpConnection: { select: { mpUserId: true, status: true } }, pollingJob: true },
  });
  const job = charge.pollingJob!;
  const status = charge.status as ChargeStatus;
  const base = deps.config.POLL_INTERVAL_SECONDS;

  // Cobrança sem order_id: (re)envio idempotente da criação.
  if (!charge.orderId && (status === 'CREATING' || status === 'RECONCILING')) {
    const out = await submitOrder(deps, chargeId);
    const delay = out.kind === 'DEFERRED' || out.kind === 'RECONCILING' ? backoffWithJitter(job.consecutiveErrors) : base * 1000;
    if (out.kind === 'FAILED' || out.kind === 'NOOP') {
      const fresh = await deps.prisma.charge.findUniqueOrThrow({ where: { id: chargeId }, select: { status: true } });
      if (!isActiveCharge(fresh.status as ChargeStatus)) return { nextDelayMs: null, status: fresh.status as ChargeStatus };
    }
    await schedule(deps, chargeId, delay, out.kind === 'RECONCILING' || out.kind === 'DEFERRED');
    return { nextDelayMs: delay, status };
  }

  const terminalCheck = !isActiveCharge(status);
  if (terminalCheck) {
    // Apenas a verificação pós-terminal (pagamento atrasado) mantém o job vivo.
    if (!job.postTerminalCheckAt || job.postTerminalCheckAt > now || (status !== 'EXPIRED' && status !== 'CANCELLED')) {
      if (!job.postTerminalCheckAt || status === 'PAID' || status === 'FAILED' || status === 'REFUNDED') {
        await deps.prisma.pollingJob.update({ where: { chargeId }, data: { done: true } });
        return { nextDelayMs: null, status };
      }
      const wait = job.postTerminalCheckAt.getTime() - now.getTime();
      return { nextDelayMs: Math.max(wait, 1000), status };
    }
  }

  let order;
  try {
    const { accessToken } = await deps.tokens.getAccessToken(charge.mpConnectionId);
    order = await deps.guard.run(charge.mpConnectionId, async () => {
      try {
        return await getOrder(deps.mpApi, accessToken, charge.orderId!);
      } catch (err) {
        if (err instanceof MpApiError && err.unauthorized) {
          const refreshed = await deps.tokens.handleUnauthorized(charge.mpConnectionId);
          return getOrder(deps.mpApi, refreshed.accessToken, charge.orderId!);
        }
        throw err;
      }
    });
  } catch (err) {
    return handlePollError(deps, charge, err, now, terminalCheck);
  }

  const evaluation = evaluateOrder(
    {
      orderId: charge.orderId!,
      externalReference: charge.externalReference,
      amountCents: charge.amountCents,
      externalPosId: charge.externalPosId,
      mpUserId: charge.mpConnection.mpUserId,
      requiredPaymentMethodId: 'pix',
    },
    order,
  );

  let target = decisionToStatus(evaluation.decision);
  let reasons = evaluation.reasons;
  const pastReconcileThreshold =
    charge.expiresAt !== null && now.getTime() - charge.expiresAt.getTime() > RECONCILE_AFTER_EXPIRY_MS;

  if (terminalCheck) {
    // Na verificação pós-terminal, somente uma confirmação PAID validada muda o estado.
    if (target !== 'PAID') {
      await deps.prisma.pollingJob.update({ where: { chargeId }, data: { done: true, postTerminalCheckAt: null } });
      await deps.prisma.charge.update({ where: { id: chargeId }, data: { lastPolledAt: now } });
      return { nextDelayMs: null, status };
    }
  } else if (target === 'PENDING' && pastReconcileThreshold) {
    target = 'RECONCILING';
    reasons = ['REMOTE_NOT_TERMINAL_AFTER_EXPIRY', ...reasons];
  }

  const applied = await applyChargeTransition(deps.prisma, deps.events, {
    chargeId,
    target,
    reasons,
    payment: evaluation.payment,
    providerPayload: order,
    now,
  });
  if (applied.ignoredReason) {
    deps.logger.warn({ chargeId, ignored: applied.ignoredReason, decision: evaluation.decision }, 'transição ignorada');
  }

  await deps.prisma.pollingJob.update({ where: { chargeId }, data: { consecutiveErrors: 0, lastError: null } });

  if (!isActiveCharge(applied.status)) {
    const jobNow = await deps.prisma.pollingJob.findUniqueOrThrow({ where: { chargeId } });
    if (jobNow.done || !jobNow.postTerminalCheckAt) return { nextDelayMs: null, status: applied.status };
    const wait = Math.max(jobNow.postTerminalCheckAt.getTime() - Date.now(), 1000);
    return { nextDelayMs: wait, status: applied.status };
  }

  const delay = nextPollDelayMs({ baseSeconds: base, expiresAt: charge.expiresAt, now, status: applied.status });
  await schedule(deps, chargeId, delay, false);
  return { nextDelayMs: delay, status: applied.status };
}

async function handlePollError(
  deps: CoreDeps,
  charge: { id: string; status: string; expiresAt: Date | null; mpConnectionId: string; tenantId: string },
  err: unknown,
  now: Date,
  terminalCheck: boolean,
): Promise<PollResult> {
  const job = await deps.prisma.pollingJob.findUniqueOrThrow({ where: { chargeId: charge.id } });

  if (err instanceof CircuitOpenError || err instanceof ConcurrencyLimitError) {
    const delay = 2000 + Math.floor(Math.random() * 3000);
    await schedule(deps, charge.id, delay, false);
    return { nextDelayMs: delay, skipped: err.name };
  }

  const errors = job.consecutiveErrors + 1;
  let reason = 'POLL_ERROR';
  let delay = backoffWithJitter(errors, deps.config.POLL_INTERVAL_SECONDS * 1000);

  if (err instanceof MpReconnectRequiredError) {
    reason = 'MP_TOKEN_REVOKED';
    delay = 60_000;
  } else if (err instanceof MpApiError) {
    reason = `POLL_${err.kind.toUpperCase()}${err.status ? `_${err.status}` : ''}`;
    if (err.rateLimited && err.retryAfterMs) delay = Math.max(delay, err.retryAfterMs);
    if (err.notFound) reason = 'ORDER_NOT_FOUND';
  } else {
    deps.logger.error({ chargeId: charge.id, err }, 'erro inesperado no polling');
  }

  await deps.prisma.pollingJob.update({
    where: { chargeId: charge.id },
    data: { consecutiveErrors: errors, lastError: reason.slice(0, 300) },
  });

  // Falhas de comunicação NUNCA viram EXPIRED: diferenciamos RECONCILING de EXPIRED (seção 7).
  const pastExpiry = charge.expiresAt !== null && now.getTime() > charge.expiresAt.getTime();
  if (
    !terminalCheck &&
    charge.status === 'PENDING' &&
    (reason === 'MP_TOKEN_REVOKED' || reason === 'ORDER_NOT_FOUND' || (pastExpiry && errors >= MAX_CONSECUTIVE_ERRORS_BEFORE_RECONCILING))
  ) {
    await applyChargeTransition(deps.prisma, deps.events, { chargeId: charge.id, target: 'RECONCILING', reasons: [reason] });
  }

  if (terminalCheck && errors >= 10) {
    await deps.prisma.pollingJob.update({ where: { chargeId: charge.id }, data: { done: true } });
    return { nextDelayMs: null };
  }

  await schedule(deps, charge.id, delay, true);
  return { nextDelayMs: delay, skipped: reason };
}

async function schedule(deps: CoreDeps, chargeId: string, delayMs: number, _isError: boolean): Promise<void> {
  await deps.prisma.pollingJob.update({
    where: { chargeId },
    data: { nextAttemptAt: new Date(Date.now() + delayMs) },
  });
}
