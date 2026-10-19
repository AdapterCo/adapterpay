import { describe, expect, it, vi } from 'vitest';
import { addMonthsUtc } from './billing/periods';
import { isoDurationToSeconds, loadConfig, secondsToIsoDuration } from './config';
import { Encryptor, randomSlug } from './crypto';
import { MercadoPagoHttp, MpApiError, buildQrOrderPayload, backoffWithJitter } from './mercado-pago';
import { nextPollDelayMs } from './charges/poller';
import { decisionToStatus } from './charges/charge-sync';
import { redactPayload } from './redact';
import { generateTotpSecret, totpAt, verifyTotp } from './totp';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('Encryptor', () => {
  it('cifra e decifra; rotação lê chave antiga', () => {
    const old = new Encryptor('k1', KEY);
    const c1 = old.encrypt('APP_USR-segredo');
    expect(c1).not.toContain('segredo');
    expect(old.decrypt(c1)).toBe('APP_USR-segredo');
    const rotated = new Encryptor('k2', Buffer.alloc(32, 9).toString('base64'), `k1:${KEY}`);
    expect(rotated.decrypt(c1)).toBe('APP_USR-segredo');
    expect(rotated.needsRotation(c1)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('x'))).toBe(false);
  });
  it('detecta adulteração', () => {
    const e = new Encryptor('k1', KEY);
    const c = e.encrypt('abc');
    const parts = c.split('.');
    parts[3] = Buffer.from('zzz').toString('base64url');
    expect(() => e.decrypt(parts.join('.'))).toThrow();
  });
  it('rejeita chave de tamanho errado', () => {
    expect(() => new Encryptor('k1', Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('TOTP', () => {
  it('vetor RFC 6238 (SHA1, T=59)', () => {
    // segredo ASCII "12345678901234567890" em base32
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpAt(secret, 59_000, 30, 8)).toBe('94287082');
  });
  it('verifica com janela', () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpAt(s, now), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, 'abcdef', now)).toBe(false);
  });
});

describe('payload da Order QR', () => {
  it('segue exatamente o contrato comprovado', () => {
    expect(
      buildQrOrderPayload({ amountCents: 9900, externalReference: 'ADAPTERPAY_X', externalPosId: 'LOJA1CX1', expirationIso: 'PT3M' }),
    ).toEqual({
      type: 'qr',
      total_amount: '99.00',
      external_reference: 'ADAPTERPAY_X',
      expiration_time: 'PT3M',
      config: { qr: { external_pos_id: 'LOJA1CX1', mode: 'static' } },
      transactions: { payments: [{ amount: '99.00' }] },
    });
  });
  it('duração ISO', () => {
    expect(secondsToIsoDuration(180)).toBe('PT3M');
    expect(secondsToIsoDuration(90)).toBe('PT1M30S');
    expect(isoDurationToSeconds('PT3M')).toBe(180);
    expect(isoDurationToSeconds('PT180S')).toBe(180);
    expect(isoDurationToSeconds('P1D')).toBeNull();
  });
});

describe('MercadoPagoHttp', () => {
  it('envia token e chave de idempotência; erro 429 é retryable', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const h = init!.headers as Record<string, string>;
      expect(h.Authorization).toBe('Bearer TOKEN');
      expect(h['X-Idempotency-Key']).toBe('idem-1');
      return new Response(JSON.stringify({ message: 'too many' }), { status: 429, headers: { 'retry-after': '2' } });
    });
    const http = new MercadoPagoHttp({ baseUrl: 'https://api.mercadopago.com', timeoutMs: 1000, fetchImpl: fetchImpl as typeof fetch });
    const err = await http
      .request({ method: 'POST', path: '/v1/orders', accessToken: 'TOKEN', body: {}, idempotencyKey: 'idem-1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MpApiError);
    const e = err as MpApiError;
    expect(e.rateLimited).toBe(true);
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(2000);
    expect(e.definitiveClientError).toBe(false);
  });

  it('timeout => resultado incerto', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    const http = new MercadoPagoHttp({ baseUrl: 'https://api.mercadopago.com', timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    const e = (await http.request({ method: 'POST', path: '/v1/orders', body: {} }).catch((x: unknown) => x)) as MpApiError;
    expect(e.kind).toBe('timeout');
    expect(e.outcomeUnknown).toBe(true);
  });

  it('400 é erro definitivo; corpo é saneado', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'bad', access_token: 'x' }), { status: 400 }));
    const http = new MercadoPagoHttp({ baseUrl: 'https://api.mercadopago.com', timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    const e = (await http.request({ method: 'POST', path: '/v1/orders', body: {} }).catch((x: unknown) => x)) as MpApiError;
    expect(e.definitiveClientError).toBe(true);
    expect(JSON.stringify(e.body)).not.toContain('"x"');
  });
});

describe('polling', () => {
  it('cadência por fase', () => {
    const exp = new Date('2026-01-01T00:03:00Z');
    expect(nextPollDelayMs({ baseSeconds: 3, expiresAt: exp, now: new Date('2026-01-01T00:01:00Z'), status: 'PENDING' })).toBe(3000);
    expect(nextPollDelayMs({ baseSeconds: 3, expiresAt: exp, now: new Date('2026-01-01T00:05:00Z'), status: 'PENDING' })).toBe(10000);
    expect(nextPollDelayMs({ baseSeconds: 3, expiresAt: exp, now: new Date('2026-01-01T01:00:00Z'), status: 'RECONCILING' })).toBe(60000);
  });
  it('backoff com jitter limitado', () => {
    expect(backoffWithJitter(0, 3000, 60000, () => 0)).toBe(3000);
    expect(backoffWithJitter(10, 3000, 60000, () => 1)).toBe(60000);
  });
  it('decisão -> estado', () => {
    expect(decisionToStatus('PAID')).toBe('PAID');
    expect(decisionToStatus('PENDING')).toBe('PENDING');
    expect(decisionToStatus('RECONCILING')).toBe('RECONCILING');
  });
});

describe('utilitários', () => {
  it('redação remove segredos e PII', () => {
    const out = redactPayload({ access_token: 'a', nested: { refresh_token: 'b', email: 'c@d.e' }, amount: '1.00', payer: { email: 'x', type: 'guest' } });
    expect(out).toEqual({ access_token: '[REDACTED]', nested: { refresh_token: '[REDACTED]', email: '[PII]' }, amount: '1.00', payer: { type: 'guest' } });
  });
  it('slug público com alta entropia', () => {
    const s = randomSlug();
    expect(s).toMatch(/^[a-z2-9]{26}$/);
    expect(randomSlug()).not.toBe(s);
  });
  it('addMonthsUtc fixa fim de mês', () => {
    expect(addMonthsUtc(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(addMonthsUtc(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
  it('config rejeita localhost em produção', () => {
    const base = {
      NODE_ENV: 'production',
      APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:3000/api/v1',
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      SESSION_SECRET: 'a'.repeat(40),
      ENCRYPTION_KEY: KEY,
      MP_CLIENT_ID: '1',
      MP_CLIENT_SECRET: '2',
      MP_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/integrations/mercado-pago/callback',
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(base)).toThrow(/localhost|https/);
    const ok = loadConfig({
      ...base,
      APP_URL: 'https://adapterpay.adapterco.com.br',
      API_PUBLIC_URL: 'https://adapterpay.adapterco.com.br/api/v1',
      MP_OAUTH_REDIRECT_URI: 'https://adapterpay.adapterco.com.br/api/v1/integrations/mercado-pago/callback',
    });
    expect(ok.chargeExpirationIso).toBe('PT3M');
  });
});
