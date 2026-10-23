import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { writeAudit, type CoreDeps } from '@adapterpay/core';
import { isUniqueViolation } from '@adapterpay/database';
import {
  loyaltyCustomerSchema,
  loyaltyCustomerUpdateSchema,
  normalizeBrWhatsApp,
  redeemRewardSchema,
} from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

const rewardSelect = { id: true, code: true, kind: true, valueCents: true, description: true, status: true, createdAt: true, usedAt: true } as const;

/** Fidelidade: clientes (nome + WhatsApp) e códigos de cashback/brinde de uso único. */
@ApiTags('loyalty')
@Controller('loyalty')
export class LoyaltyController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  /** Regras em vigor, para a tela do caixa (o vendedor não acessa Configurações). */
  @Get('config')
  @RequirePermission('loyalty:use')
  async config(@CurrentAuth() auth: AuthContext) {
    const t = await this.deps.prisma.tenant.findUniqueOrThrow({
      where: { id: requireTenant(auth) },
      select: { loyaltyMode: true, loyaltyCashbackBps: true, loyaltyGiftEvery: true, loyaltyGiftName: true, loyaltyMinPurchaseCents: true },
    });
    return {
      mode: t.loyaltyMode,
      cashbackBps: t.loyaltyCashbackBps,
      giftEvery: t.loyaltyGiftEvery,
      giftName: t.loyaltyGiftName,
      minPurchaseCents: t.loyaltyMinPurchaseCents,
    };
  }

  /** Busca no caixa pelo WhatsApp: devolve o cliente e os códigos disponíveis, ou null. */
  @Get('customers/lookup')
  @RequirePermission('loyalty:use')
  @RateLimit({ key: 'loyalty-lookup', limit: 60, windowSec: 60, by: 'user' })
  async lookup(@CurrentAuth() auth: AuthContext, @Query('phone') phone: string) {
    const normalized = normalizeBrWhatsApp(phone ?? '');
    if (!normalized) throw Errors.validation('Informe um WhatsApp com DDD');
    const c = await this.deps.prisma.loyaltyCustomer.findUnique({
      where: { tenantId_phone: { tenantId: requireTenant(auth), phone: normalized } },
      include: { rewards: { where: { status: 'AVAILABLE' }, select: rewardSelect, orderBy: { createdAt: 'asc' } } },
    });
    return { customer: c ? this.view(c) : null };
  }

  @Post('customers')
  @HttpCode(201)
  @RequirePermission('loyalty:use')
  @ApiZodBody(loyaltyCustomerSchema)
  async create(
    @CurrentAuth() auth: AuthContext,
    @ZBody(loyaltyCustomerSchema) body: z.infer<typeof loyaltyCustomerSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const tenantId = requireTenant(auth);
    try {
      const c = await this.deps.prisma.loyaltyCustomer.create({ data: { ...body, tenantId } });
      await this.audit(auth, meta, c.id, 'loyalty.customer_created', { whatsappOptIn: c.whatsappOptIn });
      return { customer: this.view({ ...c, rewards: [] }) };
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('Este WhatsApp já está cadastrado na fidelidade');
      throw err;
    }
  }

  @Get('customers')
  @RequirePermission('loyalty:manage')
  async list(@CurrentAuth() auth: AuthContext, @Query('q') q?: string) {
    const term = (q ?? '').trim().slice(0, 60);
    const digits = term.replace(/\D/g, '');
    const rows = await this.deps.prisma.loyaltyCustomer.findMany({
      where: {
        tenantId: requireTenant(auth),
        ...(term
          ? { OR: [{ name: { contains: term, mode: 'insensitive' as const } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] }
          : {}),
      },
      include: { rewards: { where: { status: { in: ['AVAILABLE', 'RESERVED'] } }, select: rewardSelect } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((c) => this.view(c));
  }

  @Get('customers/:id/rewards')
  @RequirePermission('loyalty:manage')
  async rewards(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.find(auth, id);
    return this.deps.prisma.loyaltyReward.findMany({ where: { customerId: c.id }, select: rewardSelect, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Patch('customers/:id')
  @RequirePermission('loyalty:manage')
  @ApiZodBody(loyaltyCustomerUpdateSchema)
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(loyaltyCustomerUpdateSchema) body: z.infer<typeof loyaltyCustomerUpdateSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const c = await this.find(auth, id);
    await this.deps.prisma.loyaltyCustomer.update({ where: { id: c.id }, data: body });
    await this.audit(auth, meta, c.id, 'loyalty.customer_updated', body);
    return { ok: true };
  }

  /** LGPD: apaga o cliente e os códigos. As vendas continuam, sem o vínculo com o cliente. */
  @Delete('customers/:id')
  @HttpCode(204)
  @RequirePermission('loyalty:manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    const c = await this.find(auth, id);
    const reserved = await this.deps.prisma.loyaltyReward.count({ where: { customerId: c.id, status: 'RESERVED' } });
    if (reserved > 0) throw Errors.conflict('O cliente tem um código em uma cobrança em andamento. Tente de novo em alguns minutos.');
    await this.deps.prisma.loyaltyCustomer.delete({ where: { id: c.id } });
    await this.audit(auth, meta, c.id, 'loyalty.customer_deleted');
  }

  /** Resgate de brinde no balcão (o cashback é usado como desconto na cobrança). */
  @Post('rewards/redeem')
  @RequirePermission('loyalty:use')
  @RateLimit({ key: 'loyalty-redeem', limit: 30, windowSec: 60, by: 'user' })
  @ApiZodBody(redeemRewardSchema)
  async redeem(
    @CurrentAuth() auth: AuthContext,
    @ZBody(redeemRewardSchema) body: z.infer<typeof redeemRewardSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const tenantId = requireTenant(auth);
    const r = await this.deps.prisma.loyaltyReward.findUnique({
      where: { tenantId_code: { tenantId, code: body.code } },
      include: { customer: { select: { name: true } } },
    });
    if (!r) throw Errors.notFound('Código');
    if (r.kind !== 'GIFT') throw Errors.validation('Este código é de cashback: aplique na tela de cobrança');
    const used = await this.deps.prisma.loyaltyReward.updateMany({ where: { id: r.id, status: 'AVAILABLE' }, data: { status: 'USED', usedAt: new Date() } });
    if (used.count !== 1) throw Errors.conflict('Este código já foi usado');
    await this.audit(auth, meta, r.customerId, 'loyalty.gift_redeemed', { code: body.code });
    return { ok: true, customerName: r.customer.name, description: r.description };
  }

  private async find(auth: AuthContext, id: string) {
    const c = await this.deps.prisma.loyaltyCustomer.findFirst({ where: { id, tenantId: requireTenant(auth) } });
    if (!c) throw Errors.notFound('Cliente');
    return c;
  }

  private view(c: {
    id: string;
    name: string;
    phone: string;
    whatsappOptIn: boolean;
    purchaseCount: number;
    giftProgress: number;
    totalSpentCents: number;
    createdAt: Date;
    rewards: Array<{ id: string; code: string; kind: string; valueCents: number | null; description: string | null; status: string; createdAt: Date; usedAt: Date | null }>;
  }) {
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      whatsappOptIn: c.whatsappOptIn,
      purchaseCount: c.purchaseCount,
      giftProgress: c.giftProgress,
      totalSpentCents: c.totalSpentCents,
      createdAt: c.createdAt,
      rewards: c.rewards,
    };
  }

  private audit(auth: AuthContext, meta: RequestMeta, id: string, action: string, after?: object) {
    return writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'loyalty_customer',
      resourceId: id,
      action,
      after,
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }
}
