import { z } from 'zod';
import { normalizeBrWhatsApp } from './savings';

/**
 * Link de pagamento: é uma cobrança comum (POST /charges, mesma Order no POS e mesma página /c/:token),
 * só que vale 24 horas e guarda o nome do cliente para a aba de links.
 */
export const PAYMENT_LINK_TTL_HOURS = 24;
export const PAYMENT_LINK_EXPIRATION_ISO = `PT${PAYMENT_LINK_TTL_HOURS}H`;

/** Forma usada na busca por nome: sem acentos, minúscula e com espaços simples ("João  Silva" -> "joao silva"). */
export function normalizeSearchName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/** Mensagem pronta para o WhatsApp do cliente. */
export function paymentLinkMessage(p: { customerName: string; tradeName: string; amount: string; description: string | null; url: string }): string {
  const what = p.description ? ` referente a ${p.description}` : '';
  return `Olá, ${firstName(p.customerName)}! Segue o link para pagar ${p.amount} via Pix a ${p.tradeName}${what}. O link vale por ${PAYMENT_LINK_TTL_HOURS} horas: ${p.url}`;
}

/** wa.me com o número do cliente (quando informado) ou sem número, para escolher o contato no WhatsApp. */
export function whatsAppShareUrl(phone: string | null, text: string): string {
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** Dados do cliente enviados junto da cobrança quando ela é um link de pagamento. */
export const paymentLinkCustomerSchema = z.object({
  customerName: z.string().trim().min(2, 'Informe o nome do cliente').max(120),
  customerPhone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const n = normalizeBrWhatsApp(v);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido. Use DDD + número.' });
        return z.NEVER;
      }
      return n;
    }),
});
