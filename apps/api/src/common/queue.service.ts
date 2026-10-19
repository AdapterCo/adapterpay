import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedis, QUEUES, type CoreDeps } from '@adapterpay/core';
import { CORE } from './tokens';

/** Produtor de jobs para o worker (o consumo ocorre somente em apps/worker). */
@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly charges: Queue;

  constructor(@Inject(CORE) deps: CoreDeps) {
    this.charges = new Queue(QUEUES.charges, { connection: createRedis(deps.config.REDIS_URL) });
  }

  /** Agenda uma consulta da cobrança. O lease em polling_jobs garante uma consulta por vez. */
  async enqueuePoll(chargeId: string, delayMs: number): Promise<void> {
    await this.charges.add(
      'poll',
      { chargeId },
      { jobId: `poll-${chargeId}-${Date.now()}`, delay: Math.max(0, delayMs), removeOnComplete: 1000, removeOnFail: 5000 },
    );
  }

  async counts(): Promise<Record<string, number>> {
    return this.charges.getJobCounts('waiting', 'active', 'delayed', 'failed');
  }

  async onModuleDestroy(): Promise<void> {
    await this.charges.close();
  }
}
