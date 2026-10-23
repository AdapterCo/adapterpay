import { describe, expect, it } from 'vitest';
import { computeSavings } from '@adapterpay/shared';
import { closingWindow, formatDailyClosing, localDayHour, localMidnight, type DailyClosing } from './reports/daily-closing';

const TZ = 'America/Sao_Paulo';

describe('fechamento diário', () => {
  it('converte dia/hora locais em São Paulo (UTC-3)', () => {
    expect(localDayHour(new Date('2026-10-22T01:30:00Z'), TZ)).toEqual({ day: '2026-10-21', hour: 22 });
    expect(localMidnight('2026-10-22', TZ).toISOString()).toBe('2026-10-22T03:00:00.000Z');
  });

  it('envio às 22h resume o dia atual até o envio', () => {
    const now = new Date('2026-10-23T01:05:00Z'); // 22:05 de 22/10 em SP
    const w = closingWindow(now, TZ, 22);
    expect(w.day).toBe('2026-10-22');
    expect(w.from.toISOString()).toBe('2026-10-22T03:00:00.000Z');
    expect(w.to).toBe(now);
    expect(w.partial).toBe(true);
  });

  it('envio até 5h resume o dia anterior inteiro', () => {
    const w = closingWindow(new Date('2026-10-23T05:10:00Z'), TZ, 2); // 02:10 de 23/10 em SP
    expect(w.day).toBe('2026-10-22');
    expect(w.from.toISOString()).toBe('2026-10-22T03:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-23T03:00:00.000Z');
    expect(w.partial).toBe(false);
  });

  it('monta a mensagem com totais, caixas, vendedores e economia', () => {
    const c: DailyClosing = {
      tradeName: 'Padaria Sol',
      day: '2026-10-22',
      timeZone: TZ,
      until: new Date('2026-10-23T01:00:00Z'),
      partial: true,
      paidCount: 3,
      grossCents: 15_000,
      averageCents: 5_000,
      expiredCount: 1,
      byPos: [{ name: 'Centro · Caixa 1', count: 3, grossCents: 15_000 }],
      bySeller: [{ name: 'Ana', count: 3, grossCents: 15_000 }],
      feeUnknownCount: 0,
      savings: computeSavings({ grossCents: 15_000, paidFeeCents: 0, posRateBps: 49, linkRateBps: 99 }),
      posRateBps: 49,
      linkRateBps: 99,
    };
    const text = formatDailyClosing(c);
    expect(text).toContain('*Fechamento de caixa — Padaria Sol*');
    expect(text).toContain('22/10/2026 (quinta) até 22:00');
    expect(text).toContain('Total recebido: *R$ 150,00*');
    expect(text).toContain('Vendas: 3 · Ticket médio: R$ 50,00');
    expect(text).toContain('• Centro · Caixa 1: R$ 150,00 (3)');
    expect(text).toContain('Pix na maquininha (0,49%): R$ 0,74 → economia de *R$ 0,74*');
    expect(formatDailyClosing({ ...c, paidCount: 0, byPos: [], bySeller: [] })).toContain('Nenhuma venda paga no período.');
  });
});
