import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  cancelPaymentLink,
  createPaymentLink,
  PaymentLinkError,
  refreshPaymentLinkIfStale,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import type { PaymentLink, Prisma } from '@adapterpay/database';
import {
  createPaymentLinkSchema,
  ERROR_CODES,
  listPaymentLinksQuerySchema,
  normalizeSearchName,
  PAYMENT_LINK_STATUSES,
  type CreatePaymentLinkInput,
  type PaymentLinkStatus,
} from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { assertStoreAccess, storeScope } from '../common/access';
import { AppError, Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';

type ListQuery = z.infer<typeof listPaymentLinksQuerySchema>;
type LinkWithNames = PaymentLink & { store: { name: string }; createdBy: { name: string } };

export function toPaymentLinkError(err: unknown): never {
  if (err instanceof PaymentLinkError) {
    switch (err.code) {
      case 'STORE_NOT_FOUND':
        throw Errors.notFound('Loja');
      case 'STORE_NOT_CONNECTED':
        throw Errors.validation(err.message);
      case 'PROVIDER_ERROR':
        throw new AppError(502, ERROR_CODES.MP_UPSTREAM_ERROR, err.message);
      case 'NOT_PENDING':
      case 'ALREADY_PAID':
        throw Errors.conflict(err.message);
    }
  }
  throw err;
}

/** Links de pagamento externos (aba "Links de pagamento" do painel). */
@ApiTags('payment-links')
@Controller('payment-links')
export class PaymentLinksController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  private url(token: string): string {
    return new URL(`/l/${token}`, this.deps.config.APP_URL).toString();
  }

  private view(l: LinkWithNames) {
    return {
      id: l.id,
      customerName: l.customerName,
      customerPhone: l.customerPhone,
      description: l.description,
      amountCents: l.amountCents,
      status: l.status as PaymentLinkStatus,
      url: this.url(l.publicToken),
      storeName: l.store.name,
      createdByName: l.createdBy.name,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      paidAt: l.paidAt,
      cancelledAt: l.cancelledAt,
      feeCents: l.feeCents,
      netAmountCents: l.netAmountCents,
    };
  }

  private async load(auth: AuthContext, id: string): Promise<LinkWithNames> {
    const tenantId = requireTenant(auth);
    const link = await this.deps.prisma.paymentLink.findFirst({
      where: { id, tenantId, ...storeScope(auth) },
      include: { store: { select: { name: true } }, createdBy: { select: { name: true } } },
    });
    if (!link) throw Errors.notFound('Link');
    return link;
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('charges:create')
  @RateLimit({ key: 'payment-link-create', limit: 30, windowSec: 60, by: 'user' })
  @ApiZodBody(createPaymentLinkSchema)
  async create(@CurrentAuth() auth: AuthContext, @ZBody(createPaymentLinkSchema) body: CreatePaymentLinkInput, @Meta() meta: RequestMeta) {
    const tenantId = requireTenant(auth);
    assertStoreAccess(auth, body.storeId);
    const link = await createPaymentLink(this.deps, {
      tenantId,
      storeId: body.storeId,
      createdById: auth.userId,
      customerName: body.customerName,
      customerPhone: body.customerPhone ?? null,
      description: body.description ?? null,
      amountCents: body.amountCents,
    }).catch(toPaymentLinkError);
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'payment_link',
      resourceId: link.id,
      action: 'payment_link.created',
      after: { storeId: link.storeId, amountCents: link.amountCents, expiresAt: link.expiresAt.toISOString() },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return this.view(await this.load(auth, link.id));
  }

  /** Lista com busca por nome do cliente (sem acento) e totais por status para as abas. */
  @Get()
  @RequirePermission('charges:read')
  async list(@CurrentAuth() auth: AuthContext, @ZQuery(listPaymentLinksQuerySchema) q: ListQuery) {
    const tenantId = requireTenant(auth);
    if (q.storeId) assertStoreAccess(auth, q.storeId);
    const base: Prisma.PaymentLinkWhereInput = { tenantId, ...storeScope(auth), ...(q.storeId ? { storeId: q.storeId } : {}) };
    if (q.q) {
      const term = normalizeSearchName(q.q);
      base.OR = [{ customerSearch: { contains: term } }, { description: { contains: q.q, mode: 'insensitive' } }];
    }
    const where: Prisma.PaymentLinkWhereInput = { ...base, ...(q.status ? { status: q.status } : {}) };
    const [total, rows, groups] = await Promise.all([
      this.deps.prisma.paymentLink.count({ where }),
      this.deps.prisma.paymentLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { store: { select: { name: true } }, createdBy: { select: { name: true } } },
      }),
      this.deps.prisma.paymentLink.groupBy({ by: ['status'], where: base, _count: { _all: true }, _sum: { amountCents: true } }),
    ]);
    const summary = Object.fromEntries(
      PAYMENT_LINK_STATUSES.map((s) => {
        const g = groups.find((x) => x.status === s);
        return [s, { count: g?._count._all ?? 0, amountCents: g?._sum.amountCents ?? 0 }];
      }),
    ) as Record<PaymentLinkStatus, { count: number; amountCents: number }>;
    return { total, items: rows.map((r) => this.view(r)), summary };
  }

  /** Detalhe; se estiver em aberto, consulta o Mercado Pago antes de responder ("Verificar pagamento"). */
  @Get(':id')
  @RequirePermission('charges:read')
  @RateLimit({ key: 'payment-link-detail', limit: 120, windowSec: 60, by: 'user' })
  async detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const link = await this.load(auth, id);
    await refreshPaymentLinkIfStale(this.deps, link, 3_000);
    return this.view(await this.load(auth, id));
  }

  @Post(':id/cancel')
  @RequirePermission('charges:cancel')
  @RateLimit({ key: 'payment-link-cancel', limit: 20, windowSec: 60, by: 'user' })
  async cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const link = await this.load(auth, id);
    await cancelPaymentLink(this.deps, link.id).catch(toPaymentLinkError);
    await writeAudit(this.deps.prisma, {
      tenantId: link.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'payment_link',
      resourceId: link.id,
      action: 'payment_link.cancelled',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return this.view(await this.load(auth, id));
  }
}
