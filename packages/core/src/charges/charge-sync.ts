import { type ChargeStatus as DbChargeStatus, type Prisma, type PrismaClient } from '@adapterpay/database';
import {
  canTransition,
  POS_RELEASING_STATUSES,
  type ChargeStatus,
  type ConfirmedPaymentData,
  type OrderDecision,
} from '@adapterpay/shared';
import type { EventPublisher } from '../events';
import { applyLoyaltyOnTransition } from '../loyalty/loyalty';
import { applyTableBillOnTransition } from '../restaurant/table-bill';
import { createNotification } from '../notifications';
import { redactPayload } from '../redact';

/**
 * Aplica, de forma transacional e idempotente, uma decisão sobre a cobrança.
 * - Bloqueia a linha da cobrança (FOR UPDATE) para serializar worker/API.
 * - Respeita a máquina de estados (PAID nunca regride; resposta antiga é ignorada).
 * - Confirmação financeira e liberação do POS ocorrem na MESMA transação, uma única vez.
 */

export interface ApplyParams {
  chargeId: string;
  target: ChargeStatus;
  reasons: string[];
  payment?: ConfirmedPaymentData;
  /** snapshot bruto do provedor (será saneado) */
  providerPayload?: unknown;
  /** atualizações adicionais na cobrança (orderId, expiresAt, ...) aplicadas junto */
  chargePatch?: Prisma.ChargeUpdateInput;
  now?: Date;
}

export interface ApplyResult {
  changed: boolean;
  previous: ChargeStatus;
  status: ChargeStatus;
  ignoredReason?: string;
}

/** Mapeia a decisão da avaliação da Order para o estado interno pretendido. */
export function decisionToStatus(decision: OrderDecision): ChargeStatus {
  switch (decision) {
    case 'PAID':
      return 'PAID';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'RECONCILING':
      return 'RECONCILING';
    case 'PENDING':
      return 'PENDING';
  }
}

const LATE_PAYMENT_CHECK_MS = 10 * 60 * 1000;

