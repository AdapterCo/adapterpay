/**
 * Fidelidade da loja. Duas modalidades:
 * - CASHBACK: cada compra paga gera um código com X% do valor, usado como desconto na próxima compra;
 * - GIFT: a cada N compras pagas o cliente ganha um código de brinde.
 * Os códigos são de uso único. Cálculos em centavos inteiros.
 */

export const LOYALTY_MODES = ['OFF', 'CASHBACK', 'GIFT'] as const;
export type LoyaltyMode = (typeof LOYALTY_MODES)[number];

/** Sem 0/O, 1/I/L: fácil de ditar no balcão. */
export const REWARD_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REWARD_CODE_LENGTH = 6;

export function normalizeRewardCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isRewardCode(code: string): boolean {
  return code.length === REWARD_CODE_LENGTH && [...code].every((c) => REWARD_CODE_ALPHABET.includes(c));
}

/** Cashback de uma compra, arredondado ao centavo. */
export function cashbackFor(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

/** Avança o progresso do brinde: quantos brindes a compra libera e o progresso restante. */
export function advanceGiftProgress(progress: number, every: number): { progress: number; earned: number } {
  const next = progress + 1;
  return next >= every ? { progress: next - every, earned: 1 } : { progress: next, earned: 0 };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Mensagem de WhatsApp ao cliente quando ganha uma recompensa. */
export function rewardMessage(p: {
  customerName: string;
  tradeName: string;
  kind: 'CASHBACK' | 'GIFT';
  code: string;
  valueBrl?: string;
  description?: string | null;
  every?: number;
}): string {
  const hi = firstName(p.customerName);
  if (p.kind === 'CASHBACK') {
    return [
      `Olá, ${hi}! Você ganhou *${p.valueBrl}* de cashback na *${p.tradeName}*.`,
      `Seu código: *${p.code}*`,
      'Informe o código no caixa na próxima compra para usar o desconto.',
    ].join('\n');
  }
  return [
    `Parabéns, ${hi}! Você completou ${p.every ?? ''} compras na *${p.tradeName}* e ganhou: *${p.description ?? 'um brinde'}*.`,
    `Seu código: *${p.code}*`,
    'Mostre o código no caixa para resgatar.',
  ].join('\n');
}
