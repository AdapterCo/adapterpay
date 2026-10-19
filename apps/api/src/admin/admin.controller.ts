import { Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getUsage, writeAudit, type CoreDeps } from '@adapterpay/core';
import { adminTenantActionSchema } from '@adapterpay/shared';
import { z } from 'zod';
import { NoTenant, Superadmin } from '../auth/decorators';
import { Errors } from '../common/errors';
import { QueueService } from '../common/queue.service';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ZBody, ZQuery } from '../common/zod';
import { OperationsService } from './operations.service';

const tenantsQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CANCELED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const planUpdate = z.object({
  priceCents: z.number().int().positive().max(10_000_000).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500),
});

/** Área da equipe Adapter Co. MFA obrigatório; toda ação sensível é auditada; tokens nunca expostos. */
@ApiTags('admin')
@NoTenant()
@Superadmin()
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly ops: OperationsService,
    private readonly queue: QueueService,
  ) {}

  @Get('tenants')
  async tenants(@ZQuery(tenantsQuery) q: z.infer<typeof tenantsQuery>) {
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ tradeName: { contains: q.q, mode: 'insensitive' as const } }, { legalName: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.deps.prisma.tenant.count({ where }),
      this.deps.prisma.tenant.findMany({
        where,
        include: {
          subscription: { include: { plan: { select: { name: true, maxPos: true, maxStores: true, maxUsers: true } } } },
          _count: { select: { posTerminals: true, stores: true, memberships: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
      }),
    ]);
    return {
      total,
      items: items.map((t) => ({
        id: t.id,
        tradeName: t.tradeName,
        legalName: t.legalName,
        status: t.status,
        suspendedReason: t.suspendedReason,
        createdAt: t.createdAt,
        subscription: t.subscription && {
          status: t.subscription.status,
          plan: t.subscription.plan.name,
          method: t.subscription.method,
          currentPeriodEnd: t.subscription.currentPeriodEnd,
        },
        counts: t._count,
      })),
    };
  }

  @Get('tenants/:id')
  async tenant(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.deps.prisma.tenant.findUnique({
      where: { id },
      include: {
        subscription: { include: { plan: true } },
        mpConnections: { select: { id: true, mpUserId: true, nickname: true, status: true, lastError: true, tokenExpiresAt: true } },
      },
    });
    if (!t) throw Errors.notFound('Tenant');
    const [usage, invoices, audit] = await Promise.all([
      this.deps.prisma.$transaction((tx) => getUsage(tx, id)),
      this.deps.prisma.invoice.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 24 }),
      this.deps.prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      id: t.id,
      tradeName: t.tradeName,
      legalName: t.legalName,
      status: t.status,
      suspendedReason: t.suspendedReason,
      subscription: t.subscription,
      mpConnections: t.mpConnections,
      usage,
      invoices: invoices.map((i) => ({ ...i, pixQrCode: undefined, pixQrBase64: undefined })),
      audit,
    };
  }

  @Post('tenants/:id/suspend')
  async suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(adminTenantActionSchema) body: z.infer<typeof adminTenantActionSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const t = await this.deps.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw Errors.notFound('Tenant');
    await this.deps.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED', suspendedReason: `ADMIN:${body.reason}`.slice(0, 500) } });
    await writeAudit(this.deps.prisma, {
      tenantId: id,
      actorUserId: auth.userId,
      actorType: 'SUPERADMIN',
      resourceType: 'tenant',
      resourceId: id,
      action: 'admin.tenant_suspended',
      before: { status: t.status },
      after: { status: 'SUSPENDED', reason: body.reason },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true };
  }

  @Post('tenants/:id/reactivate')
  async reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(adminTenantActionSchema) body: z.infer<typeof adminTenantActionSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const t = await this.deps.prisma.tenant.findUnique({ where: { id }, include: { subscription: true } });
    if (!t) throw Errors.notFound('Tenant');
    if (t.subscription?.status !== 'ACTIVE') throw Errors.conflict('A assinatura precisa estar ativa (paga) para reativar');
    await this.deps.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE', suspendedReason: null } });
    await writeAudit(this.deps.prisma, {
      tenantId: id,
      actorUserId: auth.userId,
      actorType: 'SUPERADMIN',
      resourceType: 'tenant',
      resourceId: id,
      action: 'admin.tenant_reactivated',
      before: { status: t.status },
      after: { status: 'ACTIVE', reason: body.reason },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true };
  }

  @Get('subscriptions')
  async subscriptions() {
    const subs = await this.deps.prisma.subscription.findMany({
      include: { plan: { select: { name: true } }, tenant: { select: { tradeName: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return subs.map((s) => ({
      id: s.id,
      tenantId: s.tenantId,
      tenant: s.tenant.tradeName,
      tenantStatus: s.tenant.status,
      plan: s.plan.name,
      status: s.status,
      method: s.method,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      preapprovalStatus: s.preapprovalStatus,
    }));
  }

  @Get('invoices')
  async invoices() {
    const items = await this.deps.prisma.invoice.findMany({
      include: { tenant: { select: { tradeName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return items.map((i) => ({
      id: i.id,
      tenant: i.tenant.tradeName,
      kind: i.kind,
      method: i.method,
      amountCents: i.amountCents,
      status: i.status,
      dueAt: i.dueAt,
      paidAt: i.paidAt,
      providerStatus: i.providerStatus,
      lastError: i.lastError,
    }));
  }

  @Get('plans')
  plans() {
    return this.deps.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Alteração de preço vale para novas faturas; faturas emitidas não mudam. */
  @Patch('plans/:id')
  async updatePlan(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZBody(planUpdate) body: z.infer<typeof planUpdate>, @Meta() meta: RequestMeta) {
    const before = await this.deps.prisma.plan.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Plano');
    const after = await this.deps.prisma.plan.update({ where: { id }, data: { priceCents: body.priceCents, active: body.active } });
    await writeAudit(this.deps.prisma, {
      actorUserId: auth.userId,
      actorType: 'SUPERADMIN',
      resourceType: 'plan',
      resourceId: id,
      action: 'admin.plan_updated',
      before: { priceCents: before.priceCents, active: before.active },
      after: { priceCents: after.priceCents, active: after.active, reason: body.reason },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return after;
  }

  @Get('operations/health')
  health() {
    return this.ops.health();
  }

  @Get('operations/oauth-failures')
  oauthFailures() {
    return this.deps.prisma.mpConnection.findMany({
      where: { status: { in: ['NEEDS_RECONNECT', 'REVOKED'] } },
      select: { id: true, tenantId: true, mpUserId: true, nickname: true, status: true, lastError: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  @Get('operations/reconciling')
  reconciling() {
    return this.deps.prisma.charge.findMany({
      where: { status: { in: ['RECONCILING', 'CREATING'] } },
      select: { id: true, tenantId: true, externalReference: true, orderId: true, status: true, statusReason: true, createdAt: true, expiresAt: true, lastPolledAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /** Suporte: força nova consulta imediata de uma cobrança (não altera estado diretamente). */
  @Post('charges/:id/repoll')
  async repoll(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const c = await this.deps.prisma.charge.findUnique({ where: { id }, select: { id: true, tenantId: true } });
    if (!c) throw Errors.notFound('Cobrança');
    await this.deps.prisma.pollingJob.updateMany({ where: { chargeId: id }, data: { done: false, nextAttemptAt: new Date(), consecutiveErrors: 0 } });
    await this.queue.enqueuePoll(id, 0);
    await writeAudit(this.deps.prisma, {
      tenantId: c.tenantId,
      actorUserId: auth.userId,
      actorType: 'SUPERADMIN',
      resourceType: 'charge',
      resourceId: id,
      action: 'admin.charge_repoll',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true };
  }

  @Get('audit')
  audit() {
    return this.deps.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
