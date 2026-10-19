import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { MpApiError, PlanLimitError, SubscriptionInactiveError, createLogger } from '@adapterpay/core';
import { ReportsService } from '../reports/reports.service';
import { AppError } from './errors';
import { AppExceptionFilter } from './exception.filter';

function run(err: unknown) {
  const filter = new AppExceptionFilter(createLogger('test', 'silent'));
  const out: { status?: number; body?: { error: { code: string; message: string; details?: unknown } }; headers: Record<string, string> } = { headers: {} };
  const res = {
    headersSent: false,
    setHeader: (k: string, v: string) => (out.headers[k] = v),
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: never) {
      out.body = b;
    },
  };
  filter.catch(err, {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ correlationId: 'cid', path: '/x' }) }),
  } as never);
  return out;
}

describe('AppExceptionFilter', () => {
  it('POS_BUSY => 409 com detalhes', () => {
    const r = run(new AppError(409, 'POS_BUSY', 'ocupado', { remainingSeconds: 42 }));
    expect(r.status).toBe(409);
    expect(r.body?.error.code).toBe('POS_BUSY');
    expect(r.body?.error.details).toEqual({ remainingSeconds: 42 });
  });
  it('validação zod => 422', () => {
    const e = z.object({ a: z.number() }).safeParse({ a: 'x' }).error as ZodError;
    expect(run(e).status).toBe(422);
  });
  it('limite de plano => 422 PLAN_LIMIT_REACHED', () => {
    const r = run(new PlanLimitError('pos', 1, 1));
    expect(r.status).toBe(422);
    expect(r.body?.error.code).toBe('PLAN_LIMIT_REACHED');
  });
  it('assinatura inativa => 403', () => {
    expect(run(new SubscriptionInactiveError('SUSPENDED')).status).toBe(403);
  });
  it('429 do MP => 503 com Retry-After', () => {
    const r = run(new MpApiError('x', 'http', 429, null, 7000));
    expect(r.status).toBe(503);
    expect(r.headers['Retry-After']).toBe('7');
  });
  it('erro desconhecido => 500 sem vazar detalhes', () => {
    const r = run(new Error('segredo interno'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('segredo');
  });
});

describe('exportação CSV', () => {
  it('neutraliza injeção de fórmula e escapa aspas', () => {
    const svc = new ReportsService({} as never);
    const csv = svc.toCsv([{ a: '=HYPERLINK("x")', b: 'ok, "com" aspas' }]).toString('utf8');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"ok, ""com"" aspas"');
  });
});
