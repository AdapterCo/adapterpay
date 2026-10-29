import { Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingService, getUsage, type CoreDeps } from '@adapterpay/core';
import { changePlanSchema, checkoutSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { Critical, RequirePermission } from '../auth/decorators';
import { Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, requireTenant, type AuthContext } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly billing: BillingService,
  ) {}

  /** Contratação/reativação. Permitido com tenant pendente ou suspenso (não exige plano ativo). */
  @Post('checkout')
  @RequirePermission('subscription:manage')
  @RateLimit({ key: 'checkout', limit: 10, windowSec: 600, by: 'user' })
  @ApiZodBody(checkoutSchema)
  async checkout(@CurrentAuth() auth: AuthContext, @ZBody(checkoutSchema) body: z.infer<typeof checkoutSchema>) {
    return this.billing.startCheckout({
      tenantId: requireTenant(auth),
      planId: body.planId,
      method: body.method,
      payerEmail: auth.email,
      actorUserId: auth.userId,
    });
  }

  @Get('current')
  @RequirePermission('subscription:read')
  async current(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const sub = await this.deps.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true, scheduledPlan: true },
    });
    const usage = await this.deps.prisma.$transaction((tx) => getUsage(tx, tenantId));
    const openInvoices = await this.deps.prisma.invoice.findMany({
      where: { tenantId, status: 'OPEN' },
      orderBy: { dueAt: 'asc' },
    });
    const tenant = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, suspendedReason: true, billingCreditCents: true } });
    return {
      tenantStatus: tenant.status,
      suspendedReason: tenant.suspendedReason,
      creditCents: tenant.billingCreditCents,
      subscription: sub && {
        id: sub.id,
        status: sub.status,
        method: sub.method,
        plan: sub.plan,
        scheduledPlan: sub.scheduledPlan,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        preapprovalStatus: sub.preapprovalStatus,
        totemQuantity: sub.totemQuantity,
      },
      usage,
      limits: sub ? { pos: sub.plan.maxPos, stores: sub.plan.maxStores, users: sub.plan.maxUsers } : null,
      openInvoices: openInvoices.map((i) => this.invoiceView(i)),
      billingTimezone: this.deps.config.BILLING_DISPLAY_TIMEZONE,
    };
  }

  @Get('invoices')
  @RequirePermission('subscription:read')
  async invoices(@CurrentAuth() auth: AuthContext) {
    const items = await this.deps.prisma.invoice.findMany({
      where: { tenantId: requireTenant(auth) },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((i) => ({ ...this.invoiceView(i), planName: i.plan.name }));
  }

  /** Consulta o status da fatura no provedor (polling sob demanda, com limite de taxa). */
  @Get('invoices/:id/status')
  @RequirePermission('subscription:read')
  @RateLimit({ key: 'invoice-status', limit: 40, windowSec: 60, by: 'user' })
  async invoiceStatus(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.deps.prisma.invoice.findFirst({ where: { id, tenantId: requireTenant(auth) } });
    if (!inv) throw Errors.notFound('Fatura');
    const fresh = inv.status === 'OPEN' && inv.method === 'PIX' && inv.providerReference ? await this.billing.pollInvoice(inv.id) : inv;
    return this.invoiceView(fresh);
  }

  /** Gera (ou renova) o Pix da fatura. */
  @Post('invoices/:id/pix')
  @RequirePermission('subscription:manage')
  @RateLimit({ key: 'invoice-pix', limit: 10, windowSec: 600, by: 'user' })
  async invoicePix(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.deps.prisma.invoice.findFirst({ where: { id, tenantId: requireTenant(auth) } });
    if (!inv) throw Errors.notFound('Fatura');
    return this.invoiceView(await this.billing.ensurePixForInvoice(inv.id, auth.email));
  }

  /** Força a consulta da assinatura de cartão (usado em /assinatura/retorno). */
  @Post('card/refresh')
  @RequirePermission('subscription:read')
  @RateLimit({ key: 'card-refresh', limit: 20, windowSec: 600, by: 'user' })
  async cardRefresh(@CurrentAuth() auth: AuthContext) {
    const sub = await this.deps.prisma.subscription.findUnique({ where: { tenantId: requireTenant(auth) } });
    if (!sub?.mpPreapprovalId) throw Errors.notFound('Assinatura de cartão');
    await this.billing.pollPreapproval(sub.id);
    const fresh = await this.deps.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    return { status: fresh.status, preapprovalStatus: fresh.preapprovalStatus };
  }

  @Post('change-plan')
  @Critical()
  @RequirePermission('subscription:manage')
  @ApiZodBody(changePlanSchema)
  async changePlan(@CurrentAuth() auth: AuthContext, @ZBody(changePlanSchema) body: z.infer<typeof changePlanSchema>) {
    const tenantId = requireTenant(auth);
    const sub = await this.deps.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const target = await this.deps.prisma.plan.findFirst({ where: { id: body.planId, active: true } });
    if (!sub || !target) throw Errors.notFound('Plano');
    if (target.id === sub.planId) {
      // Cancela downgrade agendado, se houver.
      await this.deps.prisma.subscription.update({ where: { id: sub.id }, data: { scheduledPlanId: null } });
      return { kind: 'unchanged' };
    }
    if (target.priceCents > sub.plan.priceCents) {
      const invoice = await this.billing.requestUpgrade({ tenantId, targetPlanId: target.id, payerEmail: auth.email, actorUserId: auth.userId });
      return { kind: 'upgrade', invoice: this.invoiceView(invoice) };
    }
    const updated = await this.billing.scheduleDowngrade({ tenantId, targetPlanId: target.id, actorUserId: auth.userId });
    return { kind: 'downgrade', effectiveAt: updated.currentPeriodEnd };
  }

  @Post('cancel')
  @Critical()
  @RequirePermission('subscription:manage')
  async cancel(@CurrentAuth() auth: AuthContext) {
    const sub = await this.billing.cancel({ tenantId: requireTenant(auth), actorUserId: auth.userId });
    return { cancelAtPeriodEnd: sub.cancelAtPeriodEnd, accessUntil: sub.currentPeriodEnd };
  }

  private invoiceView(i: {
    id: string;
    kind: string;
    status: string;
    method: string;
    amountCents: number;
    creditAppliedCents: number;
    dueAt: Date;
    paidAt: Date | null;
    pixQrCode: string | null;
    pixQrBase64: string | null;
    pixExpiresAt: Date | null;
    providerStatus: string | null;
    planId: string;
  }) {
    const pixActive = i.status === 'OPEN' && !!i.pixQrCode && !!i.pixExpiresAt && i.pixExpiresAt.getTime() > Date.now();
    return {
      id: i.id,
      kind: i.kind,
      status: i.status,
      method: i.method,
      planId: i.planId,
      amountCents: i.amountCents,
      creditAppliedCents: i.creditAppliedCents,
      dueAt: i.dueAt,
      paidAt: i.paidAt,
      providerStatus: i.providerStatus,
      pix: pixActive ? { qrCode: i.pixQrCode, qrBase64: i.pixQrBase64, expiresAt: i.pixExpiresAt } : null,
    };
  }
}
