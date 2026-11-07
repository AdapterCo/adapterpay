import { z } from 'zod';
import { MAX_CHARGE_CENTS } from './money';
import { normalizeBrWhatsApp } from './savings';

/**
 * Link de pagamento externo: Pix avulso na conta Mercado Pago da loja, enviado ao cliente
 * (WhatsApp, e-mail…) e válido por 24 horas. Não usa POS, então não ocupa o caixa.
 */
export const PAYMENT_LINK_TTL_HOURS = 24;
export const PAYMENT_LINK_TTL_MS = PAYMENT_LINK_TTL_HOURS * 3600 * 1000;

export const PAYMENT_LINK_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export const PAYMENT_LINK_STATUS_LABEL: Record<PaymentLinkStatus, string> = {
  PENDING: 'Em aberto',
  PAID: 'Pago',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

/** Forma usada na busca por nome: sem acentos, minúscula e com espaços simples ("João  Silva" -> "joao silva"). */
export function normalizeSearchName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primeiro nome para a página pública ("Olá, João"): não expõe o nome completo do cliente. */
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

export const createPaymentLinkSchema = z.object({
  storeId: z.string().uuid(),
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
  description: z.string().trim().max(140).optional(),
  amountCents: z.number().int().min(100, 'O valor mínimo é R$ 1,00').max(MAX_CHARGE_CENTS),
});
export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

export const listPaymentLinksQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(PAYMENT_LINK_STATUSES).optional(),
  storeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Resposta pública de /public/payment-links/:token. Sem IDs internos e sem o nome completo do cliente. */
export interface PublicPaymentLinkView {
  storeName: string;
  tradeName: string;
  logoUrl: string | null;
  customerFirstName: string;
  description: string | null;
  amountCents: number;
  state: PaymentLinkStatus;
  expiresAt: string;
  serverTime: string;
  /** Pix copia e cola, somente enquanto o link está em aberto. */
  pixCopyPaste: string | null;
  paidAt: string | null;
}
