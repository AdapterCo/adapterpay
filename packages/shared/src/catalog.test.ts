import { describe, expect, it } from 'vitest';
import { cartDescription, cartTotalCents } from './catalog';
import { createChargeSchema } from './schemas';

describe('catálogo', () => {
  const lines = [
    { name: 'Café', unitPriceCents: 650, quantity: 2 },
    { name: 'Pão de queijo', unitPriceCents: 500, quantity: 1 },
  ];

  it('soma o carrinho em centavos', () => {
    expect(cartTotalCents(lines)).toBe(1800);
  });

  it('gera a descrição e corta textos longos', () => {
    expect(cartDescription(lines)).toBe('2x Café, 1x Pão de queijo');
    const long = cartDescription([{ name: 'X'.repeat(200), unitPriceCents: 1, quantity: 1 }]);
    expect(long.length).toBe(140);
    expect(long.endsWith('…')).toBe(true);
  });

  it('rejeita produto repetido no carrinho', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const r = createChargeSchema.safeParse({
      posId: id,
      amountCents: 100,
      items: [{ productId: id, quantity: 1 }, { productId: id, quantity: 2 }],
    });
    expect(r.success).toBe(false);
  });
});
