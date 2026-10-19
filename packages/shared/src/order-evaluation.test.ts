import { describe, expect, it } from 'vitest';
import { evaluateOrder, type ChargeExpectation, type MpOrder } from './order-evaluation';

const expected: ChargeExpectation = {
  orderId: 'ORD01M57WJ30PXEDV609ZQQNSM482',
  externalReference: 'NFC_VENDA_000123',
  amountCents: 100,
  externalPosId: 'ADAPTERPAY',
  mpUserId: '123456',
  requiredPaymentMethodId: 'pix',
};

/** Resposta de pagamento confirmado observada pelo usuário (seção 7), acrescida de currency/user_id/config. */
function paidOrder(overrides: Partial<MpOrder> = {}): MpOrder {
  return {
    id: 'ORD01M57WJ30PXEDV609ZQQNSM482',
    external_reference: 'NFC_VENDA_000123',
    total_amount: '1.00',
    total_paid_amount: '1.00',
    currency: 'BRL',
    user_id: '123456',
    status: 'processed',
    status_detail: 'accredited',
    config: { qr: { external_pos_id: 'ADAPTERPAY', mode: 'static' } },
    transactions: {
      payments: [
        {
          id: 'PAY01M57WJ30Y1PG3ZEW57Y3RJHS6',
          amount: '1.00',
          paid_amount: '1.00',
          reference_id: '183827516181',
          status: 'processed',
          status_detail: 'accredited',
          payment_method: { id: 'pix', type: 'bank_transfer' },
        },
      ],
    },
    ...overrides,
  };
}

describe('evaluateOrder — aprovação estrita', () => {
  it('processed/accredited com todos os vínculos -> PAID', () => {
    const r = evaluateOrder(expected, paidOrder());
    expect(r.decision).toBe('PAID');
    expect(r.payment).toMatchObject({
      mpPaymentId: 'PAY01M57WJ30Y1PG3ZEW57Y3RJHS6',
      mpReferenceId: '183827516181',
      amountCents: 100,
      paidAmountCents: 100,
      method: 'pix',
    });
  });

  it('created -> PENDING', () => {
    const r = evaluateOrder(
      expected,
      paidOrder({
        status: 'created',
        status_detail: 'created',
        total_paid_amount: '0.00',
        transactions: { payments: [{ id: 'PAY1', amount: '1.00', status: 'created', status_detail: 'created' }] },
      }),
    );
    expect(r.decision).toBe('PENDING');
  });

  it('expired/expired -> EXPIRED', () => {
    const r = evaluateOrder(
      expected,
      paidOrder({
        status: 'expired',
        status_detail: 'expired',
        transactions: { payments: [{ id: 'PAY1', amount: '1.00', status: 'expired', status_detail: 'expired' }] },
      }),
    );
    expect(r.decision).toBe('EXPIRED');
  });

  it('expired com transação processada -> RECONCILING (nunca EXPIRED)', () => {
    const r = evaluateOrder(
      expected,
      paidOrder({
        status: 'expired',
        status_detail: 'expired',
      }),
    );
    expect(r.decision).toBe('RECONCILING');
  });

  it('valor total divergente -> RECONCILING', () => {
    const r = evaluateOrder(expected, paidOrder({ total_amount: '2.00' }));
    expect(r.decision).toBe('RECONCILING');
    expect(r.reasons).toContain('TOTAL_AMOUNT_MISMATCH');
  });

  it('valor pago divergente -> RECONCILING', () => {
    const r = evaluateOrder(expected, paidOrder({ total_paid_amount: '0.99' }));
    expect(r.decision).toBe('RECONCILING');
    expect(r.reasons).toContain('TOTAL_PAID_AMOUNT_MISMATCH');
  });

  it('paid_amount da transação divergente -> RECONCILING', () => {
    const o = paidOrder();
    o.transactions!.payments![0]!.paid_amount = '0.50';
    expect(evaluateOrder(expected, o).decision).toBe('RECONCILING');
  });

  it('Order de outro id -> RECONCILING', () => {
    const r = evaluateOrder(expected, paidOrder({ id: 'ORDOUTRA' }));
    expect(r.decision).toBe('RECONCILING');
    expect(r.reasons).toContain('ORDER_ID_MISMATCH');
  });

  it('external_reference divergente -> RECONCILING', () => {
    expect(evaluateOrder(expected, paidOrder({ external_reference: 'OUTRA' })).decision).toBe('RECONCILING');
  });

  it('POS divergente -> RECONCILING', () => {
    const r = evaluateOrder(expected, paidOrder({ config: { qr: { external_pos_id: 'OUTRO_POS' } } }));
    expect(r.decision).toBe('RECONCILING');
    expect(r.reasons).toContain('EXTERNAL_POS_ID_MISMATCH');
  });

  it('conta recebedora divergente -> RECONCILING', () => {
    expect(evaluateOrder(expected, paidOrder({ user_id: 999 })).decision).toBe('RECONCILING');
  });

  it('moeda ausente ou diferente -> RECONCILING', () => {
    expect(evaluateOrder(expected, paidOrder({ currency: undefined })).reasons).toContain('CURRENCY_MISSING');
    expect(evaluateOrder(expected, paidOrder({ currency: 'USD' })).decision).toBe('RECONCILING');
  });

  it('método diferente de pix -> RECONCILING', () => {
    const o = paidOrder();
    o.transactions!.payments![0]!.payment_method = { id: 'account_money' };
    expect(evaluateOrder(expected, o).decision).toBe('RECONCILING');
  });

  it('transação não acreditada -> RECONCILING', () => {
    const o = paidOrder();
    o.transactions!.payments![0]!.status_detail = 'pending_review';
    expect(evaluateOrder(expected, o).decision).toBe('RECONCILING');
  });

  it('processed sem accredited na Order -> RECONCILING', () => {
    expect(evaluateOrder(expected, paidOrder({ status_detail: 'in_review' })).decision).toBe('RECONCILING');
  });

  it('resposta vazia/incompleta/status desconhecido -> nunca PAID', () => {
    expect(evaluateOrder(expected, null).decision).toBe('RECONCILING');
    expect(evaluateOrder(expected, {} as MpOrder).decision).toBe('RECONCILING');
    expect(evaluateOrder(expected, paidOrder({ status: 'weird', status_detail: 'x' })).decision).toBe('RECONCILING');
    expect(evaluateOrder(expected, paidOrder({ transactions: undefined })).decision).toBe('RECONCILING');
  });

  it('cancelled -> CANCELLED', () => {
    const r = evaluateOrder(
      expected,
      paidOrder({ status: 'canceled', status_detail: 'canceled', transactions: { payments: [] } }),
    );
    expect(r.decision).toBe('CANCELLED');
  });
});
