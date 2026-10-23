import { describe, expect, it } from 'vitest';
import { advanceGiftProgress, cashbackFor, isRewardCode, normalizeRewardCode, rewardMessage } from './loyalty';
import { createChargeSchema, loyaltyCustomerSchema } from './schemas';

describe('fidelidade', () => {
  it('calcula cashback em centavos', () => {
    expect(cashbackFor(5_000, 500)).toBe(250);
    expect(cashbackFor(1_999, 500)).toBe(100);
    expect(cashbackFor(9, 500)).toBe(0);
  });

  it('avança o progresso do brinde', () => {
    expect(advanceGiftProgress(0, 10)).toEqual({ progress: 1, earned: 0 });
    expect(advanceGiftProgress(9, 10)).toEqual({ progress: 0, earned: 1 });
  });

  it('normaliza e valida códigos', () => {
    expect(normalizeRewardCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(isRewardCode('K7M2QX')).toBe(true);
    expect(isRewardCode('K7M2Q0')).toBe(false);
  });

  it('monta as mensagens ao cliente', () => {
    expect(rewardMessage({ customerName: 'Ana Souza', tradeName: 'Padaria Sol', kind: 'CASHBACK', code: 'K7M2QX', valueBrl: 'R$ 2,50' }))
      .toContain('Olá, Ana! Você ganhou *R$ 2,50* de cashback na *Padaria Sol*.');
    expect(rewardMessage({ customerName: 'Ana', tradeName: 'Padaria Sol', kind: 'GIFT', code: 'K7M2QX', description: '1 café', every: 10 }))
      .toContain('completou 10 compras');
  });

  it('valida cliente e código na cobrança', () => {
    expect(loyaltyCustomerSchema.parse({ name: 'Ana', phone: '(11) 98765-4321' })).toEqual({ name: 'Ana', phone: '5511987654321', whatsappOptIn: false });
    const id = '00000000-0000-4000-8000-000000000001';
    expect(createChargeSchema.parse({ posId: id, amountCents: 100, loyalty: { customerId: id, rewardCode: 'k7m2qx' } }).loyalty?.rewardCode).toBe('K7M2QX');
  });
});
