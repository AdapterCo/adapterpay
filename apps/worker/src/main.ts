import { hostname } from 'node:os';
import { Queue, Worker, type Job } from 'bullmq';
import { BillingService, createCoreDeps, createRedis, pollCharge, QUEUES, randomToken } from '@adapterpay/core';
import { registerSchedulers, runMaintenance, type MaintenanceJobName } from './maintenance';

/**
 * Worker AdapterPay: processo independente do painel e das páginas públicas.
 * Continua consultando Orders mesmo com todos os navegadores fechados (seção 9).
 * Pode ser escalado horizontalmente: o lease em polling_jobs garante uma consulta por Order.
 */
async function main(): Promise<void> {
  const deps = createCoreDeps('adapterpay-worker');
  const workerId = `${hostname()}-${process.pid}-${randomToken(4)}`;
  const billing = new BillingService(deps);
  const connection = () => createRedis(deps.config.REDIS_URL);

  const chargesQueue = new Queue(QUEUES.charges, { connection: connection() });
  const maintenanceQueue = new Queue(QUEUES.maintenance, { connection: connection() });

  const chargesWorker = new Worker(
    QUEUES.charges,
    async (job: Job<{ chargeId: string }>) => {
      const { chargeId } = job.data;
      const result = await pollCharge(deps, chargeId, workerId);
      if (result.nextDelayMs !== null && !result.skipped?.startsWith('LEASE')) {
        await chargesQueue.add(
          'poll',
          { chargeId },
          { jobId: `poll-${chargeId}-${Date.now()}`, delay: result.nextDelayMs, removeOnComplete: 1000, removeOnFail: 5000 },
        );
      }
      return result;
    },
    { connection: connection(), concurrency: deps.config.WORKER_CONCURRENCY },
  );

  const maintenanceWorker = new Worker(
    QUEUES.maintenance,
    async (job: Job) => runMaintenance(job.name as MaintenanceJobName, { deps, billing, chargesQueue, workerId }),
    { connection: connection(), concurrency: 4 },
  );

  for (const w of [chargesWorker, maintenanceWorker]) {
    w.on('failed', (job, err) => deps.logger.error({ job: job?.name, jobId: job?.id, err: err.message }, 'job falhou'));
    w.on('error', (err) => deps.logger.error({ err: err.message }, 'erro no worker'));
  }

  await registerSchedulers(maintenanceQueue);
  // Recuperação imediata após reinício: retoma polling pendente sem esperar o próximo ciclo.
  await runMaintenance('sweep', { deps, billing, chargesQueue, workerId, recover: true });
  deps.logger.info({ workerId }, 'AdapterPay worker iniciado');

  const shutdown = async (signal: string) => {
    deps.logger.info({ signal }, 'encerrando worker');
    await Promise.allSettled([chargesWorker.close(), maintenanceWorker.close()]);
    await Promise.allSettled([chargesQueue.close(), maintenanceQueue.close()]);
    await deps.prisma.$disconnect();
    deps.redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
