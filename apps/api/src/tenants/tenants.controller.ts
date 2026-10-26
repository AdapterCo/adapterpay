import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { isWhatsAppConfigured, sendDailyClosingTest, WhatsAppError, writeAudit, type CoreDeps } from '@adapterpay/core';
import { ERROR_CODES, tenantSettingsSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { Critical, RequirePermission } from '../auth/decorators';
import { AppError, Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

function maskTaxId(taxId: string): string {
  if (taxId.length === 14) return `${taxId.slice(0, 2)}.***.***/${taxId.slice(8, 12)}-**`;
  if (taxId.length === 11) return `***.${taxId.slice(3, 6)}.***-**`;
  return '***';
}

@ApiTags('tenant')
@Controller()
export class TenantsController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get('settings')
  async getSettings(@CurrentAuth() auth: AuthContext) {
    const t = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: requireTenant(auth) } });
    return {
      legalName: t.legalName,
      tradeName: t.tradeName,
      taxIdMasked: maskTaxId(this.deps.encryptor.decrypt(t.taxIdEnc)),
      timezone: t.timezone,
      logoUrl: t.logoUrl,
      brandColor: t.brandColor,
      fiscalAddress: t.fiscalAddress,
      allowSellerCancel: t.allowSellerCancel,
      requireAdminMfa: t.requireAdminMfa,
      status: t.status,
      savingsPosRateBps: t.savingsPosRateBps,
      savingsLinkRateBps: t.savingsLinkRateBps,
      dailyReportEnabled: t.dailyReportEnabled,
      dailyReportPhone: t.dailyReportPhone,
      dailyReportHour: t.dailyReportHour,
      loyaltyMode: t.loyaltyMode,
      loyaltyCashbackBps: t.loyaltyCashbackBps,
      loyaltyGiftEvery: t.loyaltyGiftEvery,
      loyaltyGiftName: t.loyaltyGiftName,
      loyaltyMinPurchaseCents: t.loyaltyMinPurchaseCents,
      googleReviewUrl: t.googleReviewUrl,
      restaurantMode: t.restaurantMode,
      whatsappAvailable: isWhatsAppConfigured(this.deps.config),
      lastDailyReport: await this.deps.prisma.dailyReport.findFirst({
        where: { tenantId: t.id },
        orderBy: { createdAt: 'desc' },
        select: { day: true, status: true, sentAt: true, lastError: true },
      }),
    };
  }

  /** Envia agora o fechamento do dia (parcial) para o WhatsApp salvo, para conferir o formato. */
  @Post('settings/daily-report/test')
  @HttpCode(204)
  @RequirePermission('settings:manage')
  @RateLimit({ key: 'daily-report-test', limit: 5, windowSec: 600, by: 'user' })
  async testDailyReport(@CurrentAuth() auth: AuthContext): Promise<void> {
    const tenantId = requireTenant(auth);
    if (!isWhatsAppConfigured(this.deps.config)) throw Errors.validation('Envio por WhatsApp indisponível no momento. Avise o suporte da Adapter Co.');
    const t = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { dailyReportPhone: true } });
    if (!t.dailyReportPhone) throw Errors.validation('Salve um número de WhatsApp antes de enviar o teste');
    try {
      await sendDailyClosingTest(this.deps, tenantId, t.dailyReportPhone);
    } catch (err) {
      if (err instanceof WhatsAppError) {
        throw new AppError(502, ERROR_CODES.INTERNAL, 'Não foi possível enviar pelo WhatsApp. Confira o número e tente de novo.');
      }
      throw err;
    }
  }

  @Patch('settings')
  @Critical()
  @RequirePermission('settings:manage')
  @ApiZodBody(tenantSettingsSchema)
  async updateSettings(
    @CurrentAuth() auth: AuthContext,
    @ZBody(tenantSettingsSchema) body: z.infer<typeof tenantSettingsSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const tenantId = requireTenant(auth);
    if (body.requireAdminMfa && !auth.mfaEnabled) {
      throw Errors.validation('Ative o MFA na sua conta antes de exigir MFA dos administradores');
    }
    const before = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const phone = body.dailyReportPhone === undefined ? before.dailyReportPhone : body.dailyReportPhone;
    if ((body.dailyReportEnabled ?? before.dailyReportEnabled) && !phone) {
      throw Errors.validation('Informe o WhatsApp que vai receber o fechamento de caixa');
    }
    const after = await this.deps.prisma.tenant.update({ where: { id: tenantId }, data: body });
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'tenant',
      resourceId: tenantId,
      action: 'tenant.settings_updated',
      before: pick(before, Object.keys(body)),
      after: pick(after, Object.keys(body)),
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true };
  }

  @Get('notifications')
  async notifications(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const where = {
      tenantId,
      OR: auth.role === 'ADMIN' ? [{ userId: null }, { userId: auth.userId }] : [{ userId: auth.userId }],
    };
    const [items, unread] = await Promise.all([
      this.deps.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.deps.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unread };
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deps.prisma.notification.updateMany({
      where: { id, tenantId: requireTenant(auth), OR: [{ userId: null }, { userId: auth.userId }] },
      data: { readAt: new Date() },
    });
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async markAllRead(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.deps.prisma.notification.updateMany({
      where: {
        tenantId: requireTenant(auth),
        readAt: null,
        OR: auth.role === 'ADMIN' ? [{ userId: null }, { userId: auth.userId }] : [{ userId: auth.userId }],
      },
      data: { readAt: new Date() },
    });
  }

  /** Wizard: conectar MP -> lojas -> POS -> QR público -> primeira cobrança. */
  @Get('onboarding')
  async onboarding(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const [tenant, conn, stores, pos, readyPos, charges] = await Promise.all([
      this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { subscription: true } }),
      this.deps.prisma.mpConnection.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.deps.prisma.store.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.deps.prisma.posTerminal.count({ where: { tenantId } }),
      this.deps.prisma.posTerminal.count({ where: { tenantId, status: 'ACTIVE', qrCode: { not: null } } }),
      this.deps.prisma.charge.count({ where: { tenantId } }),
    ]);
    return {
      subscriptionActive: tenant.subscription?.status === 'ACTIVE',
      steps: [
        { key: 'subscription', done: tenant.subscription?.status === 'ACTIVE', href: '/app/assinatura' },
        { key: 'mercado_pago', done: conn > 0, href: '/app/integracoes/mercado-pago' },
        { key: 'stores', done: stores > 0, href: '/app/lojas' },
        { key: 'pos', done: pos > 0, href: '/app/pos' },
        { key: 'public_qr', done: readyPos > 0, href: '/app/pos' },
        { key: 'first_charge', done: charges > 0, href: '/app/cobrancas/nova' },
      ],
    };
  }

  /** Exportação LGPD dos dados do tenant (sem credenciais). */
  @Get('privacy/export')
  @Critical()
  @RequirePermission('settings:manage')
  async exportTenantData(@CurrentAuth() auth: AuthContext, @Meta() meta: RequestMeta) {
    const tenantId = requireTenant(auth);
    const [tenant, users, stores, pos, charges, invoices] = await Promise.all([
      this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.deps.prisma.tenantMembership.findMany({
        where: { tenantId },
        include: { user: { select: { id: true, email: true, name: true, status: true, createdAt: true } } },
      }),
      this.deps.prisma.store.findMany({ where: { tenantId } }),
      this.deps.prisma.posTerminal.findMany({
        where: { tenantId },
        select: { id: true, name: true, storeId: true, mpPosId: true, externalId: true, status: true, createdAt: true },
      }),
      this.deps.prisma.charge.findMany({ where: { tenantId }, include: { payments: true }, orderBy: { createdAt: 'desc' }, take: 50_000 }),
      this.deps.prisma.invoice.findMany({ where: { tenantId }, select: { id: true, kind: true, amountCents: true, status: true, dueAt: true, paidAt: true } }),
    ]);
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'tenant',
      resourceId: tenantId,
      action: 'privacy.export',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return {
      exportedAt: new Date().toISOString(),
      tenant: { ...tenant, taxIdEnc: undefined, taxIdHash: undefined, taxId: this.deps.encryptor.decrypt(tenant.taxIdEnc) },
      users: users.map((m) => ({ ...m.user, role: m.role, membershipStatus: m.status })),
      stores,
      pos,
      charges,
      invoices,
    };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
