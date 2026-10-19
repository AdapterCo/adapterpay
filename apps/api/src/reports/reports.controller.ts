import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { writeAudit, type CoreDeps } from '@adapterpay/core';
import { reportQuerySchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { RateLimit } from '../common/rate-limit';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ZQuery } from '../common/zod';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {}

  /** Dashboard: VENDEDOR também acessa (visão restrita às suas lojas). */
  @Get('dashboard')
  @RequirePermission('charges:read')
  dashboard(@CurrentAuth() auth: AuthContext) {
    return this.reports.dashboard(auth);
  }

  @Get('sales')
  @RequirePermission('reports:read')
  sales(@CurrentAuth() auth: AuthContext, @ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.sales(auth, { ...q, from: new Date(q.from), to: new Date(q.to) });
  }

  @Get('export')
  @RequirePermission('reports:export')
  @RateLimit({ key: 'report-export', limit: 10, windowSec: 600, by: 'user' })
  async export(
    @CurrentAuth() auth: AuthContext,
    @ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>,
    @Meta() meta: RequestMeta,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.reports.exportRows(auth, { ...q, from: new Date(q.from), to: new Date(q.to) });
    const format = q.format ?? 'csv';
    const stamp = new Date().toISOString().slice(0, 10);
    await writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'report',
      action: 'report.exported',
      after: { format, rows: rows.length, from: q.from, to: q.to },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="adapterpay-cobrancas-${stamp}.xlsx"`);
      res.send(await this.reports.toXlsx(rows));
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="adapterpay-cobrancas-${stamp}.csv"`);
    res.send(this.reports.toCsv(rows));
  }
}
