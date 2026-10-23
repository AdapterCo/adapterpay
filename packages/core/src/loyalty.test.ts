import { describe, expect, it } from 'vitest';
import type { Prisma } from '@adapterpay/database';
import { applyLoyaltyOnTransition, generateRewardCode } from './loyalty/loyalty';

type Row = Record<string, unknown>;

/** Banco em memória com apenas o que a fidelidade usa (sem Postgres). */
function fakeTx(tenant: Row, customer: Row, rewards: Row[] = []) {
  const notifications: Row[] = [];
  const match = (r: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(r, w));
      return r[k] === v;
    });
  const tx = {
    tenant: { findUniqueOrThrow: async () => tenant },
    loyaltyCustomer: {
      findUnique: async () => customer,
      update: async ({ data }: { data: Row }) => {
        for (const [k, v] of Object.entries(data)) {
          customer[k] = typeof v === 'object' && v && 'increment' in v ? (customer[k] as number) + (v as { increment: number }).increment : v;
        }
        return customer;
      },
    },
    loyaltyReward: {
      findFirst: async ({ where }: { where: Row }) => rewards.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = { id: `r${rewards.length + 1}`, status: 'AVAILABLE', ...data };
        rewards.push(r);
        return r;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rewards.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    notification: { create: async ({ data }: { data: Row }) => { notifications.push(data); return { id: 'n1', ...data }; } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, rewards, customer, notifications };
}

const baseTenant = { loyaltyMode: 'CASHBACK', loyaltyCashbackBps: 500, loyaltyGiftEvery: 3, loyaltyGiftName: '1 café', loyaltyMinPurchaseCents: 0 };
const charge = (over: Row = {}) => ({ id: 'c1', tenantId: 't1', amountCents: 5_000, externalReference: 'REF', loyaltyCustomerId: 'k1', loyaltyRewardId: null, ...over }) as never;
const newCustomer = () => ({ id: 'k1', purchaseCount: 0, totalSpentCents: 0, giftProgress: 0 });

describe('fidelidade no ciclo da cobrança', () => {
  it('gera códigos com 6 caracteres do alfabeto sem ambiguidades', () => {
    expect(generateRewardCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it('paga: credita 5% de cashback em um código e soma a compra', async () => {
    const f = fakeTx({ ...baseTenant }, newCustomer());
    await applyLoyaltyOnTransition(f.tx, charge(), 'PENDING', 'PAID');
    expect(f.rewards).toHaveLength(1);
    expect(f.rewards[0]).toMatchObject({ kind: 'CASHBACK', valueCents: 250, earnedChargeId: 'c1', status: 'AVAILABLE' });
    expect(f.customer).toMatchObject({ purchaseCount: 1, totalSpentCents: 5_000 });
  });

  it('compra abaixo do mínimo conta na compra, mas não gera cashback', async () => {
    const f = fakeTx({ ...baseTenant, loyaltyMinPurchaseCents: 10_000 }, newCustomer());
    await applyLoyaltyOnTransition(f.tx, charge(), 'PENDING', 'PAID');
    expect(f.rewards).toHaveLength(0);
    expect(f.customer.purchaseCount).toBe(1);
  });

  it('brinde sai na 3ª compra e o progresso recomeça', async () => {
    const f = fakeTx({ ...baseTenant, loyaltyMode: 'GIFT' }, { ...newCustomer(), giftProgress: 2 });
    await applyLoyaltyOnTransition(f.tx, charge(), 'PENDING', 'PAID');
    expect(f.rewards[0]).toMatchObject({ kind: 'GIFT', description: '1 café' });
    expect(f.customer.giftProgress).toBe(0);
  });

  it('código reservado vira usado no pagamento e volta a ficar disponível se expirar', async () => {
    const reserved = () => [{ id: 'r9', code: 'K7M2QX', kind: 'CASHBACK', valueCents: 300, status: 'RESERVED', reservedChargeId: 'c1' }];
    const paid = fakeTx({ ...baseTenant }, newCustomer(), reserved());
    await applyLoyaltyOnTransition(paid.tx, charge({ loyaltyRewardId: 'r9' }), 'PENDING', 'PAID');
    expect(paid.rewards[0]).toMatchObject({ status: 'USED', reservedChargeId: null });

    const expired = fakeTx({ ...baseTenant }, newCustomer(), reserved());
    await applyLoyaltyOnTransition(expired.tx, charge({ loyaltyRewardId: 'r9' }), 'PENDING', 'EXPIRED');
    expect(expired.rewards[0]).toMatchObject({ status: 'AVAILABLE', reservedChargeId: null });
  });

  it('pagamento atrasado com código já usado em outra compra avisa o lojista', async () => {
    const f = fakeTx({ ...baseTenant }, newCustomer(), [{ id: 'r9', status: 'USED', reservedChargeId: null }]);
    await applyLoyaltyOnTransition(f.tx, charge({ loyaltyRewardId: 'r9' }), 'EXPIRED', 'PAID');
    expect(f.notifications[0]).toMatchObject({ kind: 'loyalty.code_reused' });
  });

  it('estorno cancela o cashback ainda não usado e desconta a compra', async () => {
    const f = fakeTx({ ...baseTenant }, { id: 'k1', purchaseCount: 1, totalSpentCents: 5_000, giftProgress: 1 }, [
      { id: 'r1', status: 'AVAILABLE', earnedChargeId: 'c1' },
    ]);
    await applyLoyaltyOnTransition(f.tx, charge(), 'PAID', 'REFUNDED');
    expect(f.rewards[0]!.status).toBe('CANCELLED');
    expect(f.customer).toMatchObject({ purchaseCount: 0, totalSpentCents: 0, giftProgress: 0 });
  });
});
