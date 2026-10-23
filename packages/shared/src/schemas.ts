import { z } from 'zod';
import { MAX_CHARGE_CENTS } from './money';
import { TENANT_ROLES } from './roles';
import { normalizeBrWhatsApp } from './savings';

/** Schemas de entrada compartilhados entre API (validação autoritativa) e frontend (validação de formulário). */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email inválido')
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres')
  .max(128, 'Senha muito longa')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letras e números');

const uuid = z.string().uuid();

export const registerSchema = z.object({
  planId: z.string().min(1).max(40),
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().min(2).max(120),
  taxId: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 11 || v.length === 14, 'Informe CPF (11) ou CNPJ (14 dígitos)'),
  adminName: z.string().trim().min(2).max(120),
  email,
  password: passwordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar os termos' }) }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  mfaCode: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Z0-9]{4}-[A-Z0-9]{4})$/i)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

export const mfaVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos') });
export const mfaChallengeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Z0-9]{4}-[A-Z0-9]{4})$/i, 'Código inválido'),
});

export const switchTenantSchema = z.object({ tenantId: uuid });

export const checkoutSchema = z.object({
  planId: z.string().min(1).max(40),
  method: z.enum(['PIX', 'CARD']),
});

export const changePlanSchema = z.object({ planId: z.string().min(1).max(40) });

export const addressSchema = z.object({
  streetName: z.string().trim().min(1).max(200),
  streetNumber: z.string().trim().min(1).max(20),
  cityName: z.string().trim().min(1).max(100),
  stateName: z.string().trim().min(1).max(100),
  zipCode: z.string().trim().max(20).optional(),
  reference: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const timezoneSchema = z
  .string()
  .min(3)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Fuso horário inválido');

export const createStoreSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: addressSchema.optional(),
  timezone: timezoneSchema.default('America/Sao_Paulo'),
  mpConnectionId: uuid.optional(),
  /** Se true, cria a loja correspondente no Mercado Pago (Fluxo A, passo 3). */
  createRemote: z.boolean().default(false),
  activate: z.boolean().default(true),
});

export const updateStoreSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: addressSchema.optional(),
  timezone: timezoneSchema.optional(),
  mpConnectionId: uuid.nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const importPreviewSchema = z.object({ mpConnectionId: uuid });

export const importStoresConfirmSchema = z.object({
  mpConnectionId: uuid,
  items: z
    .array(
      z.object({
        mpStoreId: z.string().min(1).max(40),
        /** Loja interna existente para associar; se ausente, cria nova loja interna. */
        storeId: uuid.optional(),
        activate: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
});

export const createPosSchema = z.object({
  storeId: uuid,
  name: z.string().trim().min(2).max(60),
  category: z.number().int().positive().optional(),
  activate: z.boolean().default(true),
});

export const updatePosSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  storeId: uuid.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  rotatePublicSlug: z.boolean().optional(),
});

export const importPosConfirmSchema = z.object({
  mpConnectionId: uuid,
  items: z
    .array(
      z.object({
        mpPosId: z.string().min(1).max(40),
        storeId: uuid,
        activate: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
});

export const createChargeSchema = z.object({
  posId: uuid,
  amountCents: z.number().int().positive('O valor deve ser positivo').max(MAX_CHARGE_CENTS),
  description: z.string().trim().max(140).optional(),
  /** Itens do catálogo. Quando enviados, o servidor recalcula o total com os preços atuais e confere com amountCents. */
  items: z
    .array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50)
    .refine((a) => new Set(a.map((i) => i.productId)).size === a.length, 'Produto repetido no carrinho')
    .optional(),
  /** Fidelidade: cliente identificado no caixa e, opcionalmente, um código de cashback como desconto. */
  loyalty: z
    .object({
      customerId: uuid,
      rewardCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Código inválido').optional(),
    })
    .optional(),
});

export const loyaltyCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v, ctx) => {
      const n = normalizeBrWhatsApp(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Informe um WhatsApp com DDD, ex.: (11) 98765-4321' });
      return n ?? '';
    }),
  /** Consentimento do cliente para receber os códigos pelo WhatsApp (LGPD). */
  whatsappOptIn: z.boolean().default(false),
});
export const loyaltyCustomerUpdateSchema = loyaltyCustomerSchema.pick({ name: true, whatsappOptIn: true }).partial();
/** Totem de autoatendimento. */
export const totemCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe um nome, ex.: Totem entrada').max(60),
  posId: uuid,
});
export const totemPairSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/, 'Código de pareamento inválido') });
export const totemOrderSchema = z.object({
  items: z
    .array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(99) }))
    .min(1, 'Carrinho vazio')
    .max(50)
    .refine((a) => new Set(a.map((i) => i.productId)).size === a.length, 'Produto repetido no carrinho'),
  /** Total que o cliente viu na tela; o servidor recalcula e confere. */
  amountCents: z.number().int().positive().max(MAX_CHARGE_CENTS),
  /** Fidelidade no totem: o cliente informa o próprio WhatsApp (nada é exibido sobre outros clientes). */
  loyalty: z
    .object({
      phone: z.string().trim().max(30),
      name: z.string().trim().min(2).max(80).optional(),
      whatsappOptIn: z.boolean().optional(),
      rewardCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Código inválido').optional(),
    })
    .optional(),
});
export const fulfillmentSchema = z.object({ status: z.enum(['PREPARING', 'READY', 'DELIVERED']) });

