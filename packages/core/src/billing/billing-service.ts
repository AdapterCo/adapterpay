import type { BillingMethod, Invoice, InvoiceKind, Prisma, Subscription, TxClient } from '@adapterpay/database';
import {
  acceptedMonthlyAmounts,
  centsToDecimalString,
  creditDiscountCents,
  excessForPlan,
  prorataUpgradeCents,
  subscriptionMonthlyCents,
  tryDecimalStringToCents,
} from '@adapterpay/shared';
import { writeAudit } from '../audit';
import { resolvePlatformAccessToken } from '../config';
import type { CoreDeps } from '../context';
import { randomToken } from '../crypto';
import { getUsage, lockTenant } from '../limits';
import {
  cancelPayment,
  createPlatformPixPayment,
  createPreapproval,
  getPayment,
  getPreapproval,
  MpApiError,
  searchAuthorizedPayments,
  updatePreapproval,
  type MpPayment,
} from '../mercado-pago';
import { createNotification } from '../notifications';
import { applyCreditsOnInvoicePaid, availableCreditCents } from './credits';
import { addDays, addMonthsUtc, formatInTimezone } from './periods';

/**
 * Assinaturas AdapterPay (seção 2) — cobradas na conta Mercado Pago da PLATAFORMA,
 * separada das contas dos lojistas. Sem webhooks: toda confirmação é por polling.
 *
 * Políticas (docs/assinaturas.md):
 *  - Sem teste grátis; tenant só opera após pagamento confirmado no backend.
 *  - Pix manual por competência: fatura emitida BILLING_RENEWAL_LEAD_DAYS antes do vencimento.
 *  - Vencimento = current_period_end (UTC). Tolerância zero: na passagem do vencimento,
 *    consulta-se o provedor uma última vez; sem pagamento, o tenant é suspenso.
 *  - Reativação após suspensão: novo período começa na confirmação do pagamento.
 *  - Upgrade: cobrança complementar pró-rata (prorataUpgradeCents) via Pix; plano muda após confirmação.
 *  - Downgrade: agendado para o próximo ciclo; exige uso dentro dos limites do plano alvo.
 *  - Cancelamento: sem renovação; acesso até o fim do período pago; histórico preservado.
 */

export class BillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

const PIX_TTL_MS = 24 * 3600 * 1000;
const INITIAL_INVOICE_TTL_DAYS = 7;
const UPGRADE_INVOICE_TTL_DAYS = 3;

export class BillingService {
  private platformTokenCache: string | null = null;

  constructor(private readonly d: CoreDeps) {}

  private platformToken(): string {
    if (!this.platformTokenCache) {
      this.platformTokenCache = resolvePlatformAccessToken(this.d.config);
    }
    return this.platformTokenCache;
  }

