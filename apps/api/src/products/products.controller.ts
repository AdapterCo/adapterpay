import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { writeAudit, type CoreDeps } from '@adapterpay/core';
import { isUniqueViolation } from '@adapterpay/database';
import { productInputSchema, productUpdateSchema, type ProductInput } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { Errors } from '../common/errors';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

const MAX_PRODUCTS = 500;

/** Catálogo de produtos da cobrança rápida. Administrador gerencia; vendedor só consulta os ativos. */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  @RequirePermission('products:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.deps.prisma.product.findMany({
      where: { tenantId: requireTenant(auth), ...(auth.role === 'ADMIN' ? {} : { active: true }) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, priceCents: true, category: true, active: true, sortOrder: true },
    });
  }

  /** Código único por empresa: o leitor de código de barras precisa achar um só produto. */
  private async save<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('Já existe um produto com este código');
      throw err;
    }
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('products:manage')
  @ApiZodBody(productInputSchema)
  async create(@CurrentAuth() auth: AuthContext, @ZBody(productInputSchema) body: ProductInput, @Meta() meta: RequestMeta) {
    const tenantId = requireTenant(auth);
    if ((await this.deps.prisma.product.count({ where: { tenantId } })) >= MAX_PRODUCTS) {
      throw Errors.validation(`Limite de ${MAX_PRODUCTS} produtos no catálogo`);
    }
    const p = await this.save(() => this.deps.prisma.product.create({ data: { ...body, category: body.category || null, tenantId } }));
    await this.audit(auth, meta, p.id, 'product.created', undefined, { name: p.name, priceCents: p.priceCents });
    return p;
  }

  @Patch(':id')
  @RequirePermission('products:manage')
  @ApiZodBody(productUpdateSchema)
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(productUpdateSchema) body: z.infer<typeof productUpdateSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const before = await this.find(auth, id);
    const data = body.category !== undefined ? { ...body, category: body.category || null } : body;
    const p = await this.save(() => this.deps.prisma.product.update({ where: { id: before.id }, data }));
    await this.audit(auth, meta, id, 'product.updated', { name: before.name, priceCents: before.priceCents, active: before.active }, {
      name: p.name,
      priceCents: p.priceCents,
      active: p.active,
    });
    return p;
  }

  /** Remove do catálogo. Vendas antigas mantêm a cópia do nome e do preço. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('products:manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    const p = await this.find(auth, id);
    await this.deps.prisma.product.delete({ where: { id: p.id } });
    await this.audit(auth, meta, id, 'product.deleted', { name: p.name, priceCents: p.priceCents });
  }

  private async find(auth: AuthContext, id: string) {
    const p = await this.deps.prisma.product.findFirst({ where: { id, tenantId: requireTenant(auth) } });
    if (!p) throw Errors.notFound('Produto');
    return p;
  }

  private audit(auth: AuthContext, meta: RequestMeta, id: string, action: string, before?: object, after?: object) {
    return writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'product',
      resourceId: id,
      action,
      before,
      after,
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }
}