export const redeemRewardSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Código inválido') });

export const productInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(80),
  /** Código de barras (EAN) ou interno. Vazio = sem código. */
  code: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9._-]*$/, 'Use só letras, números, ponto, hífen ou sublinhado')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  priceCents: z.number().int().positive('O preço deve ser positivo').max(MAX_CHARGE_CENTS),
  category: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export const productUpdateSchema = productInputSchema.partial();
export type ProductInput = z.infer<typeof productInputSchema>;
export type CreateChargeInput = z.infer<typeof createChargeSchema>;

export const listChargesQuerySchema = z.object({
  storeId: uuid.optional(),
  posId: uuid.optional(),
  sellerId: uuid.optional(),
  status: z.string().max(20).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const reportQuerySchema = z.object({
  storeId: uuid.optional(),
  posId: uuid.optional(),
  sellerId: uuid.optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  format: z.enum(['csv', 'xlsx']).optional(),
});

/** Administrador cria o usuário com senha inicial (sem convite por email). */
export const createUserSchema = z.object({
  email,
  name: z.string().trim().min(2).max(120),
  role: z.enum(TENANT_ROLES),
  password: passwordSchema,
  storeIds: z.array(uuid).max(100).default([]),
});

export const updateUserSchema = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  storeIds: z.array(uuid).max(100).optional(),
  /** Nova senha definida pelo administrador. */
  password: passwordSchema.optional(),
});

export const tenantSettingsSchema = z.object({
  tradeName: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().min(2).max(200).optional(),
  timezone: timezoneSchema.optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  logoUrl: z.string().url().startsWith('https://').max(500).nullable().optional(),
  allowSellerCancel: z.boolean().optional(),
  requireAdminMfa: z.boolean().optional(),
  fiscalAddress: z.string().trim().max(300).nullable().optional(),
  /** Taxas de referência do "Quanto você economizou" (pontos-base: 49 = 0,49%). */
  savingsPosRateBps: z.number().int().min(0).max(2000).optional(),
  savingsLinkRateBps: z.number().int().min(0).max(2000).optional(),
  /** Fechamento de caixa diário por WhatsApp. */
  dailyReportEnabled: z.boolean().optional(),
  dailyReportPhone: z
    .string()
    .trim()
    .max(30)
    .transform((v, ctx) => {
      const n = normalizeBrWhatsApp(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Informe um WhatsApp com DDD, ex.: (11) 98765-4321' });
      return n ?? '';
    })
    .nullable()
    .optional(),
  dailyReportHour: z.number().int().min(0).max(23).optional(),
  /** Fidelidade da loja. */
  loyaltyMode: z.enum(['OFF', 'CASHBACK', 'GIFT']).optional(),
  loyaltyCashbackBps: z.number().int().min(1).max(5000).optional(),
  loyaltyGiftEvery: z.number().int().min(2).max(100).optional(),
  loyaltyGiftName: z.string().trim().max(60).nullable().optional(),
  loyaltyMinPurchaseCents: z.number().int().min(0).max(MAX_CHARGE_CENTS).optional(),
});

export const adminTenantActionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
