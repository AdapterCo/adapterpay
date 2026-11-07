import { describe, expect, it } from 'vitest';
import { createChargeSchema } from './schemas';
import { firstName, normalizeSearchName, PAYMENT_LINK_EXPIRATION_ISO, paymentLinkMessage, whatsAppShareUrl } from './payment-links';

const POS = '6f1c2a4e-1b2c-4d3e-8f90-1234567890ab';

describe('links de pagamento (regras compartilhadas)', () => {
  it('normaliza o nome para a busca: sem acento, minúsculo e espaços simples', () => {
    expect(normalizeSearchName('  João   da SILVA  ')).toBe('joao da silva');
    expect(normalizeSearchName('Conceição')).toBe('conceicao');
  });

  it('mostra só o primeiro nome e vale 24 horas', () => {
    expect(firstName('  Maria Clara Souza ')).toBe('Maria');
    expect(PAYMENT_LINK_EXPIRATION_ISO).toBe('PT24H');
  });

  it('o link é a mesma cobrança, com nome do cliente obrigatório e WhatsApp normalizado', () => {
    const ok = createChargeSchema.parse({ posId: POS, amountCents: 5000, paymentLink: { customerName: 'Ana Lima', customerPhone: '(11) 98765-4321' } });
    expect(ok.paymentLink?.customerPhone).toBe('5511987654321');
    expect(createChargeSchema.parse({ posId: POS, amountCents: 100, paymentLink: { customerName: 'Ana', customerPhone: '' } }).paymentLink?.customerPhone).toBeUndefined();
    expect(createChargeSchema.safeParse({ posId: POS, amountCents: 5000, paymentLink: { customerName: 'A' } }).success).toBe(false);
    expect(createChargeSchema.safeParse({ posId: POS, amountCents: 5000, paymentLink: { customerName: 'Ana', customerPhone: '123' } }).success).toBe(false);
    expect(createChargeSchema.parse({ posId: POS, amountCents: 5000 }).paymentLink).toBeUndefined();
  });

  it('monta a mensagem e o link do WhatsApp com o número do cliente', () => {
    const msg = paymentLinkMessage({ customerName: 'Ana Lima', tradeName: 'Café Bom', amount: 'R$ 50,00', description: 'Pedido 12', url: 'https://x/c/abc' });
    expect(msg).toBe('Olá, Ana! Segue o link para pagar R$ 50,00 via Pix a Café Bom referente a Pedido 12. O link vale por 24 horas: https://x/c/abc');
    expect(whatsAppShareUrl('5511987654321', 'oi')).toBe('https://wa.me/5511987654321?text=oi');
    expect(whatsAppShareUrl(null, 'a b')).toBe('https://wa.me/?text=a%20b');
  });
});
