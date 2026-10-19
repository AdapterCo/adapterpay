import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().url(),
    API_PUBLIC_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve ter ao menos 32 caracteres'),
    ENCRYPTION_KEY: z.string().min(1),
    ENCRYPTION_KEY_ID: z.string().regex(/^[a-z0-9]{1,16}$/).default('k1'),
    ENCRYPTION_PREVIOUS_KEYS: z.string().optional().default(''),
    MP_CLIENT_ID: z.string().min(1),
    MP_CLIENT_SECRET: z.string().min(1),
    MP_OAUTH_REDIRECT_URI: z.string().url(),
    MP_OAUTH_PKCE: bool,
    MP_PLATFORM_CREDENTIALS_REF: z.string().min(1),
    MP_API_BASE: z.string().url().default('https://api.mercadopago.com'),
    MP_AUTH_BASE: z.string().url().default('https://auth.mercadopago.com'),
    MP_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    MP_MAX_CONCURRENCY_PER_ACCOUNT: z.coerce.number().int().min(1).max(50).default(5),
    POLL_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(60).default(3),
    CHARGE_EXPIRATION_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
    BILLING_DISPLAY_TIMEZONE: z.string().default('America/Sao_Paulo'),
    BILLING_RENEWAL_LEAD_DAYS: z.coerce.number().int().min(1).max(20).default(5),
    TRUSTED_PROXIES: z.string().default('loopback,uniquelocal'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('AdapterPay <nao-responda@adapterco.com.br>'),
    SWAGGER_USER: z.string().optional(),
    SWAGGER_PASSWORD: z.string().optional(),
    METRICS_TOKEN: z.string().optional(),
    API_PORT: z.coerce.number().int().default(4000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(20),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const prodUrls: Array<[string, string]> = [
      ['APP_URL', env.APP_URL],
      ['API_PUBLIC_URL', env.API_PUBLIC_URL],
      ['MP_OAUTH_REDIRECT_URI', env.MP_OAUTH_REDIRECT_URI],
    ];
    for (const [key, value] of prodUrls) {
      const u = new URL(value);
      if (u.protocol !== 'https:') ctx.addIssue({ code: 'custom', path: [key], message: 'deve usar https em produção' });
      if (['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'não pode usar localhost em produção' });
      }
    }
    if (!env.MP_OAUTH_REDIRECT_URI.startsWith(env.APP_URL)) {
      ctx.addIssue({ code: 'custom', path: ['MP_OAUTH_REDIRECT_URI'], message: 'deve pertencer ao APP_URL' });
    }
    for (const key of ['SESSION_SECRET', 'ENCRYPTION_KEY', 'MP_CLIENT_ID', 'MP_CLIENT_SECRET'] as const) {
      if (env[key].includes('CHANGE_ME')) ctx.addIssue({ code: 'custom', path: [key], message: 'valor de exemplo' });
    }
  });

export type AppConfig = z.infer<typeof schema> & {
  /** Duração ISO 8601 enviada em expiration_time (ex.: 180s -> "PT3M"). */
  chargeExpirationIso: string;
};

export function secondsToIsoDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `PT${m > 0 ? `${m}M` : ''}${s > 0 || m === 0 ? `${s}S` : ''}`;
}

/** Converte durações simples do MP ("PT3M", "PT180S", "PT1M30S", "PT1H") em segundos. */
export function isoDurationToSeconds(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const cfg: AppConfig = {
    ...parsed.data,
    chargeExpirationIso: secondsToIsoDuration(parsed.data.CHARGE_EXPIRATION_SECONDS),
  };
  if (env === process.env) cached = cfg;
  return cfg;
}

/**
 * Resolve MP_PLATFORM_CREDENTIALS_REF sem nunca registrar o valor.
 * Formatos: "file:/run/secrets/x" (Docker secret) ou "env:NOME_DA_VARIAVEL".
 */
export function resolvePlatformAccessToken(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  if (ref.startsWith('file:')) {
    const value = readFileSync(ref.slice(5), 'utf8').trim();
    if (!value) throw new Error('Credencial da plataforma vazia');
    return value;
  }
  if (ref.startsWith('env:')) {
    const value = env[ref.slice(4)];
    if (!value) throw new Error('Credencial da plataforma ausente');
    return value.trim();
  }
  throw new Error('MP_PLATFORM_CREDENTIALS_REF deve usar file: ou env:');
}
