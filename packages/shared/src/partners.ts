import { z } from 'zod';
import { normalizeBrWhatsApp } from './savings';

/**
 * Parceiros de indicação: pessoas que divulgam o AdapterPay sem ter conta. Cada cadastro feito com o
 * código do parceiro aparece no painel dele; quando o indicado paga a primeira mensalidade, o parceiro
 * passa a ter REFERRAL_BONUS_CENTS a receber por Pix (pago pela Adapter Co.).
 */
export const PIX_KEY_TYPES = ['CPF_CNPJ', 'PHONE', 'EMAIL', 'RANDOM'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];
export const PIX_KEY_LABELS: Record<PixKeyType, string> = {
  CPF_CNPJ: 'CPF ou CNPJ',
  PHONE: 'Celular',
  EMAIL: 'E-mail',
  RANDOM: 'Chave aleatória',
};

/** Chave Pix no formato canônico do DICT, ou null se inválida. */
export function normalizePixKey(type: PixKeyType, value: string): string | null {
  const v = value.trim();
  switch (type) {
    case 'CPF_CNPJ': {
      const d = v.replace(/\D/g, '');
      return d.length === 11 || d.length === 14 ? d : null;
    }
    case 'PHONE': {
      const n = normalizeBrWhatsApp(v);
      return n ? `+${n}` : null;
    }
    case 'EMAIL':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 77 ? v.toLowerCase() : null;
    case 'RANDOM':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
  }
}

/** Mostra só o começo e o fim da chave (o parceiro confere sem expor a chave inteira na tela). */
export function maskPixKey(key: string): string {
  if (key.length <= 6) return '***';
  return `${key.slice(0, 3)}${'•'.repeat(Math.min(8, key.length - 5))}${key.slice(-2)}`;
}

/** Nome da empresa indicada como o parceiro vê: primeira palavra e iniciais (ex.: "Café E."). */
export function maskBusinessName(name: string): string {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  return [first, ...rest.map((w) => `${w[0]!.toUpperCase()}.`)].join(' ');
}

export const partnerSignupSchema = z
  .object({
    name: z.string().trim().min(3, 'Informe seu nome completo').max(120),
    phone: z
      .string()
      .trim()
      .max(30)
      .transform((v, ctx) => {
        const n = normalizeBrWhatsApp(v);
        if (!n) ctx.addIssue({ code: 'custom', message: 'Informe o WhatsApp com DDD, ex.: (11) 98765-4321' });
        return n ?? '';
      }),
    pixKeyType: z.enum(PIX_KEY_TYPES),
    pixKey: z.string().trim().min(1, 'Informe a chave Pix').max(120),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar as condições' }) }),
  })
  .transform((v, ctx) => {
    const key = normalizePixKey(v.pixKeyType, v.pixKey);
    if (!key) ctx.addIssue({ code: 'custom', path: ['pixKey'], message: `Chave Pix inválida para o tipo ${PIX_KEY_LABELS[v.pixKeyType]}` });
    return { ...v, pixKey: key ?? '' };
  });
export type PartnerSignupInput = z.infer<typeof partnerSignupSchema>;
