/**
 * "Quanto você economizou": compara a tarifa real paga nos Pix do AdapterPay com o que o lojista
 * pagaria recebendo o mesmo valor por Pix na maquininha ou por link de pagamento.
 * Taxas em pontos-base (49 = 0,49%). Cálculo em centavos inteiros, arredondado ao centavo.
 */

export const DEFAULT_SAVINGS_POS_RATE_BPS = 49;
export const DEFAULT_SAVINGS_LINK_RATE_BPS = 99;

export interface SavingsInput {
  /** Total recebido (centavos) nos Pix pagos do período. */
  grossCents: number;
  /** Soma das tarifas reais conhecidas (centavos); null quando nenhuma foi informada pelo provedor. */
  paidFeeCents: number | null;
  posRateBps: number;
  linkRateBps: number;
}

export interface SavingsResult {
  grossCents: number;
  paidFeeCents: number;
  posFeeCents: number;
  linkFeeCents: number;
  savedVsPosCents: number;
  savedVsLinkCents: number;
}

/** Tarifa percentual sobre um valor, arredondada ao centavo (meio para cima). */
export function feeForBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

export function computeSavings(i: SavingsInput): SavingsResult {
  const paid = i.paidFeeCents ?? 0;
  const pos = feeForBps(i.grossCents, i.posRateBps);
  const link = feeForBps(i.grossCents, i.linkRateBps);
  return {
    grossCents: i.grossCents,
    paidFeeCents: paid,
    posFeeCents: pos,
    linkFeeCents: link,
    savedVsPosCents: Math.max(0, pos - paid),
    savedVsLinkCents: Math.max(0, link - paid),
  };
}

/** 49 -> "0,49%" */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace('.', ',')}%`;
}

/** "0,49" ou "0.49" -> 49. Retorna null se inválido ou fora de 0–20%. */
export function parsePercentToBps(input: string): number | null {
  const m = /^\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= 2000 ? bps : null;
}

/**
 * Normaliza um WhatsApp brasileiro para dígitos com DDI: "(11) 98765-4321" -> "5511987654321".
 * Aceita com ou sem o 55. Retorna null se não parecer um número BR válido (DDD + 8/9 dígitos).
 */
export function normalizeBrWhatsApp(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(d)) return null;
  return `55${d}`;
}

/** "5511987654321" -> "(11) 98765-4321" */
export function formatBrWhatsApp(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.startsWith('55') ? e164.slice(2) : e164;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}
