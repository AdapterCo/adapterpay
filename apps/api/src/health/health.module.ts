import { Controller, Get, Headers, Inject, Module, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import { safeEqual, WORKER_HEARTBEAT_KEY, type CoreDeps } from '@adapterpay/core';
import { Public } from '../auth/decorators';
import { Errors } from '../common/errors';
import { CORE } from '../common/tokens';

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'adapterpay_api_' });
const chargesGauge = new Gauge({ name: 'adapterpay_charges_active', help: 'Cobranças por estado ativo', labelNames: ['status'], registers: [registry] });
const workerAge = new Gauge({ name: 'adapterpay_worker_heartbeat_age_seconds', help: 'Idade do último heartbeat do worker', registers: [registry] });
const pollingBacklog = new Gauge({ name: 'adapterpay_polling_backlog', help: 'Jobs de polling atrasados (>60s)', registers: [registry] });

@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: banco e Redis acessíveis. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    try {
      await this.deps.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    try {
      checks.redis = (await this.deps.redis.ping()) === 'PONG' ? 'ok' : 'fail';
    } catch {
      checks.redis = 'fail';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'fail', checks };
  }
}

@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() res: Response): Promise<void> {
    const token = this.deps.config.METRICS_TOKEN;
    if (!token) throw Errors.notFound('Rota');
    if (!authorization || !safeEqual(authorization, `Bearer ${token}`)) throw Errors.unauthenticated();
    const grouped = await this.deps.prisma.charge.groupBy({
      by: ['status'],
      where: { status: { in: ['CREATING', 'PENDING', 'RECONCILING'] } },
      _count: { _all: true },
    });
    chargesGauge.reset();
    for (const g of grouped) chargesGauge.set({ status: g.status }, g._count._all);
    const hb = await this.deps.redis.get(WORKER_HEARTBEAT_KEY);
    workerAge.set(hb ? (Date.now() - (JSON.parse(hb) as { at: number }).at) / 1000 : 1e9);
    pollingBacklog.set(await this.deps.prisma.pollingJob.count({ where: { done: false, nextAttemptAt: { lt: new Date(Date.now() - 60_000) } } }));
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}

@Module({ controllers: [HealthController, MetricsController] })
export class HealthModule {}
