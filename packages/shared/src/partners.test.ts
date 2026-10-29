import { describe, expect, it } from 'vitest';
import { maskBusinessName, maskPixKey, normalizePixKey, partnerSignupSchema } from './partners';

describe('parceiros de indicação', () => {
  it('chave Pix normalizada por tipo', () => {
    expect(normalizePixKey('CPF_CNPJ', '123.456.789-09')).toBe('12345678909');
    expect(normalizePixKey('CPF_CNPJ', '123')).toBeNull();
    expect(normalizePixKey('PHONE', '(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePixKey('EMAIL', ' Fulana@Example.com ')).toBe('fulana@example.com');
    expect(normalizePixKey('EMAIL', 'sem-arroba')).toBeNull();
    expect(normalizePixKey('RANDOM', '123E4567-E89B-12D3-A456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(normalizePixKey('RANDOM', 'abc')).toBeNull();
  });

  it('o parceiro vê a chave e os indicados abreviados', () => {
    expect(maskPixKey('12345678909')).toBe('123••••••09');
    expect(maskBusinessName('Café Exemplo da Esquina')).toBe('Café E. D. E.');
    expect(maskBusinessName('Mercadinho')).toBe('Mercadinho');
  });

  it('cadastro valida WhatsApp, chave do tipo escolhido e aceite', () => {
    const ok = partnerSignupSchema.parse({ name: 'Fulana de Tal', phone: '(11) 98765-4321', pixKeyType: 'EMAIL', pixKey: 'Fulana@Example.com', acceptTerms: true });
    expect(ok).toMatchObject({ phone: '5511987654321', pixKey: 'fulana@example.com' });
    const bad = partnerSignupSchema.safeParse({ name: 'Fulana de Tal', phone: '123', pixKeyType: 'CPF_CNPJ', pixKey: 'x@y.com', acceptTerms: true });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['phone']));
  });
});
