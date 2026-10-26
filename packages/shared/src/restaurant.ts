/**
 * Modo Restaurante: conta da mesa paga integral ou dividida. As partes são pagas uma de cada vez
 * no POS da mesa (o Mercado Pago aceita uma cobrança ativa por POS).
 */

export const TABLE_MAX_PEOPLE = 20;

export interface TableBillState {
  totalCents: number;
  paidCents: number;
  mode: 'FULL' | 'SPLIT' | null;
  splitCount: number | null;
  paidShares: number;
}

export function remainingCents(b: Pick<TableBillState, 'totalCents' | 'paidCents'>): number {
  return Math.max(0, b.totalCents - b.paidCents);
}

/** Partes que ainda faltam pagar na divisão (pelo menos 1 enquanto houver saldo). */
export function sharesLeft(b: TableBillState): number {
  if (b.mode !== 'SPLIT' || !b.splitCount) return 1;
  return Math.max(1, b.splitCount - b.paidShares);
}

/**
 * Valor da próxima cobrança: integral = tudo o que falta; dividido = o que falta ÷ partes restantes,
 * arredondado para cima. Recalculado a cada pagamento, a soma das partes fecha exatamente o total
 * (R$ 100,00 ÷ 3 = 33,34 + 33,33 + 33,33).
 */
export function nextTableChargeCents(b: TableBillState): number {
  const rest = remainingCents(b);
  if (rest === 0) return 0;
  if (b.mode !== 'SPLIT') return rest;
  return Math.ceil(rest / sharesLeft(b));
}

/** Número da pessoa que paga agora (1-based) e o total de pessoas. */
export function currentShare(b: TableBillState): { number: number; of: number } | null {
  if (b.mode !== 'SPLIT' || !b.splitCount) return null;
  return { number: Math.min(b.paidShares + 1, b.splitCount), of: b.splitCount };
}

export function paidPercent(b: Pick<TableBillState, 'totalCents' | 'paidCents'>): number {
  if (b.totalCents <= 0) return 0;
  return Math.min(100, Math.floor((b.paidCents / b.totalCents) * 100));
}
