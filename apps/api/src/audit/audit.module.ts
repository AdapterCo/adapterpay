import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CoreDeps } from '@adapterpay/core';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { CurrentAuth, requireTenant, type AuthContext } from '../common/request';
import { CORE } from '../common/tokens';
import { ZQuery } from '../common/zod';

const auditQuery = z.object({
  resourceType: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  @RequirePermission('audit:read')
  async list(@CurrentAuth() auth: AuthContext, @ZQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    const where = { tenantId: requireTenant(auth), ...(q.resourceType ? { resourceType: q.resourceType } : {}) };
    const [total, items] = await Promise.all([
      this.deps.prisma.auditLog.count({ where }),
      this.deps.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actors = await this.deps.prisma.user.findMany({
      where: { id: { in: items.map((i) => i.actorUserId).filter((x): x is string => !!x) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      total,
      items: items.map((i) => ({ ...i, actor: i.actorUserId ? (byId.get(i.actorUserId) ?? null) : null })),
    };
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
