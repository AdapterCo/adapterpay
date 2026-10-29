import { describe, expect, it } from 'vitest';
import type { Invoice, Prisma } from '@adapterpay/database';
import { applyCreditsOnInvoicePaid, grantWelcomeCredit } from './billing/credits';

type Row = Record<string, unknown>;

/** Banco em memória só com o que os créditos usam. */
function fakeDb(tenants: Record<string, Row>) {
  const credits: Row[] = [];
  const notifications: Row[] = [];
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const tx = {
    billingCredit: {
      findFirst: async ({ where }: { where: Row }) => credits.find((c) => matches(c, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => credits.find((c) => matches(c, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (credits.some((c) => c.kind === data.kind && data.referredTenantId && c.referredTenantId === data.referredTenantId)) throw new Error('unique');
        credits.push(data);
        return data;
      },
    },
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => tenants[where.id] ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => tenants[where.id]!,
      update: async ({ where, data }: { where: { id: string }; data: { billingCreditCents: { increment: number } } }) => {
        tenants[where.id]!.billingCreditCents = (tenants[where.id]!.billingCreditCents as number) + data.billingCreditCents.increment;
        return tenants[where.id];
      },
    },
    $executeRaw: async (_s: TemplateStringsArray, amount: number, id: string) => {
      tenants[id]!.billingCreditCents = Math.max((tenants[id]!.billingCreditCents as number) - amount, 0);
      return 1;
    },
    notification: { create: async ({ data }: { data: Row }) => { notifications.push(data); return { id: 'n', ...data }; } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, credits, notifications };
}

const invoice = (over: Partial<Invoice>) => ({ id: 'inv1', tenantId: 'novo', kind: 'INITIAL', creditAppliedCents: 0, amountCents: 1990, ...over }) as Invoice;

describe('créditos de indicação', () => {
  it('quem usou o código ganha R$ 10,00 uma única vez', async () => {
    const tenants = { novo: { id: 'novo', billingCreditCents: 0 } };
    const db = fakeDb(tenants);
    await grantWelcomeCredit(db.tx, 'novo');
    await grantWelcomeCredit(db.tx, 'novo');
    expect(tenants.novo.billingCreditCents).toBe(1000);
    expect(db.credits).toHaveLength(1);
  });

  it('primeira mensalidade paga: debita o crédito usado e dá R$ 10,00 a quem indicou (uma vez)', async () => {
    const tenants = {
      novo: { id: 'novo', tradeName: 'Café Novo', referredByTenantId: 'padrinho', billingCreditCents: 1000 },
      padrinho: { id: 'padrinho', deletedAt: null, billingCreditCents: 0 },
    };
    const db = fakeDb(tenants);
    await applyCreditsOnInvoicePaid(db.tx, invoice({ creditAppliedCents: 1000 }));
    expect(tenants.novo.billingCreditCents).toBe(0);
    expect(tenants.padrinho.billingCreditCents).toBe(1000);
    expect(db.notifications[0]).toMatchObject({ tenantId: 'padrinho', kind: 'referral.rewarded' });

    // Outra fatura inicial paga (ex.: reativação) não gera um segundo bônus.
    await applyCreditsOnInvoicePaid(db.tx, invoice({ id: 'inv2' }));
    expect(tenants.padrinho.billingCreditCents).toBe(1000);
  });

  it('renovação não gera bônus para quem indicou', async () => {
    const tenants = {
      novo: { id: 'novo', tradeName: 'Café Novo', referredByTenantId: 'padrinho', billingCreditCents: 0 },
      padrinho: { id: 'padrinho', deletedAt: null, billingCreditCents: 0 },
    };
    const db = fakeDb(tenants);
    await applyCreditsOnInvoicePaid(db.tx, invoice({ kind: 'RENEWAL' }));
    expect(tenants.padrinho.billingCreditCents).toBe(0);
  });
});
