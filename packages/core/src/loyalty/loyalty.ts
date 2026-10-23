import { randomInt } from 'node:crypto';
import type { Prisma } from '@adapterpay/database';
import {
  advanceGiftProgress,
  cashbackFor,
  formatBRL,
  REWARD_CODE_ALPHABET,
  REWARD_CODE_LENGTH,
  rewardMessage,
  type ChargeStatus,
} from '@adapterpay/shared';
import type { CoreDeps } from '../context';
import { createNotification } from '../notifications';
import { isWhatsAppConfigured, sendWhatsAppText } from '../whatsapp/evolution';

/**
 * Fidelidade ligada ao ciclo da cobrança. Roda DENTRO da transação de applyChargeTransition,
 * então crédito, consumo e liberação de códigos acontecem uma única vez junto com a mudança de estado.
 */

const NOTIFY_MAX_ATTEMPTS = 3;
const NOTIFY_WINDOW_MS = 2 * 86_400_000;

export function generateRewardCode(): string {
  let code = '';
  for (let i = 0; i < REWARD_CODE_LENGTH; i++) code += REWARD_CODE_ALPHABET[randomInt(REWARD_CODE_ALPHABET.length)];
  return code;
}

/** Código livre no tenant (consulta antes de inserir: um erro de unicidade abortaria a transação). */
async function freeCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateRewardCode();
    if (!(await tx.loyaltyReward.findFirst({ where: { tenantId, code }, select: { id: true } }))) return code;
  }
  throw new Error('Não foi possível gerar um código de fidelidade único');
}

interface ChargeForLoyalty {
  id: string;
  tenantId: string;
  amountCents: number;
  externalReference: string;
  loyaltyCustomerId: string | null;
  loyaltyRewardId: string | null;
}

export async function applyLoyaltyOnTransition(
  tx: Prisma.TransactionClient,
  charge: ChargeForLoyalty,
  previous: ChargeStatus,
  target: ChargeStatus,
): Promise<void> {
  if (target === 'EXPIRED' || target === 'CANCELLED' || target === 'FAILED') {
    // Cobrança não paga: o código reservado volta a ficar disponível.
    await tx.loyaltyReward.updateMany({
      where: { reservedChargeId: charge.id, status: 'RESERVED' },
      data: { status: 'AVAILABLE', reservedChargeId: null },
    });
    return;
  }

  if (target === 'PAID' && previous !== 'PAID') {
    await consumeAppliedReward(tx, charge);
    if (charge.loyaltyCustomerId) await accrue(tx, charge);
    return;
  }

  if (target === 'REFUNDED') {
    // Estorno: recompensas geradas por esta compra e ainda não usadas são canceladas.
    await tx.loyaltyReward.updateMany({
      where: { earnedChargeId: charge.id, status: 'AVAILABLE' },
      data: { status: 'CANCELLED' },
    });
    if (charge.loyaltyCustomerId) {
      const c = await tx.loyaltyCustomer.findUnique({ where: { id: charge.loyaltyCustomerId } });
      if (c) {
        await tx.loyaltyCustomer.update({
          where: { id: c.id },
          data: {
            purchaseCount: Math.max(0, c.purchaseCount - 1),
            totalSpentCents: Math.max(0, c.totalSpentCents - charge.amountCents),
            giftProgress: Math.max(0, c.giftProgress - 1),
          },
        });
      }
    }
  }
}

async function consumeAppliedReward(tx: Prisma.TransactionClient, charge: ChargeForLoyalty): Promise<void> {
  if (!charge.loyaltyRewardId) return;
  const used = await tx.loyaltyReward.updateMany({
    where: {
      id: charge.loyaltyRewardId,
      OR: [{ status: 'RESERVED', reservedChargeId: charge.id }, { status: 'AVAILABLE' }],
    },
    data: { status: 'USED', usedAt: new Date(), reservedChargeId: null },
  });
  if (used.count === 0) {
    // Pagamento atrasado de uma cobrança expirada cujo código já foi usado em outra compra.
    await createNotification(tx, null, {
      tenantId: charge.tenantId,
      kind: 'loyalty.code_reused',
      title: 'Código de cashback usado duas vezes',
      body: `A cobrança ${charge.externalReference} foi paga depois de expirar e o código aplicado já tinha sido usado em outra compra.`,
      link: `/app/cobrancas/${charge.id}`,
    });
  }
}

