import { Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CoreDeps } from '@adapterpay/core';
import { fulfillmentSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { storeScope } from '../common/access';
import { Errors } from '../common/errors';
import { CurrentAuth, requireTenant, type AuthContext } from '../common/request';
import { CORE } from '../common/tokens';
import { ZBody } from '../common/zod';

const OPEN = ['PREPARING', 'READY'];

/** Pedidos pagos com número (totem e catálogo): fila da cozinha/balcão. */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  @RequirePermission('orders:manage')
  async list(@CurrentAuth() auth: AuthContext, @Query('view') view?: string) {
    const done = view === 'done';
    const rows = await this.deps.prisma.charge.findMany({
      where: {
        tenantId: requireTenant(auth),
        ...storeScope(auth),
        status: 'PAID',
        orderNumber: { not: null },
        paidAt: { gte: new Date(Date.now() - (done ? 12 : 36) * 3_600_000) },
        fulfillmentStatus: done ? 'DELIVERED' : { in: OPEN },
      },
      orderBy: done ? { fulfilledAt: 'desc' } : { paidAt: 'asc' },
      take: done ? 50 : 200,
      include: {
        items: { select: { name: true, quantity: true } },
        store: { select: { name: true } },
        totem: { select: { name: true } },
        pos: { select: { name: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      orderNumber: c.orderNumber,
      status: c.fulfillmentStatus,
      amountCents: c.amountCents,
      paidAt: c.paidAt,
      fulfilledAt: c.fulfilledAt,
      storeName: c.store.name,
      origin: c.totem?.name ?? c.pos.name,
      items: c.items,
      description: c.description,
    }));
  }

  @Patch(':id')
  @RequirePermission('orders:manage')
  async update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(fulfillmentSchema) body: z.infer<typeof fulfillmentSchema>) {
    const tenantId = requireTenant(auth);
    const c = await this.deps.prisma.charge.findFirst({
      where: { id, tenantId, ...storeScope(auth), status: 'PAID', orderNumber: { not: null } },
      select: { id: true, posId: true, status: true },
    });
    if (!c) throw Errors.notFound('Pedido');
    await this.deps.prisma.charge.update({
      where: { id: c.id },
      data: { fulfillmentStatus: body.status, fulfilledAt: body.status === 'DELIVERED' ? new Date() : null },
    });
    await this.deps.events
      .publish({ type: 'charge.updated', tenantId, chargeId: c.id, posId: c.posId, status: c.status })
      .catch(() => undefined);
    return { ok: true };
  }
}
