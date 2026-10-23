import type { Queue } from 'bullmq';
import {
  runDailyReports,
  syncPaymentFees,
  syncPos,
  WORKER_HEARTBEAT_KEY,
  type BillingService,
  type CoreDeps,
} from '@adapterpay/core';

export type MaintenanceJobName =
  | 'sweep'
  | 'heartbeat'
  | 'billing-cycle'
  | 'invoice-poll'
  | 'preapproval-poll'
  | 'fee-sync'
  | 'pos-sync'
  | 'token-refresh'
  | 'key-rotation'
  | 'daily-report'
  | 'cleanup';

interface Ctx {
  deps: CoreDeps;
  billing: BillingService;
  chargesQueue: Queue;
  workerId: string;
  recover?: boolean;
}

/** Agendamentos idempotentes (BullMQ job schedulers): um job por intervalo para todo o cluster. */
export async function registerSchedulers(queue: Queue): Promise<void> {
  const every: Array<[MaintenanceJobName, number]> = [
    ['sweep', 5_000],
    ['heartbeat', 10_000],
    ['invoice-poll', 15_000],
    ['billing-cycle', 60_000],
    ['preapproval-poll', 60_000],
    ['fee-sync', 120_000],
    ['token-refresh', 3_600_000],
    ['pos-sync', 3_600_000],
    ['daily-report', 300_000],
    ['key-rotation', 86_400_000],
    ['cleanup', 86_400_000],
  ];
  for (const [name, ms] of every) {
    await queue.upsertJobScheduler(name, { every: ms }, { name, opts: { removeOnComplete: 100, removeOnFail: 500 } });
  }
}

