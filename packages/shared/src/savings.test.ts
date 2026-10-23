import { describe, expect, it } from 'vitest';
import { computeSavings, feeForBps, formatBps, formatBrWhatsApp, normalizeBrWhatsApp, parsePercentToBps } from './savings';

describe('savings', () => {
  it('calcula a economia contra maquininha (0,49%) e link (0,99%)', () => {
    const r = computeSavings({ grossCents: 3_025_000, paidFeeCents: 2, posRateBps: 49, linkRateBps: 99 });
    expect(r.posFeeCents).toBe(14_823);
    expect(r.linkFeeCents).toBe(29_948);
    expect(r.savedVsPosCents).toBe(14_821);
    expect(r.savedVsLinkCents).toBe(29_946);
  });

  it('tarifa desconhecida conta como zero e economia nunca fica negativa', () => {
    expect(computeSavings({ grossCents: 10_000, paidFeeCents: null, posRateBps: 49, linkRateBps: 99 }).paidFeeCents).toBe(0);
    expect(computeSavings({ grossCents: 10_000, paidFeeCents: 500, posRateBps: 49, linkRateBps: 99 }).savedVsPosCents).toBe(0);
  });

  it('arredonda ao centavo', () => {
    expect(feeForBps(101, 49)).toBe(0);
    expect(feeForBps(10_000, 49)).toBe(49);
    expect(feeForBps(103, 49)).toBe(1);
  });

  it('converte e formata percentuais', () => {
    expect(parsePercentToBps('0,49')).toBe(49);
    expect(parsePercentToBps('0.99%')).toBe(99);
    expect(parsePercentToBps('1,5')).toBe(150);
    expect(parsePercentToBps('25')).toBeNull();
    expect(parsePercentToBps('abc')).toBeNull();
    expect(formatBps(49)).toBe('0,49%');
  });

  it('normaliza WhatsApp brasileiro', () => {
    expect(normalizeBrWhatsApp('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizeBrWhatsApp('+55 21 3456-7890')).toBe('552134567890');
    expect(normalizeBrWhatsApp('5511987654321')).toBe('5511987654321');
    expect(normalizeBrWhatsApp('12345')).toBeNull();
    expect(normalizeBrWhatsApp('(01) 98765-4321')).toBeNull();
    expect(formatBrWhatsApp('5511987654321')).toBe('(11) 98765-4321');
  });
});
