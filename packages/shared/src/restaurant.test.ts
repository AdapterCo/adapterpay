import { describe, expect, it } from 'vitest';
import { currentShare, nextTableChargeCents, paidPercent, type TableBillState } from './restaurant';

const bill = (over: Partial<TableBillState>): TableBillState => ({ totalCents: 10_000, paidCents: 0, mode: null, splitCount: null, paidShares: 0, ...over });

describe('conta da mesa', () => {
  it('integral cobra tudo o que falta', () => {
    expect(nextTableChargeCents(bill({ mode: 'FULL' }))).toBe(10_000);
    expect(nextTableChargeCents(bill({ mode: 'FULL', paidCents: 2_500 }))).toBe(7_500);
  });

  it('dividido em 3 fecha o total exato, sem sobrar centavo', () => {
    let b = bill({ mode: 'SPLIT', splitCount: 3 });
    const paid: number[] = [];
    for (let i = 0; i < 3; i++) {
      const v = nextTableChargeCents(b);
      paid.push(v);
      b = { ...b, paidCents: b.paidCents + v, paidShares: b.paidShares + 1 };
    }
    expect(paid).toEqual([3_334, 3_333, 3_333]);
    expect(b.paidCents).toBe(10_000);
    expect(nextTableChargeCents(b)).toBe(0);
  });

  it('informa a vez de cada pessoa e o percentual pago', () => {
    expect(currentShare(bill({ mode: 'SPLIT', splitCount: 4, paidShares: 1 }))).toEqual({ number: 2, of: 4 });
    expect(currentShare(bill({ mode: 'FULL' }))).toBeNull();
    expect(paidPercent(bill({ paidCents: 5_000 }))).toBe(50);
  });

  it('se as partes acabarem com saldo, a última pessoa paga o restante', () => {
    expect(nextTableChargeCents(bill({ mode: 'SPLIT', splitCount: 2, paidShares: 2, paidCents: 9_000 }))).toBe(1_000);
  });
});
