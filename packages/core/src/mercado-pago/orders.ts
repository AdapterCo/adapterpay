import { centsToDecimalString, type MpOrder } from '@adapterpay/shared';
import type { MercadoPagoHttp } from './http';

/**
 * Orders QR — contrato comprovado pelo usuário (seção 7).
 * POST /v1/orders (type "qr", modo "static", expiration_time "PT3M") e GET /v1/orders/{id}.
 */

export interface OrderPayload {
  type: 'qr';
  total_amount: string;
  external_reference: string;
  expiration_time: string;
  config: { qr: { external_pos_id: string; mode: 'static' } };
  transactions: { payments: Array<{ amount: string }> };
}

export function buildQrOrderPayload(params: {
  amountCents: number;
  externalReference: string;
  externalPosId: string;
  expirationIso: string;
}): OrderPayload {
  const amount = centsToDecimalString(params.amountCents);
  if (!params.externalPosId) throw new Error('external_pos_id obrigatório');
  return {
    type: 'qr',
    total_amount: amount,
    external_reference: params.externalReference,
    expiration_time: params.expirationIso,
    config: { qr: { external_pos_id: params.externalPosId, mode: 'static' } },
    transactions: { payments: [{ amount }] },
  };
}

export async function createOrder(
  http: MercadoPagoHttp,
  accessToken: string,
  payload: OrderPayload,
  idempotencyKey: string,
): Promise<MpOrder> {
  return http.request<MpOrder>({
    method: 'POST',
    path: '/v1/orders',
    accessToken,
    body: payload,
    idempotencyKey,
  });
}

export async function getOrder(http: MercadoPagoHttp, accessToken: string, orderId: string): Promise<MpOrder> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderId)) throw new Error('order_id inválido');
  return http.request<MpOrder>({ method: 'GET', path: `/v1/orders/${orderId}`, accessToken });
}

/**
 * PENDÊNCIA (seção 20, item 5): endpoint de cancelamento de Order QR a validar em teste de contrato.
 * O chamador SEMPRE confirma o cancelamento com GET /v1/orders/{id} antes de liberar o POS.
 */
export async function cancelOrder(
  http: MercadoPagoHttp,
  accessToken: string,
  orderId: string,
  idempotencyKey: string,
): Promise<MpOrder> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderId)) throw new Error('order_id inválido');
  return http.request<MpOrder>({
    method: 'POST',
    path: `/v1/orders/${orderId}/cancel`,
    accessToken,
    idempotencyKey,
  });
}
