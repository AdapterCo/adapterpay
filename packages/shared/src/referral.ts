import { REWARD_CODE_ALPHABET } from './loyalty';

/**
 * Indicação de lojistas. Quem indica ganha REFERRAL_BONUS_CENTS de crédito quando o indicado paga a
 * primeira mensalidade; quem se cadastra com o código ganha REFERRAL_WELCOME_CENTS uma única vez.
 * Os créditos viram desconto nas mensalidades, sem deixar a fatura abaixo de MIN_INVOICE_CENTS.
 */
export const REFERRAL_BONUS_CENTS = 1000;
export const REFERRAL_WELCOME_CENTS = 1000;
export const MIN_INVOICE_CENTS = 100;
export const REFERRAL_CODE_LENGTH = 8;
/** Mesmo alfabeto dos códigos de fidelidade (sem 0/O, 1/I/L), fácil de ditar. */
export const REFERRAL_CODE_ALPHABET = REWARD_CODE_ALPHABET;

/** Desconto que o crédito disponível cobre nesta fatura. */
export function creditDiscountCents(amountCents: number, availableCreditCents: number): number {
  if (availableCreditCents <= 0 || amountCents <= MIN_INVOICE_CENTS) return 0;
  return Math.min(availableCreditCents, amountCents - MIN_INVOICE_CENTS);
}

/** Código digitado ou vindo do link: maiúsculas, sem espaços e traços. */
export function normalizeReferralCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isReferralCode(value: string): boolean {
  return value.length === REFERRAL_CODE_LENGTH && [...value].every((c) => REFERRAL_CODE_ALPHABET.includes(c));
}

export function referralLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, '')}/cadastro?ref=${encodeURIComponent(code)}`;
}