async function accrue(tx: Prisma.TransactionClient, charge: ChargeForLoyalty): Promise<void> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: charge.tenantId },
    select: { loyaltyMode: true, loyaltyCashbackBps: true, loyaltyGiftEvery: true, loyaltyGiftName: true, loyaltyMinPurchaseCents: true },
  });
  const customer = await tx.loyaltyCustomer.findUnique({ where: { id: charge.loyaltyCustomerId! } });
  if (!customer) return;

  const counts = charge.amountCents >= tenant.loyaltyMinPurchaseCents && tenant.loyaltyMode !== 'OFF';
  let giftProgress = customer.giftProgress;
  if (counts && tenant.loyaltyMode === 'CASHBACK') {
    const value = cashbackFor(charge.amountCents, tenant.loyaltyCashbackBps);
    if (value > 0) {
      await tx.loyaltyReward.create({
        data: {
          tenantId: charge.tenantId,
          customerId: customer.id,
          code: await freeCode(tx, charge.tenantId),
          kind: 'CASHBACK',
          valueCents: value,
          earnedChargeId: charge.id,
        },
      });
    }
  } else if (counts && tenant.loyaltyMode === 'GIFT') {
    const step = advanceGiftProgress(customer.giftProgress, tenant.loyaltyGiftEvery);
    giftProgress = step.progress;
    if (step.earned) {
      await tx.loyaltyReward.create({
        data: {
          tenantId: charge.tenantId,
          customerId: customer.id,
          code: await freeCode(tx, charge.tenantId),
          kind: 'GIFT',
          description: tenant.loyaltyGiftName || 'Brinde da loja',
          earnedChargeId: charge.id,
        },
      });
    }
  }
  await tx.loyaltyCustomer.update({
    where: { id: customer.id },
    data: {
      purchaseCount: { increment: 1 },
      totalSpentCents: { increment: charge.amountCents },
      giftProgress,
    },
  });
}

/** Job do worker: avisa por WhatsApp os clientes que ganharam recompensa (somente com consentimento). */
export async function runLoyaltyNotifications(deps: CoreDeps): Promise<{ sent: number; failed: number }> {
  if (!isWhatsAppConfigured(deps.config)) return { sent: 0, failed: 0 };
  const rewards = await deps.prisma.loyaltyReward.findMany({
    where: {
      notifiedAt: null,
      status: 'AVAILABLE',
      notifyAttempts: { lt: NOTIFY_MAX_ATTEMPTS },
      createdAt: { gte: new Date(Date.now() - NOTIFY_WINDOW_MS) },
      customer: { whatsappOptIn: true },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      tenant: { select: { tradeName: true, loyaltyGiftEvery: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  for (const r of rewards) {
    // Reserva o envio antes de enviar: dois workers nunca mandam a mesma mensagem.
    const claimed = await deps.prisma.loyaltyReward.updateMany({
      where: { id: r.id, notifiedAt: null, notifyAttempts: r.notifyAttempts },
      data: { notifyAttempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    try {
      await sendWhatsAppText(
        deps.config,
        r.customer.phone,
        rewardMessage({
          customerName: r.customer.name,
          tradeName: r.tenant.tradeName,
          kind: r.kind as 'CASHBACK' | 'GIFT',
          code: r.code,
          valueBrl: r.valueCents ? formatBRL(r.valueCents) : undefined,
          description: r.description,
          every: r.tenant.loyaltyGiftEvery,
        }),
      );
      await deps.prisma.loyaltyReward.update({ where: { id: r.id }, data: { notifiedAt: new Date() } });
      sent++;
    } catch (err) {
      failed++;
      deps.logger.warn({ rewardId: r.id, err: (err as Error).message }, 'aviso de fidelidade não enviado');
    }
  }
  return { sent, failed };
}
