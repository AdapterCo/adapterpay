import { centsToDecimalString } from '@adapterpay/shared';
import type { MercadoPagoHttp } from './http';

/**
 * API de pagamentos (/v1/payments) e assinaturas (/preapproval).
 *
 * Usos:
 *  - Lojista: GET /v1/payments/{reference_id} para obter tarifa (fee_details) e líquido
 *    (transaction_details.net_received_amount) de uma venda já confirmada pela Order. Campos ausentes => null.
 *  - Plataforma (Adapter Co): Pix manual de faturas e cartão recorrente (preapproval).
 *
 * A VALIDAR (seção 20, item 2): estados e endpoints de renovação/falha da assinatura por cartão
 * consultáveis por polling, sem webhook. Ver docs/assinaturas.md.
 */

export interface MpPayment {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  payment_method_id?: string;
  fee_details?: Array<{ type?: string; amount?: number; fee_payer?: string }>;
  transaction_details?: { net_received_amount?: number; total_paid_amount?: number };
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  };
}

export async function getPayment(http: MercadoPagoHttp, accessToken: string, paymentId: string): Promise<MpPayment> {
  if (!/^\d{1,24}$/.test(paymentId)) throw new Error('payment_id inválido');
  return http.request<MpPayment>({ method: 'GET', path: `/v1/payments/${paymentId}`, accessToken });
}

export async function searchPaymentsByExternalReference(
  http: MercadoPagoHttp,
  accessToken: string,
  externalReference: string,
): Promise<{ results?: MpPayment[] }> {
  return http.request<{ results?: MpPayment[] }>({
    method: 'GET',
    path: '/v1/payments/search',
    accessToken,
    query: { external_reference: externalReference, sort: 'date_created', criteria: 'desc', limit: 20 },
  });
}

/** Cria cobrança Pix avulsa (fatura da assinatura) na conta da PLATAFORMA. Sem notification_url (sem webhook). */
export async function createPlatformPixPayment(
  http: MercadoPagoHttp,
  platformToken: string,
  params: {
    amountCents: number;
    description: string;
    externalReference: string;
    payerEmail: string;
    expiresAt: Date;
    idempotencyKey: string;
  },
): Promise<MpPayment> {
  return http.request<MpPayment>({
    method: 'POST',
    path: '/v1/payments',
    accessToken: platformToken,
    idempotencyKey: params.idempotencyKey,
    body: {
      // A API de pagamentos recebe number; serializamos a partir da string exata de 2 casas.
      transaction_amount: Number(centsToDecimalString(params.amountCents)),
      description: params.description,
      payment_method_id: 'pix',
      external_reference: params.externalReference,
      date_of_expiration: params.expiresAt.toISOString().replace('Z', '+00:00'),
      payer: { email: params.payerEmail },
    },
  });
}

/** Cancela Pix pendente antes de gerar outro para a mesma fatura (evita dois QR válidos). */
export async function cancelPayment(http: MercadoPagoHttp, accessToken: string, paymentId: string): Promise<MpPayment> {
  if (!/^\d{1,24}$/.test(paymentId)) throw new Error('payment_id inválido');
  return http.request<MpPayment>({
    method: 'PUT',
    path: `/v1/payments/${paymentId}`,
    accessToken,
    body: { status: 'cancelled' },
  });
}

export interface MpPreapproval {
  id: string;
  status?: string; // pending | authorized | paused | cancelled
  init_point?: string;
  external_reference?: string;
  payer_email?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string; frequency?: number; frequency_type?: string };
  summarized?: {
    charged_quantity?: number;
    pending_charge_quantity?: number;
    last_charged_date?: string;
    last_charged_amount?: number;
    semaphore?: string;
  };
}

/**
 * Assinatura por cartão via checkout oficial do MP (init_point): o AdapterPay nunca recebe PAN/CVV.
 */
export async function createPreapproval(
  http: MercadoPagoHttp,
  platformToken: string,
  params: { reason: string; externalReference: string; payerEmail: string; amountCents: number; backUrl: string },
): Promise<MpPreapproval> {
  return http.request<MpPreapproval>({
    method: 'POST',
    path: '/preapproval',
    accessToken: platformToken,
    body: {
      reason: params.reason,
      external_reference: params.externalReference,
      payer_email: params.payerEmail,
      back_url: params.backUrl,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number(centsToDecimalString(params.amountCents)),
        currency_id: 'BRL',
      },
    },
  });
}

export async function getPreapproval(http: MercadoPagoHttp, platformToken: string, id: string): Promise<MpPreapproval> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error('preapproval_id inválido');
  return http.request<MpPreapproval>({ method: 'GET', path: `/preapproval/${id}`, accessToken: platformToken });
}

export async function updatePreapproval(
  http: MercadoPagoHttp,
  platformToken: string,
  id: string,
  body: { status?: 'cancelled' | 'paused' | 'authorized'; auto_recurring?: { transaction_amount: number; currency_id: 'BRL' } },
): Promise<MpPreapproval> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error('preapproval_id inválido');
  return http.request<MpPreapproval>({ method: 'PUT', path: `/preapproval/${id}`, accessToken: platformToken, body });
}

export interface MpAuthorizedPayment {
  id: number | string;
  preapproval_id?: string;
  status?: string; // scheduled | processed | recycling | cancelled
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
  debit_date?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string };
}

export async function searchAuthorizedPayments(
  http: MercadoPagoHttp,
  platformToken: string,
  preapprovalId: string,
): Promise<{ results?: MpAuthorizedPayment[] }> {
  return http.request<{ results?: MpAuthorizedPayment[] }>({
    method: 'GET',
    path: '/authorized_payments/search',
    accessToken: platformToken,
    query: { preapproval_id: preapprovalId, limit: 50 },
  });
}
