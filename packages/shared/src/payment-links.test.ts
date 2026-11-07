import { describe, expect, it } from 'vitest';
import { createPaymentLinkSchema, firstName, normalizeSearchName, paymentLinkMessage, whatsAppShareUrl } from './payment-links';

const STORE = '6f1c2a4e-1b2c-4d3e-8f90-1234567890ab';

describe('links de pagamento (regras compartilhadas)', () => {
  it('normaliza o nome para a busca: sem acento, minúsculo e espaços simples', () => {
    expect(normalizeSearchName('  João   da SILVA  ')).toBe('joao da silva');
    expect(normalizeSearchName('Conceição')).toBe('conceicao');
  });

  it('mostra só o primeiro nome', () => {
    expect(firstName('  Maria Clara Souza ')).toBe('Maria');
  });

  it('valida o cadastro: nome obrigatório, valor mínimo e WhatsApp normalizado', () => {
    const ok = createPaymentLinkSchema.parse({ storeId: STORE, customerName: 'Ana Lima', customerPhone: '(11) 98765-4321', amountCents: 5000 });
    expect(ok.customerPhone).toBe('5511987654321');
    expect(createPaymentLinkSchema.parse({ storeId: STORE, customerName: 'Ana', customerPhone: '', amountCents: 100 }).customerPhone).toBeUndefined();
    expect(createPaymentLinkSchema.safeParse({ storeId: STORE, customerName: 'A', amountCents: 5000 }).success).toBe(false);
    expect(createPaymentLinkSchema.safeParse({ storeId: STORE, customerName: 'Ana', amountCents: 99 }).success).toBe(false);
    expect(createPaymentLinkSchema.safeParse({ storeId: STORE, customerName: 'Ana', customerPhone: '123', amountCents: 5000 }).success).toBe(false);
  });

  it('monta a mensagem e o link do WhatsApp com o número do cliente', () => {
    const msg = paymentLinkMessage({ customerName: 'Ana Lima', tradeName: 'Café Bom', amount: 'R$ 50,00', description: 'Pedido 12', url: 'https://x/l/abc' });
    expect(msg).toBe('Olá, Ana! Segue o link para pagar R$ 50,00 via Pix a Café Bom referente a Pedido 12. O link vale por 24 horas: https://x/l/abc');
    expect(whatsAppShareUrl('5511987654321', 'oi')).toBe('https://wa.me/5511987654321?text=oi');
    expect(whatsAppShareUrl(null, 'a b')).toBe('https://wa.me/?text=a%20b');
  });
});
