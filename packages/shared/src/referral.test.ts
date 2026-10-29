import { describe, expect, it } from 'vitest';
import { creditDiscountCents, isReferralCode, normalizeReferralCode, referralLink } from './referral';
import { registerSchema } from './schemas';

const base = {
  planId: 'inicial',
  legalName: 'Café Exemplo Ltda',
  tradeName: 'Café Exemplo',
  taxId: '11.222.333/0001-81',
  adminName: 'Fulana',
  email: 'dona@example.com',
  password: 'senhaforte123',
  acceptTerms: true as const,
};

describe('indicação', () => {
  it('desconto cobre o crédito sem deixar a fatura abaixo de R$ 1,00', () => {
    expect(creditDiscountCents(2990, 1000)).toBe(1000);
    expect(creditDiscountCents(2990, 5000)).toBe(2890);
    expect(creditDiscountCents(2990, 0)).toBe(0);
    expect(creditDiscountCents(100, 1000)).toBe(0);
  });

  it('código é normalizado e validado', () => {
    expect(normalizeReferralCode(' k7q2-mx9a ')).toBe('K7Q2MX9A');
    expect(isReferralCode('K7Q2MX9A')).toBe(true);
    expect(isReferralCode('K7Q2MX90')).toBe(false); // 0 não faz parte do alfabeto
    expect(referralLink('https://app.example.com/', 'K7Q2MX9A')).toBe('https://app.example.com/cadastro?ref=K7Q2MX9A');
  });

  it('cadastro aceita sem código, com código válido e recusa código inválido', () => {
    expect(registerSchema.parse(base).referralCode).toBeUndefined();
    expect(registerSchema.parse({ ...base, referralCode: '' }).referralCode).toBeUndefined();
    expect(registerSchema.parse({ ...base, referralCode: 'k7q2mx9a' }).referralCode).toBe('K7Q2MX9A');
    expect(registerSchema.safeParse({ ...base, referralCode: 'ABC' }).success).toBe(false);
  });
});
