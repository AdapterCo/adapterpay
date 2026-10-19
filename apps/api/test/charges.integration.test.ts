import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyChargeTransition,
  assertCanActivate,
  PlanLimitError,
  pollCharge,
  SubscriptionInactiveError,
  syncPaymentFees,
  type CoreDeps,
} from '@adapterpay/core';
import { ChargesService } from '../src/charges/charges.service';
import { AppError } from '../src/common/errors';
import type { QueueService } from '../src/common/queue.service';
import { FakeMercadoPago, makeDeps, meta, resetDb, seedTenant } from './helpers';

/**
 * Testes de integração contra PostgreSQL REAL (migrations + constraints + triggers) e Mercado Pago
 * simulado no nível HTTP com o contrato comprovado da seção 7.
 * Executar: TEST_DATABASE_URL=postgresql://... pnpm --filter @adapterpay/api test:integration
 */
const enabled = !!process.env.TEST_DATABASE_URL;
const queueStub = { enqueuePoll: async () => undefined } as unknown as QueueService;

describe.skipIf(!enabled)('motor de cobranças (integração)', () => {
  let fake: FakeMercadoPago;
  let deps: CoreDeps;
  let charges: ChargesService;

  beforeEach(async () => {
    fake = new FakeMercadoPago();
    deps = makeDeps(fake);
    charges = new ChargesService(deps, queueStub);
    await resetDb(deps.prisma);
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  async function forcePoll(chargeId: string) {
    await deps.prisma.pollingJob.update({ where: { chargeId }, data: { leaseOwner: null, leaseUntil: null } });
    return pollCharge(deps, chargeId, 'test-worker');
  }

  it('cria Order com payload do contrato e grava PENDING com order_id e expires_at', async () => {
    const s = await seedTenant(deps);
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta);
    expect(c.status).toBe('PENDING');
    expect(c.orderId).toMatch(/^ORD/);
    expect(fake.createCalls).toBe(1);
    const order = fake.orders.get(c.orderId!)!;
    expect(order.body).toMatchObject({ total_amount: '1.00', config: { qr: { mode: 'static' } } });
    const pos = await deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: s.posId } });
    expect(order.body.config.qr.external_pos_id).toBe(pos.externalId);
    expect(pos.activeChargeId).toBe(c.id);
    expect(new Date(c.expiresAt!).getTime() - new Date(c.mpCreatedAt!).getTime()).toBe(180_000);
  });

  it('corrida no mesmo POS: exatamente uma Order criada; a outra recebe 409 POS_BUSY', async () => {
    const s = await seedTenant(deps);
    const results = await Promise.allSettled([
      charges.create(s.auth, { posId: s.posId, amountCents: 1000 }, undefined, meta),
      charges.create(s.auth, { posId: s.posId, amountCents: 2000 }, undefined, meta),
      charges.create(s.auth, { posId: s.posId, amountCents: 3000 }, undefined, meta),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof AppError && r.reason.code === 'POS_BUSY');
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(2);
    expect(await deps.prisma.charge.count()).toBe(1);
    expect(fake.createCalls).toBe(1);
  });

  it('retentativa com a mesma Idempotency-Key não duplica cobrança', async () => {
    const s = await seedTenant(deps);
    const a = await charges.create(s.auth, { posId: s.posId, amountCents: 500 }, 'client-key-0001', meta);
    const b = await charges.create(s.auth, { posId: s.posId, amountCents: 500 }, 'client-key-0001', meta);
    expect(b.id).toBe(a.id);
    expect(await deps.prisma.charge.count()).toBe(1);
    expect(fake.createCalls).toBe(1);
  });

  it('processed/accredited validado => PAID uma única vez, libera POS e não regride', async () => {
    const s = await seedTenant(deps);
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta);
    await forcePoll(c.id);
    expect((await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PENDING');

    fake.setState(c.orderId!, 'processed', 'accredited');
    await forcePoll(c.id);
    const paid = await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } });
    expect(paid.status).toBe('PAID');
    expect(await deps.prisma.payment.count({ where: { chargeId: c.id } })).toBe(1);
    expect((await deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: s.posId } })).activeChargeId).toBeNull();

    // Reaplicar a mesma confirmação não duplica pagamento.
    await applyChargeTransition(deps.prisma, null, {
      chargeId: c.id,
      target: 'PAID',
      reasons: ['REPLAY'],
      payment: { mpPaymentId: `PAY${c.orderId}`, mpReferenceId: '1', amountCents: 100, paidAmountCents: 100, method: 'pix', status: 'processed', statusDetail: 'accredited' },
    });
    expect(await deps.prisma.payment.count({ where: { chargeId: c.id } })).toBe(1);

    // Resposta antiga (created/expired) nunca regride PAID.
    for (const target of ['PENDING', 'EXPIRED', 'RECONCILING'] as const) {
      const r = await applyChargeTransition(deps.prisma, null, { chargeId: c.id, target, reasons: ['STALE'] });
      expect(r.changed).toBe(false);
    }
    expect((await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PAID');

    // Trigger de banco também impede regressão direta.
    await expect(deps.prisma.charge.update({ where: { id: c.id }, data: { status: 'EXPIRED' } })).rejects.toThrow();

    // Após liberar o POS, nova cobrança é aceita.
    const next = await charges.create(s.auth, { posId: s.posId, amountCents: 250 }, undefined, meta);
    expect(next.status).toBe('PENDING');
  });

  it('expired/expired => EXPIRED, libera POS e agenda verificação de pagamento atrasado', async () => {
    const s = await seedTenant(deps);
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta);
    fake.setState(c.orderId!, 'expired', 'expired');
    await forcePoll(c.id);
    expect((await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('EXPIRED');
    expect((await deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: s.posId } })).activeChargeId).toBeNull();
    const job = await deps.prisma.pollingJob.findUniqueOrThrow({ where: { chargeId: c.id } });
    expect(job.done).toBe(false);
    expect(job.postTerminalCheckAt).not.toBeNull();
  });

  it('timeout/erro de comunicação nunca vira EXPIRED; após expiração vira RECONCILING e mantém POS', async () => {
    const s = await seedTenant(deps);
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta);
    fake.failGets = 100;
    await deps.prisma.charge.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 10 * 60_000) } });
    for (let i = 0; i < 6; i++) await forcePoll(c.id);
    const after = await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe('RECONCILING');
    expect((await deps.prisma.posTerminal.findUniqueOrThrow({ where: { id: s.posId } })).activeChargeId).toBe(c.id);

    // Comunicação volta e o MP confirma expiração: só então libera o POS.
    fake.failGets = 0;
    fake.setState(c.orderId!, 'expired', 'expired');
    await forcePoll(c.id);
    expect((await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('EXPIRED');
  });

  it('falha após criar a Order no MP: reconcilia pela mesma chave de idempotência sem duplicar', async () => {
    const s = await seedTenant(deps);
    fake.failNextCreateAfterCommit = true;
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 700 }, undefined, meta);
    expect(c.status).toBe('RECONCILING');
    expect(c.orderId).toBeNull();
    expect(fake.orders.size).toBe(1);

    await forcePoll(c.id); // reenvio idempotente
    const fixed = await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } });
    expect(fixed.orderId).toMatch(/^ORD/);
    expect(fixed.status).toBe('PENDING');
    expect(fake.orders.size).toBe(1);
    expect(fake.createCalls).toBe(2);
  });

  it('valor pago divergente => RECONCILING (nunca PAID)', async () => {
    const s = await seedTenant(deps);
    const c = await charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta);
    fake.paidAmountOverride = '0.99';
    fake.setState(c.orderId!, 'processed', 'accredited');
    await forcePoll(c.id);
    const after = await deps.prisma.charge.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe('RECONCILING');
    expect(after.statusReason).toContain('TOTAL_PAID_AMOUNT_MISMATCH');
    expect(await deps.prisma.payment.count()).toBe(0);
  });

  it('isolamento entre tenants: leitura e criação cruzadas retornam 404', async () => {
    const a = await seedTenant(deps);
    const b = await seedTenant(deps, { mpUserId: '888' });
    const c = await charges.create(a.auth, { posId: a.posId, amountCents: 100 }, undefined, meta);
    await expect(charges.detail(b.auth, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(charges.create(b.auth, { posId: a.posId, amountCents: 100 }, undefined, meta)).rejects.toMatchObject({ status: 404 });
    const list = await charges.list(b.auth, { page: 1, pageSize: 25 });
    expect(list.total).toBe(0);
  });

  it('vendedor restrito não acessa cobrança de loja não atribuída', async () => {
    const a = await seedTenant(deps);
    const c = await charges.create(a.auth, { posId: a.posId, amountCents: 100 }, undefined, meta);
    const seller = { ...a.auth, role: 'VENDEDOR' as const, storeIds: [] as string[] };
    await expect(charges.detail(seller, c.id)).rejects.toMatchObject({ status: 404 });
  });

  it('assinatura vencida bloqueia novas cobranças', async () => {
    const s = await seedTenant(deps, { subscriptionStatus: 'PAST_DUE' });
    await expect(charges.create(s.auth, { posId: s.posId, amountCents: 100 }, undefined, meta)).rejects.toBeInstanceOf(SubscriptionInactiveError);
    expect(fake.createCalls).toBe(0);
  });

  it('limites com concorrência: ativação simultânea não excede o plano', async () => {
    const s = await seedTenant(deps, { planId: 'inicial', posCount: 3, posStatus: 'PENDING_REVIEW' });
    const activate = (posId: string) =>
      deps.prisma.$transaction(async (tx) => {
        await assertCanActivate(tx, s.tenantId, 'pos');
        await tx.posTerminal.update({ where: { id: posId }, data: { status: 'ACTIVE' } });
      });
    const results = await Promise.allSettled(s.posIds.map(activate));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof PlanLimitError)).toHaveLength(2);
    expect(await deps.prisma.posTerminal.count({ where: { tenantId: s.tenantId, status: 'ACTIVE' } })).toBe(1);
  });

  it('tarifa: persiste fee/líquido quando expostos e mantém null quando ausentes', async () => {
    const s = await seedTenant(deps, { posCount: 2 });
    const c1 = await charges.create(s.auth, { posId: s.posIds[0]!, amountCents: 100 }, undefined, meta);
    fake.setState(c1.orderId!, 'processed', 'accredited');
    await forcePoll(c1.id);
    await syncPaymentFees(deps);
    const p1 = await deps.prisma.payment.findFirstOrThrow({ where: { chargeId: c1.id } });
    expect(p1.feeCents).toBe(0);
    expect(p1.netAmountCents).toBe(100);

    fake.exposeFees = false;
    const c2 = await charges.create(s.auth, { posId: s.posIds[1]!, amountCents: 100 }, undefined, meta);
    fake.setState(c2.orderId!, 'processed', 'accredited');
    await forcePoll(c2.id);
    await syncPaymentFees(deps);
    const p2 = await deps.prisma.payment.findFirstOrThrow({ where: { chargeId: c2.id } });
    expect(p2.feeCents).toBeNull();
    expect(p2.netAmountCents).toBeNull();
  });
});