export async function runMaintenance(name: MaintenanceJobName, ctx: Ctx): Promise<unknown> {
  const { deps } = ctx;
  switch (name) {
    case 'heartbeat':
      await deps.redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), workerId: ctx.workerId }), 'EX', 120);
      return { ok: true };

    case 'sweep': {
      // Reconciliação agendada: retoma jobs atrasados (perda de job na fila, reinício, queda de API).
      const threshold = new Date(Date.now() - (ctx.recover ? 0 : 10_000));
      const due = await deps.prisma.pollingJob.findMany({
        where: {
          done: false,
          nextAttemptAt: { lte: threshold },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        select: { chargeId: true, nextAttemptAt: true },
        orderBy: { nextAttemptAt: 'asc' },
        take: 500,
      });
      for (const j of due) {
        await ctx.chargesQueue.add(
          'poll',
          { chargeId: j.chargeId },
          // jobId determinístico por janela evita múltiplos jobs para a mesma Order.
          { jobId: `poll-${j.chargeId}-sweep-${Math.floor(j.nextAttemptAt.getTime() / 10_000)}`, removeOnComplete: 1000, removeOnFail: 5000 },
        );
      }
      return { enqueued: due.length };
    }

    case 'billing-cycle': {
      const issued = await ctx.billing.issueRenewals();
      const suspended = await ctx.billing.enforceOverdue();
      const canceled = await ctx.billing.finalizeCancellations();
      return { issued, suspended, canceled };
    }

    case 'invoice-poll': {
      const invoices = await deps.prisma.invoice.findMany({
        where: { status: 'OPEN', method: 'PIX', providerReference: { not: null }, nextPollAt: { lte: new Date() } },
        select: { id: true },
        take: 100,
      });
      for (const inv of invoices) {
        await ctx.billing.pollInvoice(inv.id).catch((err) => deps.logger.warn({ invoiceId: inv.id, err: (err as Error).message }, 'poll de fatura falhou'));
      }
      return { polled: invoices.length };
    }

    case 'preapproval-poll': {
      const subs = await deps.prisma.subscription.findMany({
        where: {
          mpPreapprovalId: { not: null },
          status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE'] },
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
        },
        select: { id: true },
        take: 100,
      });
      for (const s of subs) {
        await ctx.billing.pollPreapproval(s.id).catch((err) => deps.logger.warn({ subscriptionId: s.id, err: (err as Error).message }, 'poll de assinatura falhou'));
      }
      return { polled: subs.length };
    }

    case 'fee-sync':
      return { synced: await syncPaymentFees(deps, 50) };

    case 'pos-sync': {
      const stale = await deps.prisma.posTerminal.findMany({
        where: {
          status: { not: 'INACTIVE' },
          mpConnection: { status: 'ACTIVE' },
          OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - 6 * 3_600_000) } }],
        },
        select: { id: true },
        take: 50,
      });
      for (const p of stale) {
        await syncPos(deps, p.id).catch((err) => deps.logger.warn({ posId: p.id, err: (err as Error).message }, 'sync de POS falhou'));
      }
      return { synced: stale.length };
    }

    case 'token-refresh': {
      const expiring = await deps.prisma.mpConnection.findMany({
        where: { status: 'ACTIVE', tokenExpiresAt: { lt: new Date(Date.now() + 7 * 86_400_000) } },
        select: { id: true },
        take: 100,
      });
      for (const c of expiring) {
        await deps.tokens.refresh(c.id, true).catch((err) => deps.logger.warn({ connectionId: c.id, err: (err as Error).message }, 'renovação de token falhou'));
      }
      return { refreshed: expiring.length };
    }

    case 'key-rotation': {
      // Regrava segredos cifrados com chave antiga usando a chave atual (rotação de ENCRYPTION_KEY).
      let rotated = 0;
      const conns = await deps.prisma.mpConnection.findMany({
        where: { status: { not: 'DISCONNECTED' } },
        select: { id: true, accessTokenEnc: true, refreshTokenEnc: true },
      });
      for (const c of conns) {
        if (!deps.encryptor.needsRotation(c.accessTokenEnc) && (!c.refreshTokenEnc || !deps.encryptor.needsRotation(c.refreshTokenEnc))) continue;
        await deps.prisma.mpConnection.update({
          where: { id: c.id },
          data: {
            accessTokenEnc: deps.encryptor.encrypt(deps.encryptor.decrypt(c.accessTokenEnc)),
            refreshTokenEnc: c.refreshTokenEnc ? deps.encryptor.encrypt(deps.encryptor.decrypt(c.refreshTokenEnc)) : null,
          },
        });
        rotated++;
      }
      const users = await deps.prisma.user.findMany({ where: { mfaSecretEnc: { not: null } }, select: { id: true, mfaSecretEnc: true } });
      for (const u of users) {
        if (!deps.encryptor.needsRotation(u.mfaSecretEnc!)) continue;
        await deps.prisma.user.update({ where: { id: u.id }, data: { mfaSecretEnc: deps.encryptor.encrypt(deps.encryptor.decrypt(u.mfaSecretEnc!)) } });
        rotated++;
      }
      const tenants = await deps.prisma.tenant.findMany({ select: { id: true, taxIdEnc: true } });
      for (const t of tenants) {
        if (!deps.encryptor.needsRotation(t.taxIdEnc)) continue;
        await deps.prisma.tenant.update({ where: { id: t.id }, data: { taxIdEnc: deps.encryptor.encrypt(deps.encryptor.decrypt(t.taxIdEnc)) } });
        rotated++;
      }
      return { rotated };
    }

    case 'daily-report':
      // Fechamento de caixa por WhatsApp no horário escolhido por cada empresa (envio único por dia).
      return runDailyReports(deps);

    case 'cleanup': {
      const now = new Date();
      const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
      const [states, tokens, sessions] = await Promise.all([
        deps.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } }),
        deps.prisma.emailToken.deleteMany({ where: { OR: [{ consumedAt: { lt: monthAgo } }, { expiresAt: { lt: monthAgo } }] } }),
        deps.prisma.session.deleteMany({ where: { OR: [{ revokedAt: { lt: monthAgo } }, { expiresAt: { lt: monthAgo } }] } }),
      ]);
      // Registros financeiros e auditoria são preservados (obrigações legais); nada é apagado aqui.
      return { states: states.count, tokens: tokens.count, sessions: sessions.count };
    }
  }
}
