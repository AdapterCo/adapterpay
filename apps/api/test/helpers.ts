import { randomUUID } from 'node:crypto';
import {
  AccountGuard,
  createCoreDeps,
  createLogger,
  Encryptor,
  EventPublisher,
  loadConfig,
  MercadoPagoHttp,
  MpTokenService,
  randomSlug,
  sha256Hex,
  type CoreDeps,
} from '@adapterpay/core';
import { PrismaClient } from '@adapterpay/database';
import { crc16ccitt, PLAN_DEFINITIONS } from '@adapterpay/shared';
import type { Redis } from 'ioredis';
import type { AuthContext } from '../src/common/request';

export const MP_USER_ID = '777';
const KEY = Buffer.alloc(32, 3).toString('base64');

// ---------------------------------------------------------------- Redis em memória (subconjunto usado pelo core)
export class FakeRedis {
  private store = new Map<string, { v: string; exp: number | null }>();
  private alive(k: string) {
    const e = this.store.get(k);
    if (e && e.exp !== null && e.exp < Date.now()) {
      this.store.delete(k);
      return undefined;
    }
    return e;
  }
  async get(k: string) {
    return this.alive(k)?.v ?? null;
  }
  async set(k: string, v: string, ...args: Array<string | number>) {
    let exp: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === 'PX') exp = Date.now() + Number(args[++i]);
      else if (a === 'EX') exp = Date.now() + Number(args[++i]) * 1000;
      else if (a === 'NX') nx = true;
    }
    if (nx && this.alive(k)) return null;
    this.store.set(k, { v, exp });
    return 'OK';
  }
  async incr(k: string) {
    const n = Number(this.alive(k)?.v ?? 0) + 1;
    this.store.set(k, { v: String(n), exp: this.alive(k)?.exp ?? null });
    return n;
  }
  async decr(k: string) {
    const n = Number(this.alive(k)?.v ?? 0) - 1;
    this.store.set(k, { v: String(n), exp: this.alive(k)?.exp ?? null });
    return n;
  }
  async expire(k: string, s: number) {
    const e = this.alive(k);
    if (e) e.exp = Date.now() + s * 1000;
    return e ? 1 : 0;
  }
  async pexpire(k: string, ms: number) {
    const e = this.alive(k);
    if (e) e.exp = Date.now() + ms;
    return e ? 1 : 0;
  }
  async ttl(k: string) {
    const e = this.alive(k);
    return e?.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1;
  }
  async exists(k: string) {
    return this.alive(k) ? 1 : 0;
  }
  async del(...keys: string[]) {
    let n = 0;
    keys.forEach((k) => (this.store.delete(k) ? n++ : 0));
    return n;
  }
  async publish() {
    return 0;
  }
  /** Somente o script de liberação de lock (compare-and-delete). */
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.alive(key)?.v === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
  disconnect() {}
}

// ---------------------------------------------------------------- Mercado Pago simulado (contrato da seção 7)
interface FakeOrder {
  body: { total_amount: string; external_reference: string; config: { qr: { external_pos_id: string } } };
  status: string;
  detail: string;
  created: string;
}

export class FakeMercadoPago {
  orders = new Map<string, FakeOrder>();
  byKey = new Map<string, string>();
  createCalls = 0;
  getCalls = 0;
  /** Cria a Order mas simula queda de rede na resposta (resultado incerto). */
  failNextCreateAfterCommit = false;
  failGets = 0;
  paidAmountOverride: string | null = null;
  exposeFees = true;
  private seq = 0;

  fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const timeout = () => {
      const e = new Error('timeout');
      e.name = 'TimeoutError';
      return e;
    };

    if (method === 'POST' && url.pathname === '/v1/orders') {
      this.createCalls++;
      const key = headers['X-Idempotency-Key'];
      if (!key) return json(400, { error: 'missing idempotency key' });
      let id = this.byKey.get(key);
      if (!id) {
        id = `ORD${String(++this.seq).padStart(6, '0')}`;
        this.byKey.set(key, id);
        this.orders.set(id, { body: JSON.parse(String(init!.body)), status: 'created', detail: 'created', created: new Date().toISOString() });
      }
      if (this.failNextCreateAfterCommit) {
        this.failNextCreateAfterCommit = false;
        throw timeout();
      }
      return json(201, this.view(id));
    }
    const m = /^\/v1\/orders\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && m) {
      this.getCalls++;
      if (this.failGets > 0) {
        this.failGets--;
        throw timeout();
      }
      return this.orders.has(m[1]!) ? json(200, this.view(m[1]!)) : json(404, { error: 'not_found' });
    }
    const p = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (method === 'GET' && p) {
      return json(200, {
        id: Number(p[1]),
        status: 'approved',
        ...(this.exposeFees ? { fee_details: [{ type: 'mercadopago_fee', amount: 0, fee_payer: 'collector' }], transaction_details: { net_received_amount: 1 } } : {}),
      });
    }
    return json(404, { error: 'not_found' });
  };

  view(id: string) {
    const o = this.orders.get(id)!;
    const amount = o.body.total_amount;
    const processed = o.status === 'processed';
    const paid = processed ? (this.paidAmountOverride ?? amount) : '0.00';
    return {
      id,
      type: 'qr',
      external_reference: o.body.external_reference,
      total_amount: amount,
      total_paid_amount: paid,
      currency: 'BRL',
      user_id: MP_USER_ID,
      status: o.status,
      status_detail: o.detail,
      expiration_time: 'PT3M',
      created_date: o.created,
      config: { qr: { external_pos_id: o.body.config.qr.external_pos_id, mode: 'static' } },
      transactions: {
        payments: [
          {
            id: `PAY${id}`,
            amount,
            ...(processed ? { paid_amount: paid, reference_id: '183827516181', payment_method: { id: 'pix', type: 'bank_transfer' } } : {}),
            status: o.status,
            status_detail: o.detail,
          },
        ],
      },
    };
  }

  setState(orderId: string, status: string, detail = status) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`order ${orderId} inexistente`);
    o.status = status;
    o.detail = detail;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// ---------------------------------------------------------------- deps
