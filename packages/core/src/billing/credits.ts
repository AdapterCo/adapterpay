import { randomInt } from 'node:crypto';
import type { Invoice, TxClient } from '@adapterpay/database';
import { formatBRL, REFERRAL_BONUS_CENTS, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH, REFERRAL_WELCOME_CENTS } from '@adapterpay/shared';
import { createNotification } from '../notifications';

/**
 * Créditos da assinatura (indicação de lojistas).
 *  - O saldo fica em tenants.billing_credit_cents; o extrato em billing_credits.
 *  - Ao emitir uma fatura, o desconto fica RESERVADO nela (invoices.credit_applied_cents) e só sai do
 *    saldo quando a fatura é paga. Fatura anulada libera a reserva sem nenhum estorno.
 *  - No cartão, a reserva fica em subscriptions.card_credit_cents (o valor recorrente foi reduzido).
 */

export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

/**
 * Código livre entre lojistas E parceiros (os dois usam o mesmo campo no cadastro).
 * Consulta antes de inserir: um erro de unicidade abortaria a transação.
 */
export async function uniqueReferralCode(tx: TxClient): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateReferralCode();
    const [tenant, partner] = await Promise.all([
      tx.tenant.findUnique({ where: { referralCode: code }, select: { id: true } }),
      tx.referralPartner.findUnique({ where: { code }, select: { id: true } }),
    ]);
    if (!tenant && !partner) return code;
  }
  throw new Error('Não foi possível gerar um código de indicação livre');
}

/** Saldo que ainda pode virar desconto: saldo menos o que já está reservado em faturas abertas e no cartão. */
export async function availableCreditCents(tx: TxClient, tenantId: string): Promise<number> {
  const [tenant, reserved, sub] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { billingCreditCents: true } }),
    tx.invoice.aggregate({ where: { tenantId, status: 'OPEN' }, _sum: { creditAppliedCents: true } }),
    tx.subscription.findUnique({ where: { tenantId }, select: { cardCreditCents: true } }),
  ]);
  return Math.max(0, tenant.billingCreditCents - (reserved._sum.creditAppliedCents ?? 0) - (sub?.cardCreditCents ?? 0));
}

/** Desconto de boas-vindas de quem se cadastrou com um código: uma única vez por lojista. */
export async function grantWelcomeCredit(tx: TxClient, tenantId: string): Promise<void> {
  const already = await tx.billingCredit.findFirst({ where: { kind: 'REFERRAL_WELCOME', referredTenantId: tenantId }, select: { id: true } });
  if (already) return;
  await tx.billingCredit.create({ data: { tenantId, kind: 'REFERRAL_WELCOME', amountCents: REFERRAL_WELCOME_CENTS, referredTenantId: tenantId } });
  await tx.tenant.update({ where: { id: tenantId }, data: { billingCreditCents: { increment: REFERRAL_WELCOME_CENTS } } });
}

/**
 * Efeitos de crédito de uma fatura paga, dentro da transação de markInvoicePaid (tenant já travado):
 *  1. debita do saldo o crédito que a fatura usou;
 *  2. na primeira mensalidade paga de um lojista indicado, dá o bônus a quem indicou (uma vez por indicado).
 */
export async function applyCreditsOnInvoicePaid(tx: TxClient, invoice: Invoice): Promise<void> {
  if (invoice.creditAppliedCents > 0) {
    const used = await tx.billingCredit.findUnique({ where: { invoiceId: invoice.id }, select: { id: true } });
    if (!used) {
      await tx.billingCredit.create({ data: { tenantId: invoice.tenantId, kind: 'INVOICE', amountCents: -invoice.creditAppliedCents, invoiceId: invoice.id } });
      await tx.$executeRaw`UPDATE tenants SET billing_credit_cents = GREATEST(billing_credit_cents - ${invoice.creditAppliedCents}, 0) WHERE id = ${invoice.tenantId}::uuid`;
    }
  }

  if (invoice.kind !== 'INITIAL') return;
  // Indicado por um parceiro (sem conta): a comissão passa a "a receber" uma única vez.
  await tx.partnerReferral.updateMany({
    where: { tenantId: invoice.tenantId, status: 'REGISTERED' },
    data: { status: 'EARNED', amountCents: REFERRAL_BONUS_CENTS, earnedAt: new Date() },
  });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId }, select: { tradeName: true, referredByTenantId: true } });
  if (!tenant.referredByTenantId) return;
  const rewarded = await tx.billingCredit.findFirst({ where: { kind: 'REFERRAL_BONUS', referredTenantId: invoice.tenantId }, select: { id: true } });
  if (rewarded) return;
  const referrer = await tx.tenant.findUnique({ where: { id: tenant.referredByTenantId }, select: { id: true, deletedAt: true } });
  if (!referrer || referrer.deletedAt) return;
  await tx.billingCredit.create({ data: { tenantId: referrer.id, kind: 'REFERRAL_BONUS', amountCents: REFERRAL_BONUS_CENTS, referredTenantId: invoice.tenantId } });
  await tx.tenant.update({ where: { id: referrer.id }, data: { billingCreditCents: { increment: REFERRAL_BONUS_CENTS } } });
  await createNotification(tx, null, {
    tenantId: referrer.id,
    kind: 'referral.rewarded',
    title: `Você ganhou ${formatBRL(REFERRAL_BONUS_CENTS)} de crédito`,
    body: `${tenant.tradeName} assinou o AdapterPay com o seu link. O crédito será descontado da sua próxima mensalidade.`,
    link: '/app/indicacoes',
  });
}
