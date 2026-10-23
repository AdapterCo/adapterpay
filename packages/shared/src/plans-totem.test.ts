import { describe, expect, it } from 'vitest';
import { acceptedMonthlyAmounts, subscriptionMonthlyCents } from './plans';

describe('adicional por totem', () => {
  const plan = { priceCents: 5_990, totemPriceCents: 4_990 };

  it('soma plano + totens', () => {
    expect(subscriptionMonthlyCents(plan, 0)).toBe(5_990);
    expect(subscriptionMonthlyCents(plan, 2)).toBe(15_970);
    expect(subscriptionMonthlyCents({ priceCents: 2_990, totemPriceCents: null }, 3)).toBe(2_990);
  });

  it('aceita cobranças do cartão com 0..N totens', () => {
    expect(acceptedMonthlyAmounts(plan, 2)).toEqual([5_990, 10_980, 15_970]);
  });
});
