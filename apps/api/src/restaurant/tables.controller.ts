import { randomBytes } from 'node:crypto';
import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { writeAudit, type CoreDeps } from '@adapterpay/core';
import { isPgUniqueViolation, type ChargeStatus } from '@adapterpay/database';
import {
  currentShare,
  nextTableChargeCents,
  paidPercent,
  remainingCents,
  tableBillOpenSchema,
  tableCreateSchema,
  type TableBillState,
} from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { Errors } from '../common/errors';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';
import { PosService } from '../pos/pos.service';

const ACTIVE_CHARGE: ChargeStatus[] = ['CREATING', 'PENDING', 'RECONCILING'];
const tableSlug = () => randomBytes(18).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24).padEnd(24, '7');

export function billState(b: { totalCents: number; paidCents: number; mode: string | null; splitCount: number | null; paidShares: number }): TableBillState {
  return { totalCents: b.totalCents, paidCents: b.paidCents, mode: b.mode as TableBillState['mode'], splitCount: b.splitCount, paidShares: b.paidShares };
}

/** Modo Restaurante (painel): mesas com POS próprio e contas abertas pelo garçom/caixa. */
@ApiTags('tables')
@Controller('tables')
export class TablesController {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly pos: PosService,
  ) {}

  private async assertRestaurant(tenantId: string): Promise<void> {
    const t = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { restaurantMode: true } });
    if (!t.restaurantMode) throw Errors.validation('Ative o Modo Restaurante em Configurações para usar mesas');
  }

  private storeFilter(auth: AuthContext) {
    return auth.storeIds === 'ALL' ? {} : { storeId: { in: auth.storeIds } };
  }

  @Get()
  @RequirePermission('tables:operate')
  async list(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const tables = await this.deps.prisma.restaurantTable.findMany({
      where: { tenantId, status: 'ACTIVE', ...this.storeFilter(auth) },
      orderBy: { name: 'asc' },
      include: {
        pos: { select: { id: true, name: true, activeChargeId: true, store: { select: { name: true } } } },
        bills: { where: { status: 'OPEN' }, take: 1 },
      },
    });
    const activeIds = tables.map((t) => t.pos.activeChargeId).filter((x): x is string => !!x);
    const active = await this.deps.prisma.charge.findMany({
      where: { id: { in: activeIds }, status: { in: ACTIVE_CHARGE } },
      select: { id: true, amountCents: true, expiresAt: true, tableBillId: true },
    });
    const byId = new Map(active.map((c) => [c.id, c]));
    return tables.map((t) => {
      const bill = t.bills[0] ?? null;
      const charge = t.pos.activeChargeId ? byId.get(t.pos.activeChargeId) ?? null : null;
      const s = bill ? billState(bill) : null;
      return {
        id: t.id,
        name: t.name,
        publicSlug: t.publicSlug,
        storeName: t.pos.store.name,
        posName: t.pos.name,
        bill:
          bill && s
            ? {
                id: bill.id,
                totalCents: bill.totalCents,
                paidCents: bill.paidCents,
                remainingCents: remainingCents(s),
                percent: paidPercent(s),
                mode: s.mode,
                splitCount: bill.splitCount,
                paidShares: bill.paidShares,
                share: currentShare(s),
                nextChargeCents: nextTableChargeCents(s),
                openedAt: bill.openedAt,
              }
            : null,
        paying: charge && bill && charge.tableBillId === bill.id ? { amountCents: charge.amountCents, expiresAt: charge.expiresAt } : null,
      };
    });
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('tables:manage')
  @ApiZodBody(tableCreateSchema)
  async create(@CurrentAuth() auth: AuthContext, @ZBody(tableCreateSchema) body: z.infer<typeof tableCreateSchema>, @Meta() meta: RequestMeta) {
    const tenantId = requireTenant(auth);
    await this.assertRestaurant(tenantId);
    let posId = body.posId;
    if (!posId) {
      // Cria o POS da mesa no Mercado Pago com o nome da mesa (conta no limite de POS do plano).
      const created = await this.pos.create(auth, { storeId: body.storeId!, name: body.name.length >= 2 ? body.name : `Mesa ${body.name}`, activate: true }, meta);
      posId = created.id;
    }
    const p = await this.deps.prisma.posTerminal.findFirst({ where: { id: posId, tenantId, ...this.storeFilter(auth) }, select: { id: true, storeId: true } });
    if (!p) throw Errors.notFound('POS');
    if (await this.deps.prisma.totemDevice.findFirst({ where: { posId: p.id, status: 'ACTIVE' }, select: { id: true } })) {
      throw Errors.conflict('Este POS já é de um totem. Use outro POS para a mesa.');
    }
    try {
      const t = await this.deps.prisma.restaurantTable.create({
        data: { tenantId, storeId: p.storeId, posId: p.id, name: body.name, publicSlug: tableSlug() },
      });
      await this.audit(auth, meta, t.id, 'table.created', { name: t.name, posId: p.id });
      return { id: t.id, publicSlug: t.publicSlug };
    } catch (err) {
      if (isPgUniqueViolation(err)) throw Errors.conflict('Este POS já é de outra mesa. Use um POS para cada mesa.');
      throw err;
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('tables:manage')
  async archive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    const t = await this.find(auth, id);
    if (await this.deps.prisma.tableBill.findFirst({ where: { tableId: t.id, status: 'OPEN' }, select: { id: true } })) {
      throw Errors.conflict('Feche ou cancele a conta aberta antes de remover a mesa');
    }
    await this.deps.prisma.restaurantTable.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } });
    await this.audit(auth, meta, t.id, 'table.archived');
  }

  /** Abre a conta da mesa com o valor total. */
  @Post(':id/bill')
  @HttpCode(201)
  @RequirePermission('tables:operate')
  @ApiZodBody(tableBillOpenSchema)
  async openBill(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(tableBillOpenSchema) body: z.infer<typeof tableBillOpenSchema>, @Meta() meta: RequestMeta) {
    const t = await this.find(auth, id);
    await this.assertRestaurant(t.tenantId);
    try {
      const b = await this.deps.prisma.tableBill.create({
        data: { tenantId: t.tenantId, tableId: t.id, openedById: auth.userId, totalCents: body.totalCents },
      });
      await this.audit(auth, meta, t.id, 'table.bill_opened', { billId: b.id, totalCents: b.totalCents });
      return { id: b.id };
    } catch (err) {
      if (isPgUniqueViolation(err)) throw Errors.conflict('Esta mesa já tem uma conta aberta');
      throw err;
    }
  }

  /** Corrige o valor da conta (não pode ficar abaixo do que já foi pago). */
  @Post(':id/bill/total')
  @RequirePermission('tables:operate')
  async updateTotal(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(tableBillOpenSchema) body: z.infer<typeof tableBillOpenSchema>, @Meta() meta: RequestMeta) {
    const bill = await this.openBillOf(auth, id);
    if (body.totalCents <= bill.paidCents) throw Errors.validation('O novo valor precisa ser maior que o já pago');
    await this.deps.prisma.tableBill.update({ where: { id: bill.id }, data: { totalCents: body.totalCents } });
    await this.audit(auth, meta, id, 'table.bill_total_changed', { from: bill.totalCents, to: body.totalCents });
    return { ok: true };
  }

  /** Volta a conta para a escolha integral/dividido (ex.: o grupo mudou de ideia). */
  @Post(':id/bill/reset-split')
  @RequirePermission('tables:operate')
  async resetSplit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const bill = await this.openBillOf(auth, id);
    await this.deps.prisma.tableBill.update({ where: { id: bill.id }, data: { mode: null, splitCount: null, paidShares: 0 } });
    return { ok: true };
  }

  /** Cancela a conta aberta. Pagamentos já feitos continuam registrados nas cobranças. */
  @Post(':id/bill/cancel')
  @RequirePermission('tables:operate')
  async cancelBill(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const table = await this.find(auth, id);
    const bill = await this.openBillOf(auth, id);
    const pos = await this.deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: table.posId }, select: { activeChargeId: true } });
    if (pos.activeChargeId) {
      const c = await this.deps.prisma.charge.findUnique({ where: { id: pos.activeChargeId }, select: { tableBillId: true } });
      if (c?.tableBillId === bill.id) throw Errors.conflict('Há um Pix desta mesa em andamento. Aguarde a confirmação ou a expiração.');
    }
    await this.deps.prisma.tableBill.update({ where: { id: bill.id }, data: { status: 'CANCELLED', closedAt: new Date() } });
    await this.audit(auth, meta, id, 'table.bill_cancelled', { billId: bill.id, paidCents: bill.paidCents, totalCents: bill.totalCents });
    return { ok: true };
  }

  private async openBillOf(auth: AuthContext, tableId: string) {
    const t = await this.find(auth, tableId);
    const bill = await this.deps.prisma.tableBill.findFirst({ where: { tableId: t.id, status: 'OPEN' } });
    if (!bill) throw Errors.notFound('Conta aberta');
    return bill;
  }

  private async find(auth: AuthContext, id: string) {
    const t = await this.deps.prisma.restaurantTable.findFirst({
      where: { id, tenantId: requireTenant(auth), status: 'ACTIVE', ...this.storeFilter(auth) },
    });
    if (!t) throw Errors.notFound('Mesa');
    return t;
  }

  private audit(auth: AuthContext, meta: RequestMeta, id: string, action: string, after?: object) {
    return writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'table',
      resourceId: id,
      action,
      after,
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }
}
