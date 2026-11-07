import { describe, expect, it } from 'vitest';
import type { PaymentLink } from '@adapterpay/database';
import type { CoreDeps } from './context';
import { MercadoPagoHttp } from './mercado-pago';
import { cancelPaymentLink, isApprovedPaymentForLink, nextPaymentLinkPollMs, PaymentLinkError, pollPaymentLink } from './payment-links/payment-links';

type Row = Record<string, unknown>;

/** Pix simulado no nível HTTP (/v1/payments) e banco em memória só com o que os links usam. */
function setup(link: Partial<PaymentLink> = {}) {
  const remote = { id: 9001, status: 'pending', currency_id: 'BRL', external_reference: 'ADAPTERPAY_LINK_X', transaction_amount: 50, date_approved: null as string | null };
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (method === 'PUT') {
      if (remote.status !== 'pending') return new Response(JSON.stringify({ message: 'not pending' }), { status: 400 });
      remote.status = 'cancelled';
    }
    return new Response(JSON.stringify({ ...remote, fee_details: [{ amount: 0.5, fee_payer: 'collector' }], transaction_details: { net_received_amount: 49.5 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const row: Row = {
    id: 'link-1',
    tenantId: 't1',
    storeId: 's1',
    mpConnectionId: 'c1',
    customerName: 'Ana Lima',
    description: 'Pedido 12',
    amountCents: 5000,
    status: 'PENDING',
    externalReference: 'ADAPTERPAY_LINK_X',
    mpPaymentId: '9001',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    lastPolledAt: null,
    ...link,
  };
  const notifications: Row[] = [];
  const matches = (where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const prisma = {
    paymentLink: {
      findUniqueOrThrow: async () => ({ ...row }),
      update: async ({ data }: { data: Row }) => Object.assign(row, data) && { ...row },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
    notification: { create: async ({ data }: { data: Row }) => (notifications.push(data), { id: 'n1', ...data }) },
  };
  const deps = {
    prisma,
    config: { APP_URL: 'https://pay.example.com' },
    mpApi: new MercadoPagoHttp({ baseUrl: 'https://api.mp.test', timeoutMs: 1000, fetchImpl }),
    tokens: { getAccessToken: async () => ({ accessToken: 'APP_USR-x', mpUserId: '1' }) },
    guard: { run: <T>(_k: string, fn: () => Promise<T>) => fn() },
    events: { publish: async () => undefined },
    logger: { warn: () => undefined },
  } as unknown as CoreDeps;
  return { deps, row, remote, notifications, calls };
}

describe('links de pagamento (core)', () => {
  it('confirma o pagamento aprovado, grava tarifa e líquido e avisa a loja uma vez', async () => {
    const { deps, row, remote, notifications } = setup();
    remote.status = 'approved';
    remote.date_approved = '2026-11-07T15:00:00.000-03:00';
    await pollPaymentLink(deps, 'link-1');
    expect(row.status).toBe('PAID');
    expect(row.feeCents).toBe(50);
    expect(row.netAmountCents).toBe(4950);
    expect((row.paidAt as Date).toISOString()).toBe('2026-11-07T18:00:00.000Z');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Link pago: Ana Lima');
    await pollPaymentLink(deps, 'link-1');
    expect(notifications).toHaveLength(1);
  });

  it('não marca como pago se o valor aprovado não bate com o link', async () => {
    const { deps, row, remote } = setup();
    remote.status = 'approved';
    remote.transaction_amount = 5;
    await pollPaymentLink(deps, 'link-1');
    expect(row.status).toBe('PENDING');
    expect(row.lastError).toContain('AMOUNT');
  });

  it('expira só depois do prazo + tolerância, e consultando o Pix antes', async () => {
    const atDeadline = setup({ expiresAt: new Date(Date.now() - 30_000) });
    await pollPaymentLink(atDeadline.deps, 'link-1');
    expect(atDeadline.row.status).toBe('PENDING');

    const late = setup({ expiresAt: new Date(Date.now() - 5 * 60_000) });
    await pollPaymentLink(late.deps, 'link-1');
    expect(late.row.status).toBe('EXPIRED');
    expect(late.calls).toEqual(['GET /v1/payments/9001']);
  });

  it('pagamento de última hora vence a expiração', async () => {
    const { deps, row, remote } = setup({ expiresAt: new Date(Date.now() - 5 * 60_000) });
    remote.status = 'approved';
    await pollPaymentLink(deps, 'link-1');
    expect(row.status).toBe('PAID');
  });

  it('cancela no Mercado Pago e no banco', async () => {
    const { deps, row, remote, calls } = setup();
    await cancelPaymentLink(deps, 'link-1');
    expect(remote.status).toBe('cancelled');
    expect(row.status).toBe('CANCELLED');
    expect(calls).toEqual(['PUT /v1/payments/9001', 'GET /v1/payments/9001']);
  });

  it('se o cliente pagou antes do cancelamento, o link fica pago e o cancelamento é recusado', async () => {
    const { deps, row, remote, notifications } = setup();
    remote.status = 'approved';
    await expect(cancelPaymentLink(deps, 'link-1')).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    expect(row.status).toBe('PAID');
    expect(notifications).toHaveLength(1);
  });

  it('não cancela link que não está em aberto', async () => {
    const { deps } = setup({ status: 'PAID' });
    await expect(cancelPaymentLink(deps, 'link-1')).rejects.toBeInstanceOf(PaymentLinkError);
  });

  it('valida referência e ID do pagamento', () => {
    const link = { externalReference: 'REF', amountCents: 1000, mpPaymentId: '1' };
    expect(isApprovedPaymentForLink({ id: 1, status: 'approved', external_reference: 'REF', transaction_amount: 10 }, link).ok).toBe(true);
    expect(isApprovedPaymentForLink({ id: 2, status: 'approved', external_reference: 'REF', transaction_amount: 10 }, link).reasons).toEqual(['PAYMENT_ID']);
    expect(isApprovedPaymentForLink({ id: 1, status: 'approved', external_reference: 'OUTRA', transaction_amount: 10 }, link).reasons).toEqual(['EXTERNAL_REFERENCE']);
  });

  it('consulta rápido no começo e espaça depois', () => {
    const now = Date.now();
    expect(nextPaymentLinkPollMs(new Date(now - 60_000), now)).toBe(15_000);
    expect(nextPaymentLinkPollMs(new Date(now - 30 * 60_000), now)).toBe(60_000);
    expect(nextPaymentLinkPollMs(new Date(now - 5 * 3600_000), now)).toBe(300_000);
  });
});
