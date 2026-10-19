import { describe, expect, it } from 'vitest';
import {
  centsToDecimalString,
  decimalStringToCents,
  formatBRL,
  parseBrlInputToCents,
  tryDecimalStringToCents,
} from './money';

describe('centsToDecimalString', () => {
  it.each([
    [9900, '99.00'],
    [100, '1.00'],
    [5, '0.05'],
    [0, '0.00'],
    [123456789, '1234567.89'],
  ])('%i -> %s', (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });

  it('rejeita negativo e não inteiro', () => {
    expect(() => centsToDecimalString(-1)).toThrow();
    expect(() => centsToDecimalString(1.5)).toThrow();
    expect(() => centsToDecimalString(Number.NaN)).toThrow();
  });
});

describe('decimalStringToCents', () => {
  it.each([
    ['99.00', 9900],
    ['1.00', 100],
    ['1.5', 150],
    ['10', 1000],
    ['0.01', 1],
    ['0.10', 10],
  ])('%s -> %i', (s, expected) => {
    expect(decimalStringToCents(s)).toBe(expected);
  });

  it.each(['1,00', '-1.00', '1.001', '1e2', '', 'abc', '01.00', '.50', '1.'])('rejeita %s', (s) => {
    expect(() => decimalStringToCents(s)).toThrow();
  });

  it('é exato onde float falharia', () => {
    expect(decimalStringToCents('0.29')).toBe(29);
    expect(decimalStringToCents('1.15')).toBe(115);
    expect(decimalStringToCents('4.35')).toBe(435);
  });

  it('ida e volta preserva o valor', () => {
    for (const c of [1, 29, 115, 435, 9999, 100000]) {
      expect(decimalStringToCents(centsToDecimalString(c))).toBe(c);
    }
  });
});

describe('tryDecimalStringToCents', () => {
  it('aceita number vindo de /v1/payments', () => {
    expect(tryDecimalStringToCents(1)).toBe(100);
    expect(tryDecimalStringToCents(0.99)).toBe(99);
  });
  it('retorna null para ausente/inválido', () => {
    expect(tryDecimalStringToCents(undefined)).toBeNull();
    expect(tryDecimalStringToCents('x')).toBeNull();
    expect(tryDecimalStringToCents(-1)).toBeNull();
  });
});

describe('parseBrlInputToCents / formatBRL', () => {
  it('interpreta entrada pt-BR', () => {
    expect(parseBrlInputToCents('99,90')).toBe(9990);
    expect(parseBrlInputToCents('1.234,56')).toBe(123456);
    expect(parseBrlInputToCents('R$ 1,00')).toBe(100);
    expect(parseBrlInputToCents('7')).toBe(700);
    expect(() => parseBrlInputToCents('1.2,3')).toThrow();
  });
  it('formata', () => {
    expect(formatBRL(9990)).toBe('R$ 99,90');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(null)).toBe('—');
  });
});