  private newExternalReference(): string {
    return `ADAPTERPAY_INV_${randomToken(12).replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
  }

  // ---------------------------------------------------------------- checkout

  /** Inicia (ou retoma) a contratação: cria fatura inicial (Pix) ou assinatura de cartão. */
  async startCheckout(params: {
    tenantId: string;
    planId: string;
    method: BillingMethod;
    payerEmail: string;
    actorUserId: string;
  }): Promise<{ invoiceId?: string; redirectUrl?: string }> {
    const plan = await this.d.prisma.plan.findFirst({ where: { id: params.planId, active: true } });
    if (!plan) throw new BillingError('PLAN_NOT_FOUND', 'Plano indisponível');

    const sub = await this.d.prisma.$transaction(async (tx) => {
      await lockTenant(tx, params.tenantId);
      const current = await tx.subscription.findUnique({ where: { tenantId: params.tenantId } });
      if (current && current.status === 'ACTIVE') {
        throw new BillingError('ALREADY_ACTIVE', 'A assinatura já está ativa; use troca de plano');
      }
      const s = current
        ? await tx.subscription.update({ where: { id: current.id }, data: { planId: plan.id, method: params.method } })
        : await tx.subscription.create({ data: { tenantId: params.tenantId, planId: plan.id, method: params.method, status: 'PENDING' } });
      // Faturas iniciais abertas de outro plano/método são anuladas para evitar dupla cobrança.
      await tx.invoice.updateMany({
        where: {
          subscriptionId: s.id,
          status: 'OPEN',
          kind: { in: ['INITIAL', 'RENEWAL'] },
          OR: [{ planId: { not: plan.id } }, { method: { not: params.method } }],
          providerReference: null,
        },
        data: { status: 'VOID' },
      });
      await writeAudit(tx, {
        tenantId: params.tenantId,
        actorUserId: params.actorUserId,
        actorType: 'USER',
        resourceType: 'subscription',
        resourceId: s.id,
        action: 'subscription.checkout_started',
        after: { planId: plan.id, method: params.method },
      });
      return s;
    });

    const kind: InvoiceKind = sub.startedAt ? 'RENEWAL' : 'INITIAL';
    const monthly = subscriptionMonthlyCents(plan, sub.totemQuantity);

    if (params.method === 'PIX') {
      // Crédito de indicação vira desconto reservado na fatura (sai do saldo só quando ela for paga).
      const invoice = await this.d.prisma.$transaction(async (tx) => {
        await lockTenant(tx, params.tenantId);
        const open = await tx.invoice.findMany({ where: { subscriptionId: sub.id, status: 'OPEN', kind, planId: plan.id, method: 'PIX' } });
        const existing = open.find((i) => i.amountCents + i.creditAppliedCents === monthly);
        if (existing) return existing;
        const discount = creditDiscountCents(monthly, await availableCreditCents(tx, params.tenantId));
        return tx.invoice.create({
          data: {
            tenantId: params.tenantId,
            subscriptionId: sub.id,
            kind,
            planId: plan.id,
            method: 'PIX',
            amountCents: monthly - discount,
            creditAppliedCents: discount,
            dueAt: addDays(new Date(), INITIAL_INVOICE_TTL_DAYS),
            externalReference: this.newExternalReference(),
          },
        });
      });
      await this.ensurePixForInvoice(invoice.id, params.payerEmail);
      return { invoiceId: invoice.id };
    }

    // Cartão recorrente: checkout oficial do MP (sem coletar PAN/CVV no AdapterPay).
    if (sub.mpPreapprovalId) {
      const pre = await getPreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId);
      if (pre.status === 'pending' && pre.init_point) return { redirectUrl: pre.init_point };
    }
    // No cartão, o crédito reduz o valor da primeira cobrança; depois dela o valor volta ao normal.
    const cardDiscount = await this.d.prisma.$transaction(async (tx) => {
      await lockTenant(tx, params.tenantId);
      const fresh = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id }, select: { cardCreditCents: true } });
      const discount = creditDiscountCents(monthly, (await availableCreditCents(tx, params.tenantId)) + fresh.cardCreditCents);
      await tx.subscription.update({ where: { id: sub.id }, data: { cardCreditCents: discount } });
      return discount;
    });
    const pre = await createPreapproval(this.d.mpApi, this.platformToken(), {
      reason: `AdapterPay — Plano ${plan.name}`,
      externalReference: `ADAPTERPAY_SUB_${sub.id.replace(/-/g, '')}`,
      payerEmail: params.payerEmail,
      amountCents: monthly - cardDiscount,
      backUrl: `${this.d.config.APP_URL}/assinatura/retorno`,
    });
    if (!pre.id || !pre.init_point) throw new BillingError('PROVIDER_ERROR', 'Resposta de assinatura sem init_point');
    await this.d.prisma.subscription.update({
      where: { id: sub.id },
      data: { mpPreapprovalId: pre.id, preapprovalStatus: pre.status ?? 'pending', nextPollAt: new Date(Date.now() + 30_000) },
    });
    return { redirectUrl: pre.init_point };
  }

  /**
   * Garante um Pix vigente para a fatura. Se houver Pix anterior expirado/pendente, verifica-o
   * primeiro (pode ter sido pago) e cancela antes de gerar outro, evitando dois QR válidos.
   */
  async ensurePixForInvoice(invoiceId: string, payerEmail: string): Promise<Invoice> {
    let invoice = await this.d.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== 'OPEN') return invoice;
    if (invoice.method !== 'PIX') throw new BillingError('NOT_PIX', 'Fatura não é Pix');

    if (invoice.providerReference) {
      const paid = await this.pollInvoice(invoice.id);
      if (paid.status !== 'OPEN') return paid;
      invoice = paid;
      const stillValid = invoice.pixExpiresAt && invoice.pixExpiresAt.getTime() - Date.now() > 5 * 60_000;
      if (stillValid && invoice.pixQrCode) return invoice;
      try {
        await cancelPayment(this.d.mpApi, this.platformToken(), invoice.providerReference!);
      } catch (err) {
        // Já expirado/cancelado no provedor é aceitável; outros erros impedem gerar novo Pix.
        if (!(err instanceof MpApiError && (err.status === 400 || err.status === 404))) throw err;
      }
      const recheck = await getPayment(this.d.mpApi, this.platformToken(), invoice.providerReference!);
      if (recheck.status === 'approved') return this.pollInvoice(invoice.id);
    }

    const attempt = invoice.attempts + 1;
    const expiresAt = new Date(Math.min(Date.now() + PIX_TTL_MS, Math.max(invoice.dueAt.getTime(), Date.now() + 30 * 60_000)));
    const payment = await createPlatformPixPayment(this.d.mpApi, this.platformToken(), {
      amountCents: invoice.amountCents,
      description: `AdapterPay — fatura ${invoice.externalReference}`,
      externalReference: invoice.externalReference,
      payerEmail,
      expiresAt,
      idempotencyKey: `${invoice.id}:${attempt}`,
    });
    const tx = payment.point_of_interaction?.transaction_data;
    if (!payment.id || !tx?.qr_code) throw new BillingError('PROVIDER_ERROR', 'Pix da fatura sem QR');
    return this.d.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        providerReference: String(payment.id),
        providerStatus: payment.status ?? null,
        pixQrCode: tx.qr_code,
        pixQrBase64: tx.qr_code_base64 ?? null,
        pixExpiresAt: expiresAt,
        attempts: attempt,
        lastAttemptAt: new Date(),
        nextPollAt: new Date(Date.now() + 10_000),
        lastError: null,
      },
    });
  }

  // ---------------------------------------------------------------- polling

  /** Consulta o Pix da fatura e aplica o pagamento se aprovado e coerente. */
  async pollInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.d.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== 'OPEN' || !invoice.providerReference || invoice.method !== 'PIX') return invoice;
    let payment: MpPayment;
    try {
      payment = await getPayment(this.d.mpApi, this.platformToken(), invoice.providerReference);
    } catch (err) {
      return this.d.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          lastError: (err as Error).message.slice(0, 300),
          lastAttemptAt: new Date(),
          nextPollAt: new Date(Date.now() + 60_000),
        },
      });
    }
    const valid = isApprovedPaymentFor(payment, invoice);
    if (valid.ok) {
      return this.markInvoicePaid(invoice.id, parsePaidAt(payment.date_approved), payment.status ?? 'approved');
    }
    const terminal = ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(payment.status ?? '');
    const pixExpired = invoice.pixExpiresAt !== null && invoice.pixExpiresAt.getTime() < Date.now();
    return this.d.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        providerStatus: payment.status ?? null,
        lastAttemptAt: new Date(),
        lastError: payment.status === 'approved' ? `APPROVED_BUT_INVALID:${valid.reasons.join(',')}` : null,
        // Pix encerrado: para a consulta; um novo Pix é gerado sob demanda.
        nextPollAt: terminal || pixExpired ? null : new Date(Date.now() + nextInvoicePollMs(invoice)),
      },
    });
  }

  /** Efeitos de uma fatura paga, aplicados uma única vez (idempotente). */
  async markInvoicePaid(invoiceId: string, paidAt: Date, providerStatus: string): Promise<Invoice> {
    const out = await this.d.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
      if (locked[0]?.status !== 'OPEN') return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const invoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt, providerStatus, nextPollAt: null, lastError: null },
      });
      await lockTenant(tx, invoice.tenantId);
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId } });
      await this.applyPaidInvoice(tx, sub, invoice, paidAt);
      await applyCreditsOnInvoicePaid(tx, invoice);
      await writeAudit(tx, {
        tenantId: invoice.tenantId,
        actorType: 'WORKER',
        resourceType: 'invoice',
        resourceId: invoice.id,
        action: 'invoice.paid',
        after: { kind: invoice.kind, amountCents: invoice.amountCents, creditAppliedCents: invoice.creditAppliedCents, planId: invoice.planId },
      });
      await createNotification(tx, null, {
        tenantId: invoice.tenantId,
        kind: 'invoice.paid',
        title: 'Pagamento da assinatura confirmado',
        body: 'Obrigado! O pagamento foi confirmado e sua assinatura está ativa.',
        link: '/app/assinatura',
      });
      return invoice;
    });
    await this.d.events.publish({ type: 'subscription.updated', tenantId: out.tenantId }).catch(() => undefined);
    return out;
  }

  private async applyPaidInvoice(tx: TxClient, sub: Subscription, invoice: Invoice, paidAt: Date): Promise<void> {
    const data: Prisma.SubscriptionUpdateInput = {};
    if (invoice.kind === 'UPGRADE') {
      data.plan = { connect: { id: invoice.planId } };
      data.scheduledPlan = { disconnect: true };
      await tx.subscription.update({ where: { id: sub.id }, data });
      if (sub.method === 'CARD' && sub.mpPreapprovalId) {
        const plan = await tx.plan.findUniqueOrThrow({ where: { id: invoice.planId } });
        // Atualiza o valor recorrente do cartão (plano + totens) para as próximas competências.
        await updatePreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId, {
          auto_recurring: { transaction_amount: Number(centsToDecimalString(subscriptionMonthlyCents(plan, sub.totemQuantity) - sub.cardCreditCents)), currency_id: 'BRL' },
        }).catch((err) => this.d.logger.error({ err: (err as Error).message, subId: sub.id }, 'falha ao atualizar valor do cartão'));
      }
      return;
    }

    // INITIAL / RENEWAL
    let start: Date;
    if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > paidAt.getTime()) {
      start = sub.currentPeriodEnd; // pagamento antecipado: ciclo contínuo
    } else {
      start = paidAt; // inicial ou reativação após suspensão
    }
    data.status = 'ACTIVE';
    data.method = invoice.method;
    data.startedAt = sub.startedAt ?? paidAt;
    data.currentPeriodStart = start;
    data.currentPeriodEnd = addMonthsUtc(start, 1);
    data.plan = { connect: { id: invoice.planId } };
    if (sub.scheduledPlanId && sub.scheduledPlanId === invoice.planId) data.scheduledPlan = { disconnect: true };
    // Reserva do cartão consumida nesta cobrança, ou abandonada porque a assinatura foi paga por Pix.
    if (invoice.creditAppliedCents > 0 || invoice.method === 'PIX') data.cardCreditCents = 0;
    await tx.subscription.update({ where: { id: sub.id }, data });
    await tx.tenant.update({ where: { id: sub.tenantId }, data: { status: 'ACTIVE', suspendedReason: null } });
  }

  /** Assinatura por cartão: consulta preapproval e pagamentos autorizados (sem webhook). */
  async pollPreapproval(subscriptionId: string): Promise<void> {
    const sub = await this.d.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true, scheduledPlan: true } });
    if (!sub.mpPreapprovalId) return;
    const token = this.platformToken();
    const pre = await getPreapproval(this.d.mpApi, token, sub.mpPreapprovalId);
    await this.d.prisma.subscription.update({
      where: { id: sub.id },
      data: { preapprovalStatus: pre.status ?? null, lastPolledAt: new Date(), nextPollAt: new Date(Date.now() + (sub.status === 'PENDING' ? 30_000 : 15 * 60_000)) },
    });

    const list = await searchAuthorizedPayments(this.d.mpApi, token, sub.mpPreapprovalId);
    // Valores aceitos: plano (e plano agendado) com 0..N totens — a quantidade pode ter mudado após a cobrança.
    const scheduledAmounts = new Set(sub.scheduledPlan ? acceptedMonthlyAmounts(sub.scheduledPlan, sub.totemQuantity) : []);
    const allowedAmounts = new Set([...acceptedMonthlyAmounts(sub.plan, sub.totemQuantity), ...scheduledAmounts]);
    for (const ap of list.results ?? []) {
      const approved = ap.status === 'processed' && ap.payment?.status === 'approved';
      const amount = tryDecimalStringToCents(ap.transaction_amount);
      if (!approved || amount === null || (ap.currency_id && ap.currency_id !== 'BRL')) continue;
      const reference = `ap_${ap.id}`;
      const exists = await this.d.prisma.invoice.findUnique({ where: { providerReference: reference } });
      if (exists) continue;
      const fresh = await this.d.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      // Cobrança com crédito de indicação: veio reduzida exatamente no valor reservado no cartão.
      const reserved = fresh.cardCreditCents;
      const discounted = reserved > 0 && allowedAmounts.has(amount + reserved) && (!allowedAmounts.has(amount) || amount + reserved === subscriptionMonthlyCents(sub.plan, sub.totemQuantity));
      const credit = discounted ? reserved : 0;
      const gross = amount + credit;
      if (!allowedAmounts.has(gross)) continue;
      const currentAmounts = new Set(acceptedMonthlyAmounts(sub.plan, sub.totemQuantity));
      const planId = sub.scheduledPlan && scheduledAmounts.has(gross) && !currentAmounts.has(gross) ? sub.scheduledPlan.id : sub.planId;
      const paidAt = parsePaidAt(ap.debit_date ?? ap.date_created ?? null);
      const invoice = await this.d.prisma.invoice.create({
        data: {
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          kind: fresh.startedAt ? 'RENEWAL' : 'INITIAL',
          planId,
          method: 'CARD',
          amountCents: amount,
          creditAppliedCents: credit,
          dueAt: fresh.currentPeriodEnd ?? paidAt,
          providerReference: reference,
          providerStatus: ap.status ?? null,
          externalReference: this.newExternalReference(),
        },
      });
      await this.markInvoicePaid(invoice.id, paidAt, 'processed');
      if (credit > 0) await this.restoreCardAmount(sub.id);
    }

    if (pre.status === 'cancelled' && !sub.cancelAtPeriodEnd && sub.status === 'ACTIVE') {
      // Cancelamento feito fora do AdapterPay: sem renovação; acesso até o fim do período pago.
      await this.d.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
      await createNotification(this.d.prisma, this.d.events, {
        tenantId: sub.tenantId,
        kind: 'subscription.card_cancelled',
        title: 'Assinatura no cartão cancelada',
        body: 'A recorrência no cartão foi cancelada. O acesso continua até o fim do período pago.',
        link: '/app/assinatura',
      });
    }
  }

  // ---------------------------------------------------------------- ciclo

  /** Emite faturas Pix de renovação e prepara downgrade de cartão próximo ao vencimento. */
  async issueRenewals(now = new Date()): Promise<number> {
    const horizon = addDays(now, this.d.config.BILLING_RENEWAL_LEAD_DAYS);
    const subs = await this.d.prisma.subscription.findMany({
      where: { status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: { lte: horizon, gt: now } },
      include: { plan: true, scheduledPlan: true },
      take: 200,
    });
    let issued = 0;
    for (const sub of subs) {
      const targetPlan = await this.resolveRenewalPlan(sub.tenantId, sub);
      if (sub.method === 'CARD') {
        if (!sub.mpPreapprovalId) continue;
        const monthly = subscriptionMonthlyCents(targetPlan, sub.totemQuantity);
        const downgrade = !!sub.scheduledPlan && targetPlan.id === sub.scheduledPlan.id;
        // Crédito de indicação: reduz o valor da próxima cobrança do cartão (uma reserva por ciclo).
        const credit = sub.cardCreditCents > 0 ? sub.cardCreditCents : await this.reserveCardCredit(sub.id, sub.tenantId, monthly);
        if (downgrade || credit !== sub.cardCreditCents) {
          await updatePreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId, {
            auto_recurring: { transaction_amount: Number(centsToDecimalString(monthly - credit)), currency_id: 'BRL' },
          }).catch(async (err) => {
            this.d.logger.error({ err: (err as Error).message, subId: sub.id }, 'falha ao atualizar valor do cartão na renovação');
            // Sem o valor reduzido no cartão, a reserva é desfeita: o crédito continua no saldo.
            if (credit !== sub.cardCreditCents) await this.d.prisma.subscription.update({ where: { id: sub.id }, data: { cardCreditCents: 0 } });
          });
        }
        continue;
      }
      const exists = await this.d.prisma.invoice.findFirst({
        where: { subscriptionId: sub.id, kind: 'RENEWAL', dueAt: sub.currentPeriodEnd!, status: { in: ['OPEN', 'PAID'] } },
      });
      if (exists) continue;
      await this.d.prisma.$transaction(async (tx) => {
        await lockTenant(tx, sub.tenantId);
        const monthly = subscriptionMonthlyCents(targetPlan, sub.totemQuantity);
        const discount = creditDiscountCents(monthly, await availableCreditCents(tx, sub.tenantId));
        await tx.invoice.create({
          data: {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            kind: 'RENEWAL',
            planId: targetPlan.id,
            method: 'PIX',
            amountCents: monthly - discount,
            creditAppliedCents: discount,
            dueAt: sub.currentPeriodEnd!,
            periodStart: sub.currentPeriodEnd!,
            periodEnd: addMonthsUtc(sub.currentPeriodEnd!, 1),
            externalReference: this.newExternalReference(),
          },
        });
      });
      await createNotification(this.d.prisma, this.d.events, {
        tenantId: sub.tenantId,
        kind: 'invoice.issued',
        title: 'Fatura de renovação disponível',
        body: `Pague a fatura por Pix até ${formatInTimezone(sub.currentPeriodEnd!, this.d.config.BILLING_DISPLAY_TIMEZONE)} (horário de Brasília). Após o vencimento, novas cobranças ficam bloqueadas.`,
        link: '/app/assinatura',
      });
      issued++;
    }
    return issued;
  }

  /** Reserva crédito para a próxima cobrança do cartão. Devolve o desconto reservado (0 se não houver saldo). */
  private async reserveCardCredit(subscriptionId: string, tenantId: string, monthlyCents: number): Promise<number> {
    return this.d.prisma.$transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      const fresh = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { cardCreditCents: true } });
      if (fresh.cardCreditCents > 0) return fresh.cardCreditCents;
      const discount = creditDiscountCents(monthlyCents, await availableCreditCents(tx, tenantId));
      if (discount > 0) await tx.subscription.update({ where: { id: subscriptionId }, data: { cardCreditCents: discount } });
      return discount;
    });
  }

  /** Depois da cobrança com crédito, o cartão volta a cobrar o valor cheio. */
  private async restoreCardAmount(subscriptionId: string): Promise<void> {
    const sub = await this.d.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub.mpPreapprovalId || sub.cardCreditCents > 0) return;
    await updatePreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId, {
      auto_recurring: { transaction_amount: Number(centsToDecimalString(subscriptionMonthlyCents(sub.plan, sub.totemQuantity))), currency_id: 'BRL' },
    }).catch(async (err) => {
      this.d.logger.error({ err: (err as Error).message, subId: sub.id }, 'falha ao restaurar valor do cartão após crédito');
      await createNotification(this.d.prisma, this.d.events, {
        tenantId: sub.tenantId,
        kind: 'subscription.card_amount_failed',
        title: 'Valor da assinatura no cartão não atualizado',
        body: 'O crédito de indicação foi usado, mas não foi possível voltar o valor do cartão ao normal. A equipe Adapter Co. foi avisada pelos registros.',
        link: '/app/assinatura',
      });
    });
  }

  private async resolveRenewalPlan(
    tenantId: string,
    sub: Subscription & {
      plan: { id: string; priceCents: number; totemPriceCents: number | null };
      scheduledPlan: { id: string; priceCents: number; totemPriceCents: number | null; maxPos: number; maxStores: number; maxUsers: number } | null;
    },
  ): Promise<{ id: string; priceCents: number; totemPriceCents: number | null }> {
    if (!sub.scheduledPlan) return sub.plan;
    const usage = await this.d.prisma.$transaction((tx) => getUsage(tx, tenantId));
    const excess = excessForPlan(sub.scheduledPlan, usage);
    const totemsBlocked = sub.totemQuantity > 0 && sub.scheduledPlan.totemPriceCents === null;
    if (excess.length === 0 && !totemsBlocked) return sub.scheduledPlan;
    await createNotification(this.d.prisma, this.d.events, {
      tenantId,
      kind: 'subscription.downgrade_blocked',
      title: 'Downgrade não aplicado',
      body: 'O uso atual excede os limites do plano escolhido. Desative POS, lojas ou usuários excedentes para concluir o downgrade.',
      link: '/app/assinatura',
    });
    return sub.plan;
  }

  /** Tolerância zero: suspende tenants com fatura vencida após verificação final no provedor. */
  async enforceOverdue(now = new Date()): Promise<number> {
    let suspended = 0;
    // Pix: faturas de renovação vencidas.
    const overdue = await this.d.prisma.invoice.findMany({
      where: { status: 'OPEN', kind: { in: ['RENEWAL'] }, dueAt: { lte: now } },
      take: 200,
    });
    for (const inv of overdue) {
      const checked = inv.providerReference ? await this.pollInvoice(inv.id) : inv;
      if (checked.status !== 'OPEN') continue;
      if (await this.suspend(inv.tenantId, 'INVOICE_OVERDUE')) suspended++;
    }
    // Assinaturas ativas cujo período terminou sem renovação registrada (cartão ou Pix sem fatura).
    const lapsed = await this.d.prisma.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lte: now }, cancelAtPeriodEnd: false },
      take: 200,
    });
    for (const sub of lapsed) {
      if (sub.method === 'CARD' && sub.mpPreapprovalId) {
        await this.pollPreapproval(sub.id).catch((err) => this.d.logger.warn({ err: (err as Error).message }, 'verificação final do cartão falhou'));
        const fresh = await this.d.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
        if (fresh.currentPeriodEnd && fresh.currentPeriodEnd > now) continue;
      }
      if (await this.suspend(sub.tenantId, 'PERIOD_ENDED_UNPAID')) suspended++;
    }
    return suspended;
  }

  private async suspend(tenantId: string, reason: string): Promise<boolean> {
    const changed = await this.d.prisma.$transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub || sub.status !== 'ACTIVE') return false;
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED', suspendedReason: reason } });
      await writeAudit(tx, {
        tenantId,
        actorType: 'WORKER',
        resourceType: 'subscription',
        resourceId: sub.id,
        action: 'subscription.suspended',
        after: { reason },
      });
      await createNotification(tx, null, {
        tenantId,
        kind: 'subscription.suspended',
        title: 'Assinatura suspensa por falta de pagamento',
        body: 'Novas cobranças e ativação de POS estão bloqueadas. Histórico, faturas e conciliação continuam disponíveis. Pague a fatura para reativar.',
        link: '/app/assinatura',
      });
      return true;
    });
    if (changed) await this.d.events.publish({ type: 'subscription.updated', tenantId }).catch(() => undefined);
    return changed;
  }

  /** Encerra assinaturas canceladas ao fim do período pago. */
  async finalizeCancellations(now = new Date()): Promise<number> {
    const subs = await this.d.prisma.subscription.findMany({
      where: { cancelAtPeriodEnd: true, status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { lte: now } },
      take: 200,
    });
    for (const sub of subs) {
      await this.d.prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELED', canceledAt: now } });
        await tx.tenant.update({ where: { id: sub.tenantId }, data: { status: 'CANCELED' } });
        await tx.invoice.updateMany({ where: { subscriptionId: sub.id, status: 'OPEN', providerReference: null }, data: { status: 'VOID' } });
        await writeAudit(tx, { tenantId: sub.tenantId, actorType: 'WORKER', resourceType: 'subscription', resourceId: sub.id, action: 'subscription.canceled' });
      });
    }
    // Faturas de upgrade não pagas no prazo são anuladas (não suspendem o tenant).
    await this.d.prisma.invoice.updateMany({
      where: { status: 'OPEN', kind: 'UPGRADE', dueAt: { lte: now }, providerStatus: { not: 'approved' } },
      data: { status: 'VOID' },
    });
    // Faturas iniciais vencidas sem pagamento.
    await this.d.prisma.invoice.updateMany({
      where: { status: 'OPEN', kind: 'INITIAL', dueAt: { lte: now }, providerReference: null },
      data: { status: 'VOID' },
    });
    return subs.length;
  }

  // ---------------------------------------------------------------- mudanças de plano

  async requestUpgrade(params: { tenantId: string; targetPlanId: string; payerEmail: string; actorUserId: string }): Promise<Invoice> {
    const { tenantId, targetPlanId } = params;
    const sub = await this.d.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub || sub.status !== 'ACTIVE' || !sub.currentPeriodStart || !sub.currentPeriodEnd) {
      throw new BillingError('SUBSCRIPTION_INACTIVE', 'Upgrade exige assinatura ativa');
    }
    const target = await this.d.prisma.plan.findFirst({ where: { id: targetPlanId, active: true } });
    if (!target) throw new BillingError('PLAN_NOT_FOUND', 'Plano indisponível');
    if (target.priceCents <= sub.plan.priceCents) throw new BillingError('NOT_UPGRADE', 'Use downgrade para planos de menor valor');
    const amount = prorataUpgradeCents({
      currentPriceCents: sub.plan.priceCents,
      targetPriceCents: target.priceCents,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now: new Date(),
    });
    if (amount <= 0) throw new BillingError('PERIOD_ENDING', 'O período atual está terminando; contrate o novo plano na renovação');
    await this.d.prisma.invoice.updateMany({
      where: { subscriptionId: sub.id, kind: 'UPGRADE', status: 'OPEN', providerReference: null },
      data: { status: 'VOID' },
    });
    const invoice = await this.d.prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: sub.id,
        kind: 'UPGRADE',
        planId: target.id,
        method: 'PIX',
        amountCents: amount,
        dueAt: addDays(new Date(), UPGRADE_INVOICE_TTL_DAYS),
        externalReference: this.newExternalReference(),
      },
    });
    await writeAudit(this.d.prisma, {
      tenantId,
      actorUserId: params.actorUserId,
      actorType: 'USER',
      resourceType: 'subscription',
      resourceId: sub.id,
      action: 'subscription.upgrade_requested',
      after: { from: sub.planId, to: target.id, prorataCents: amount },
    });
    return this.ensurePixForInvoice(invoice.id, params.payerEmail);
  }

  async scheduleDowngrade(params: { tenantId: string; targetPlanId: string; actorUserId: string }): Promise<Subscription> {
    const sub = await this.d.prisma.subscription.findUnique({ where: { tenantId: params.tenantId }, include: { plan: true } });
    if (!sub || sub.status !== 'ACTIVE') throw new BillingError('SUBSCRIPTION_INACTIVE', 'Downgrade exige assinatura ativa');
    const target = await this.d.prisma.plan.findFirst({ where: { id: params.targetPlanId, active: true } });
    if (!target) throw new BillingError('PLAN_NOT_FOUND', 'Plano indisponível');
    if (target.priceCents >= sub.plan.priceCents) throw new BillingError('NOT_DOWNGRADE', 'Use upgrade para planos de maior valor');
    const usage = await this.d.prisma.$transaction((tx) => getUsage(tx, params.tenantId));
    const excess = excessForPlan(target, usage);
    if (excess.length > 0) {
      throw new BillingError('PLAN_DOWNGRADE_EXCESS', 'Desative os itens excedentes antes do downgrade', excess);
    }
    if (sub.totemQuantity > 0 && target.totemPriceCents === null) {
      throw new BillingError('PLAN_DOWNGRADE_EXCESS', 'O plano escolhido não inclui totens. Desative os totens antes do downgrade.');
    }
    const updated = await this.d.prisma.subscription.update({ where: { id: sub.id }, data: { scheduledPlanId: target.id } });
    await writeAudit(this.d.prisma, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorType: 'USER',
      resourceType: 'subscription',
      resourceId: sub.id,
      action: 'subscription.downgrade_scheduled',
      after: { from: sub.planId, to: target.id, effectiveAt: sub.currentPeriodEnd },
    });
    return updated;
  }

  /**
   * Quantidade de totens contratados. Política: o adicional passa a valer na próxima renovação
   * (sem cobrança pró-rata). Cartão: atualiza o valor recorrente. Pix: a fatura de renovação ainda
   * sem QR gerado é anulada e reemitida com o valor novo pelo ciclo de faturamento.
   */
  async setTotemQuantity(tenantId: string, quantity: number): Promise<void> {
    const sub = await this.d.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) throw new BillingError('SUBSCRIPTION_INACTIVE', 'Assinatura não encontrada');
    if (sub.totemQuantity === quantity) return;
    await this.d.prisma.subscription.update({ where: { id: sub.id }, data: { totemQuantity: Math.max(0, quantity) } });
    await this.d.prisma.invoice.updateMany({
      where: { subscriptionId: sub.id, status: 'OPEN', kind: 'RENEWAL', providerReference: null },
      data: { status: 'VOID' },
    });
    if (sub.method === 'CARD' && sub.mpPreapprovalId && sub.status === 'ACTIVE') {
      await updatePreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId, {
        auto_recurring: { transaction_amount: Number(centsToDecimalString(subscriptionMonthlyCents(sub.plan, quantity) - sub.cardCreditCents)), currency_id: 'BRL' },
      }).catch(async (err) => {
        this.d.logger.error({ err: (err as Error).message, subId: sub.id }, 'falha ao atualizar valor do cartão (totens)');
        await createNotification(this.d.prisma, this.d.events, {
          tenantId,
          kind: 'subscription.card_amount_failed',
          title: 'Valor da assinatura no cartão não atualizado',
          body: 'Não foi possível atualizar o valor do cartão após mudar a quantidade de totens. A equipe Adapter Co. foi avisada pelos registros.',
          link: '/app/assinatura',
        });
      });
    }
  }

  async cancel(params: { tenantId: string; actorUserId: string }): Promise<Subscription> {
    const sub = await this.d.prisma.subscription.findUnique({ where: { tenantId: params.tenantId } });
    if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) {
      throw new BillingError('SUBSCRIPTION_INACTIVE', 'Não há assinatura ativa para cancelar');
    }
    if (sub.method === 'CARD' && sub.mpPreapprovalId) {
      await updatePreapproval(this.d.mpApi, this.platformToken(), sub.mpPreapprovalId, { status: 'cancelled' });
    }
    const updated = await this.d.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, scheduledPlanId: null },
    });
    await this.d.prisma.invoice.updateMany({
      where: { subscriptionId: sub.id, status: 'OPEN', kind: 'RENEWAL', providerReference: null },
      data: { status: 'VOID' },
    });
    await writeAudit(this.d.prisma, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorType: 'USER',
      resourceType: 'subscription',
      resourceId: sub.id,
      action: 'subscription.cancel_requested',
      after: { effectiveAt: sub.currentPeriodEnd },
    });
    return updated;
  }
}

function isApprovedPaymentFor(payment: MpPayment, invoice: Invoice): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (payment.status !== 'approved') reasons.push(`STATUS_${payment.status ?? 'none'}`);
  if (payment.status_detail && payment.status_detail !== 'accredited') reasons.push(`DETAIL_${payment.status_detail}`);
  if (payment.currency_id !== 'BRL') reasons.push('CURRENCY');
  if (payment.external_reference !== invoice.externalReference) reasons.push('EXTERNAL_REFERENCE');
  if (tryDecimalStringToCents(payment.transaction_amount) !== invoice.amountCents) reasons.push('AMOUNT');
  if (String(payment.id) !== invoice.providerReference) reasons.push('PAYMENT_ID');
  return { ok: reasons.length === 0, reasons };
}

function parsePaidAt(v: string | null | undefined): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function nextInvoicePollMs(invoice: Invoice): number {
  const age = Date.now() - (invoice.lastAttemptAt?.getTime() ?? invoice.createdAt.getTime());
  return age < 10 * 60_000 ? 10_000 : 60_000;
}
