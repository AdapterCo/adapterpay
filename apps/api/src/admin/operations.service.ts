import { Inject, Injectable } from '@nestjs/common';
import { WORKER_HEARTBEAT_KEY, type CoreDeps } from '@adapterpay/core';
import { QueueService } from '../common/queue.service';
import { CORE } from '../common/tokens';

/** Saúde operacional: worker, filas, polling atrasado e Orders sem conciliação (seção 3 — observabilidade). */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly queue: QueueService,
  ) {}

  async health() {
    const now = Date.now();
    const [heartbeatRaw, counts, stalePolling, reconciling, overduePending, needsReconnect, creatingStuck] = await Promise.all([
      this.deps.redis.get(WORKER_HEARTBEAT_KEY),
      this.queue.counts().catch(() => null),
      this.deps.prisma.pollingJob.count({ where: { done: false, nextAttemptAt: { lt: new Date(now - 60_000) } } }),
      this.deps.prisma.charge.count({ where: { status: 'RECONCILING' } }),
      this.deps.prisma.charge.count({ where: { status: 'PENDING', expiresAt: { lt: new Date(now - 5 * 60_000) } } }),
      this.deps.prisma.mpConnection.count({ where: { status: { in: ['NEEDS_RECONNECT', 'REVOKED'] } } }),
      this.deps.prisma.charge.count({ where: { status: 'CREATING', createdAt: { lt: new Date(now - 2 * 60_000) } } }),
    ]);
    const heartbeat = heartbeatRaw ? (JSON.parse(heartbeatRaw) as { at: number; workerId: string }) : null;
    const workerAgeSec = heartbeat ? Math.round((now - heartbeat.at) / 1000) : null;
    const alerts: string[] = [];
    if (workerAgeSec === null || workerAgeSec > 60) alerts.push('WORKER_DOWN');
    if (stalePolling > 0) alerts.push('POLLING_BACKLOG');
    if (overduePending > 0) alerts.push('ORDERS_WITHOUT_RECONCILIATION');
    if (creatingStuck > 0) alerts.push('CHARGES_STUCK_CREATING');
    if (reconciling > 0) alerts.push('CHARGES_RECONCILING');
    return {
      status: alerts.some((a) => a !== 'CHARGES_RECONCILING') ? 'degraded' : 'ok',
      alerts,
      worker: { lastHeartbeatSecondsAgo: workerAgeSec, workerId: heartbeat?.workerId ?? null },
      queue: counts,
      polling: { stale: stalePolling },
      charges: { reconciling, pendingPastExpiry: overduePending, creatingStuck },
      mpConnections: { needsReconnect },
      checkedAt: new Date(now).toISOString(),
    };
  }
}