export async function applyChargeTransition(
  prisma: PrismaClient,
  events: EventPublisher | null,
  params: ApplyParams,
): Promise<ApplyResult> {
  const now = params.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: DbChargeStatus }>>`
      SELECT id, status FROM charges WHERE id = ${params.chargeId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error(`Cobrança ${params.chargeId} inexistente`);
    const previous = row.status as ChargeStatus;
    const target = params.target;

    if (previous === target) {
      // Sem transição: apenas registra a consulta e eventuais patches neutros.
      await tx.charge.update({
        where: { id: params.chargeId },
        data: { lastPolledAt: now, statusReason: target === 'RECONCILING' ? params.reasons.join(',').slice(0, 500) : undefined, ...(params.chargePatch ?? {}) },
      });
      return { changed: false, previous, status: previous } satisfies ApplyResult;
    }

    if (!canTransition(previous, target)) {
      await tx.charge.update({ where: { id: params.chargeId }, data: { lastPolledAt: now } });
      return {
        changed: false,
        previous,
        status: previous,
        ignoredReason: `TRANSITION_NOT_ALLOWED:${previous}->${target}`,
      } satisfies ApplyResult;
    }

    const charge = await tx.charge.findUniqueOrThrow({ where: { id: params.chargeId } });
    const data: Prisma.ChargeUpdateInput = {
      ...(params.chargePatch ?? {}),
      status: target,
      statusReason: params.reasons.join(',').slice(0, 500) || null,
      lastPolledAt: now,
    };

    if (target === 'PAID') {
      if (!params.payment) throw new Error('Confirmação PAID exige dados do pagamento validados');
      const p = params.payment;
      // Idempotência: (mp_connection_id, mp_payment_id) é único.
      await tx.payment.upsert({
        where: { mpConnectionId_mpPaymentId: { mpConnectionId: charge.mpConnectionId, mpPaymentId: p.mpPaymentId } },
        create: {
          chargeId: charge.id,
          tenantId: charge.tenantId,
          mpConnectionId: charge.mpConnectionId,
          mpPaymentId: p.mpPaymentId,
          mpReferenceId: p.mpReferenceId,
          amountCents: p.amountCents,
          paidAmountCents: p.paidAmountCents,
          method: p.method,
          status: p.status,
          statusDetail: p.statusDetail,
          confirmedAt: now,
        },
        update: {},
      });
      data.paidAt = now;
      data.terminalAt = charge.terminalAt ?? now;
      data.mpPaymentId = p.mpPaymentId;
      // Pedido numerado (totem/catálogo) entra na fila da cozinha/balcão.
      if (charge.orderNumber !== null && !charge.fulfillmentStatus) data.fulfillmentStatus = 'PREPARING';
    } else if (target === 'REFUNDED') {
      await tx.payment.updateMany({ where: { chargeId: charge.id, refundedAt: null }, data: { refundedAt: now } });
    } else if (POS_RELEASING_STATUSES.includes(target)) {
      data.terminalAt = now;
    }

    await tx.charge.update({ where: { id: charge.id }, data });

    // Fidelidade: consome/libera o código aplicado e credita cashback ou brinde, na mesma transação.
    await applyLoyaltyOnTransition(tx, charge, previous, target);
    // Modo Restaurante: soma o pagamento na conta da mesa e fecha a conta ao atingir 100%.
    await applyTableBillOnTransition(tx, charge, previous, target);

    if (POS_RELEASING_STATUSES.includes(target)) {
      // Libera o POS somente se ele ainda aponta para esta cobrança.
      await tx.posTerminal.updateMany({
        where: { id: charge.posId, activeChargeId: charge.id },
        data: { activeChargeId: null },
      });
    }

    // Estado do job de polling.
    if (target === 'PAID' || target === 'REFUNDED' || target === 'FAILED') {
      await tx.pollingJob.updateMany({
        where: { chargeId: charge.id },
        data: { done: true, leaseOwner: null, leaseUntil: null, postTerminalCheckAt: null },
      });
    } else if (target === 'EXPIRED' || target === 'CANCELLED') {
      // Uma verificação posterior detecta pagamento atrasado (seção 8 — reconciliação posterior).
      const checkAt = new Date(now.getTime() + LATE_PAYMENT_CHECK_MS);
      await tx.pollingJob.updateMany({
        where: { chargeId: charge.id },
        data: { postTerminalCheckAt: checkAt, nextAttemptAt: checkAt },
      });
    }

    await tx.paymentEvent.create({
      data: {
        chargeId: charge.id,
        previousState: previous,
        newState: target,
        reason: params.reasons.join(',').slice(0, 500) || null,
        providerPayloadRedacted:
          params.providerPayload === undefined
            ? undefined
            : (redactPayload(params.providerPayload) as Prisma.InputJsonValue),
        occurredAt: now,
      },
    });

    if (target === 'RECONCILING' && previous !== 'CREATING') {
      await createNotification(tx, null, {
        tenantId: charge.tenantId,
        kind: 'charge.reconciling',
        title: 'Cobrança em conciliação',
        body: `A cobrança ${charge.externalReference} precisa de conciliação (${params.reasons.slice(0, 3).join(', ')}). O POS permanece reservado até a confirmação segura.`,
        link: `/app/cobrancas/${charge.id}`,
      });
    }
    if (target === 'PAID' && (previous === 'EXPIRED' || previous === 'CANCELLED')) {
      await createNotification(tx, null, {
        tenantId: charge.tenantId,
        kind: 'charge.late_payment',
        title: 'Pagamento confirmado após encerramento',
        body: `A cobrança ${charge.externalReference} foi paga após ser encerrada. Verifique com o cliente.`,
        link: `/app/cobrancas/${charge.id}`,
      });
    }

    return { changed: true, previous, status: target, posId: charge.posId, tenantId: charge.tenantId };
  });

  if (result.changed && events && 'posId' in result) {
    const r = result as ApplyResult & { posId: string; tenantId: string };
    await events
      .publish({ type: 'charge.updated', tenantId: r.tenantId, chargeId: params.chargeId, posId: r.posId, status: r.status })
      .catch(() => undefined);
  }
  return { changed: result.changed, previous: result.previous, status: result.status, ignoredReason: (result as ApplyResult).ignoredReason };
}