export function makeDeps(fake: FakeMercadoPago): CoreDeps {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:3000/api/v1',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    REDIS_URL: 'redis://unused',
    SESSION_SECRET: 's'.repeat(40),
    ENCRYPTION_KEY: KEY,
    MP_CLIENT_ID: 'cid',
    MP_CLIENT_SECRET: 'csecret',
    MP_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/integrations/mercado-pago/callback',
    MP_PLATFORM_CREDENTIALS_REF: 'env:NONE',
    MP_API_BASE: 'https://api.mercadopago.test',
  } as NodeJS.ProcessEnv);
  const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const redis = new FakeRedis() as unknown as Redis;
  const encryptor = new Encryptor('k1', KEY);
  const mpApi = new MercadoPagoHttp({ baseUrl: config.MP_API_BASE, timeoutMs: 2000, fetchImpl: fake.fetch as typeof fetch });
  const logger = createLogger('test', 'silent');
  const events = new EventPublisher(redis);
  const guard = new AccountGuard(redis, 50);
  const tokens = new MpTokenService({ prisma, redis, encryptor, mpApi, config, logger, events });
  return createCoreDeps('test', { config, prisma, redis, encryptor, mpApi, logger, events, guard, tokens });
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // pos_terminals.active_charge_id é DEFERRABLE; TRUNCATE CASCADE resolve dependências.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  for (const p of PLAN_DEFINITIONS) await prisma.plan.create({ data: { ...p, active: true } });
}

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

export function syntheticBrCode(seed: string): string {
  const base =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', seed.padEnd(36, '0').slice(0, 36))) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('58', 'BR') +
    tlv('59', 'LOJA TESTE') +
    tlv('60', 'SAO PAULO') +
    tlv('62', tlv('05', '***')) +
    '6304';
  return base + crc16ccitt(base);
}

export interface Seeded {
  tenantId: string;
  userId: string;
  storeId: string;
  posId: string;
  posIds: string[];
  connectionId: string;
  auth: AuthContext;
}

/** Tenant ativo com assinatura, conexão MP, loja e N POS prontos para Orders. */
export async function seedTenant(
  deps: CoreDeps,
  opts: { planId?: string; posCount?: number; subscriptionStatus?: 'ACTIVE' | 'PAST_DUE'; mpUserId?: string; posStatus?: 'ACTIVE' | 'PENDING_REVIEW' } = {},
): Promise<Seeded> {
  const p = deps.prisma;
  const suffix = randomUUID().slice(0, 8);
  const active = (opts.subscriptionStatus ?? 'ACTIVE') === 'ACTIVE';
  const tenant = await p.tenant.create({
    data: {
      legalName: `Empresa ${suffix} LTDA`,
      tradeName: `Loja ${suffix}`,
      taxIdEnc: deps.encryptor.encrypt('12345678000190'),
      taxIdHash: sha256Hex(suffix),
      status: active ? 'ACTIVE' : 'SUSPENDED',
    },
  });
  const user = await p.user.create({ data: { email: `admin-${suffix}@example.com`, name: 'Admin Teste', status: 'ACTIVE' } });
  await p.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'ADMIN', isOwner: true } });
  await p.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: opts.planId ?? 'profissional',
      status: opts.subscriptionStatus ?? 'ACTIVE',
      method: 'PIX',
      startedAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  const conn = await p.mpConnection.create({
    data: {
      tenantId: tenant.id,
      mpUserId: opts.mpUserId ?? MP_USER_ID,
      accessTokenEnc: deps.encryptor.encrypt('APP_USR-test-token'),
      refreshTokenEnc: deps.encryptor.encrypt('TG-refresh'),
      tokenExpiresAt: new Date(Date.now() + 90 * 86_400_000),
      status: 'ACTIVE',
    },
  });
  const store = await p.store.create({ data: { tenantId: tenant.id, name: 'Loja Centro', mpConnectionId: conn.id, mpStoreId: '123', status: 'ACTIVE' } });
  const posIds: string[] = [];
  for (let i = 0; i < (opts.posCount ?? 1); i++) {
    const code = syntheticBrCode(`${suffix}${i}`);
    const pos = await p.posTerminal.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        mpConnectionId: conn.id,
        mpPosId: String(1000 + i),
        externalId: `AP${suffix.toUpperCase()}${i}`,
        name: `Caixa ${i + 1}`,
        qrCode: code,
        qrCodeHash: sha256Hex(code),
        publicSlug: randomSlug(),
        status: opts.posStatus ?? 'ACTIVE',
      },
    });
    posIds.push(pos.id);
  }
  const auth: AuthContext = {
    sessionId: randomUUID(),
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperadmin: false,
    mfaEnabled: false,
    mfaVerified: false,
    tenantId: tenant.id,
    role: 'ADMIN',
    isOwner: true,
    storeIds: 'ALL',
    tenantStatus: tenant.status,
    subscriptionStatus: opts.subscriptionStatus ?? 'ACTIVE',
    requireAdminMfa: false,
  };
  return { tenantId: tenant.id, userId: user.id, storeId: store.id, posId: posIds[0]!, posIds, connectionId: conn.id, auth };
}

export const meta = { ip: '127.0.0.1', userAgent: 'vitest', correlationId: 'test' };
