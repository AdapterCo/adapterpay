/**
 * Conversões monetárias exatas. Valores internos são sempre centavos inteiros (number seguro).
 * A API do Mercado Pago recebe/retorna strings decimais com duas casas ("99.00").
 * Nunca usar float para cálculo: a conversão é feita por manipulação de string/inteiros.
 */

export const MAX_CHARGE_CENTS = 100_000_000; // R$ 1.000.000,00 — limite de sanidade por cobrança

export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyFormatError';
  }
}

function assertSafeCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyFormatError(`Valor em centavos inválido: ${cents}`);
  }
}

/** 9900 -> "99.00"; 5 -> "0.05". Rejeita negativos e não inteiros. */
export function centsToDecimalString(cents: number): string {
  assertSafeCents(cents);
  if (cents < 0) throw new MoneyFormatError('Valor negativo não é permitido');
  const reais = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${reais}.${rest.toString().padStart(2, '0')}`;
}

const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/**
 * Converte string decimal do provedor ("99.00", "1.5", "10") em centavos.
 * Rejeita qualquer formato ambíguo (vírgula, sinal, notação científica, mais de 2 casas).
 */
export function decimalStringToCents(value: string): number {
  if (typeof value !== 'string') throw new MoneyFormatError('Valor monetário ausente');
  const trimmed = value.trim();
  const match = DECIMAL_RE.exec(trimmed);
  if (!match) throw new MoneyFormatError(`Formato monetário inválido: "${value}"`);
  const reais = match[1]!;
  const frac = (match[2] ?? '').padEnd(2, '0');
  if (reais.length > 13) throw new MoneyFormatError('Valor monetário excede o limite');
  const cents = Number(reais) * 100 + Number(frac);
  assertSafeCents(cents);
  return cents;
}

/**
 * Versão tolerante: retorna null quando ausente ou inválido.
 * Alguns endpoints (ex.: /v1/payments) retornam number; a conversão usa toFixed(2) e parsing de string.
 */
export function tryDecimalStringToCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    try {
      return decimalStringToCents(value.toFixed(2));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'string') return null;
  try {
    return decimalStringToCents(value);
  } catch {
    return null;
  }
}

const BRL_INPUT_RE = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

/** Entrada do usuário em pt-BR: "1.234,56", "99", "0,5". */
export function parseBrlInputToCents(input: string): number {
  const trimmed = input.replace(/^R\$\s*/i, '').trim();
  const match = BRL_INPUT_RE.exec(trimmed);
  if (!match) throw new MoneyFormatError('Informe um valor como 99,90');
  const reais = match[1]!.replace(/\./g, '');
  const frac = (match[2] ?? '').padEnd(2, '0');
  const cents = Number(reais) * 100 + Number(frac);
  assertSafeCents(cents);
  return cents;
}

/** 9990 -> "R$ 99,90" */
export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  assertSafeCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100).toString();
  const rest = (abs % 100).toString().padStart(2, '0');
  const withThousands = reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${withThousands},${rest}`;
}
