import { describe, expect, it } from 'vitest';
import type { Prisma } from '@adapterpay/database';
import { applyTableBillOnTransition } from './restaurant/table-bill';

type Row = Record<string, unknown>;

/** Banco em memória só com o que a conta da mesa usa. */
function fakeTx(bill: Row) {
  const notifications: Row[] = [];
  const tx = {
    $queryRaw: async () => [{ id: bill.id }],
    tableBill: {
      findUniqueOrThrow: async () => ({ ...bill, table: { name: 'Mesa 7' } }),
      update: async ({ data }: { data: Row }) => {
        for (const [k, v] of Object.entries(data)) {
          bill[k] = typeof v === 'object' && v && 'increment' in v ? (bill[k] as number) + (v as { increment: number }).increment : v;
        }
        return bill;
      },
    },
    notification: { create: async ({ data }: { data: Row }) => { notifications.push(data); return { id: 'n', ...data }; } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, bill, notifications };
}

const charge = (amountCents: number) => ({ id: 'c', tenantId: 't', amountCents, tableBillId: 'b1' });

describe('conta da mesa no pagamento', () => {
  it('dividida em 2: a primeira parte soma e libera a próxima; a segunda fecha a mesa', async () => {
    const f = fakeTx({ id: 'b1', status: 'OPEN', totalCents: 10_000, paidCents: 0, mode: 'SPLIT', splitCount: 2, paidShares: 0 });
    await applyTableBillOnTransition(f.tx, charge(5_000), 'PENDING', 'PAID');
    expect(f.bill).toMatchObject({ paidCents: 5_000, paidShares: 1, status: 'OPEN' });
    await applyTableBillOnTransition(f.tx, charge(5_000), 'PENDING', 'PAID');
    expect(f.bill).toMatchObject({ paidCents: 10_000, paidShares: 2, status: 'PAID' });
    expect(f.notifications.at(-1)).toMatchObject({ kind: 'table.paid', title: 'Mesa 7 paga' });
  });

  it('integral fecha a mesa no primeiro pagamento', async () => {
    const f = fakeTx({ id: 'b1', status: 'OPEN', totalCents: 8_000, paidCents: 0, mode: 'FULL', splitCount: null, paidShares: 0 });
    await applyTableBillOnTransition(f.tx, charge(8_000), 'PENDING', 'PAID');
    expect(f.bill).toMatchObject({ status: 'PAID', paidCents: 8_000 });
  });

  it('pagamento atrasado de conta já fechada só avisa o lojista', async () => {
    const f = fakeTx({ id: 'b1', status: 'PAID', totalCents: 8_000, paidCents: 8_000, mode: 'FULL', splitCount: null, paidShares: 0 });
    await applyTableBillOnTransition(f.tx, charge(2_000), 'EXPIRED', 'PAID');
    expect(f.bill.paidCents).toBe(8_000);
    expect(f.notifications[0]).toMatchObject({ kind: 'table.overpaid' });
  });

  it('ignora cobranças que não são de mesa ou que não viraram pagas', async () => {
    const f = fakeTx({ id: 'b1', status: 'OPEN', totalCents: 8_000, paidCents: 0, mode: 'FULL', splitCount: null, paidShares: 0 });
    await applyTableBillOnTransition(f.tx, { ...charge(8_000), tableBillId: null }, 'PENDING', 'PAID');
    await applyTableBillOnTransition(f.tx, charge(8_000), 'PENDING', 'EXPIRED');
    expect(f.bill.paidCents).toBe(0);
  });
});
