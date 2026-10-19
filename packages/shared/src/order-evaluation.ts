import { tryDecimalStringToCents } from './money';

/**
 * Avaliação estrita de uma Order QR do Mercado Pago (seção 7 — "Regra inegociável de aprovação").
 *
 * Esta função é PURA: recebe o que a cobrança espera e a resposta saneada de GET /v1/orders/{id}
 * e devolve uma decisão. Ela nunca confirma pagamento por ausência de dados: qualquer campo
 * faltante, divergente ou desconhecido resulta em PENDING (continuar consultando) ou RECONCILING
 * (divergência/incerteza que exige atenção), nunca em PAID.
 */

export interface MpOrderPaymentMethod {
  id?: string;
  type?: string;
}

export interface MpOrderPayment {
  id?: string;
  amount?: string;
  paid_amount?: string;
  reference_id?: string;
  status?: string;
  status_detail?: string;
  payment_method?: MpOrderPaymentMethod;
}

export interface MpOrder {
  id?: string;
  type?: string;
  external_reference?: string;
  total_amount?: string;
  total_paid_amount?: string;
  currency?: string;
  status?: string;
  status_detail?: string;
  user_id?: string | number;
  created_date?: string;
  last_updated_date?: string;
  expiration_time?: string;
  config?: { qr?: { external_pos_id?: string; mode?: string } };
  transactions?: { payments?: MpOrderPayment[] };
}

export interface ChargeExpectation {
  orderId: string;
  externalReference: string;
  amountCents: number;
  /** external_id do POS interno vinculado à cobrança. */
  externalPosId: string;
  /** user_id da conta MP recebedora (conexão OAuth usada para criar/consultar a Order). */
  mpUserId: string;
  /** Para vendas Pix o método deve ser exatamente "pix". */
  requiredPaymentMethodId: 'pix';
}

export type OrderDecision = 'PAID' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED' | 'RECONCILING';

export interface ConfirmedPaymentData {
  mpPaymentId: string;
  mpReferenceId: string | null;
  amountCents: number;
  paidAmountCents: number;
  method: string;
  status: string;
  statusDetail: string;
}

export interface OrderEvaluation {
  decision: OrderDecision;
  /** Códigos legíveis que explicam a decisão (gravados em payment_events). */
  reasons: string[];
  payment?: ConfirmedPaymentData;
}

const PROCESSED = 'processed';
const ACCREDITED = 'accredited';

function isProcessedAccredited(x: { status?: string; status_detail?: string } | undefined): boolean {
  return !!x && x.status === PROCESSED && x.status_detail === ACCREDITED;
}

export function evaluateOrder(expected: ChargeExpectation, order: MpOrder | null | undefined): OrderEvaluation {
  if (!order || typeof order !== 'object') {
    return { decision: 'RECONCILING', reasons: ['EMPTY_RESPONSE'] };
  }

  const identity: string[] = [];
  // 1. Order pertence ao order_id da cobrança e à conta recebedora correta.
  if (order.id !== expected.orderId) identity.push('ORDER_ID_MISMATCH');
  if (order.user_id !== undefined && order.user_id !== null && String(order.user_id) !== expected.mpUserId) {
    identity.push('RECEIVER_ACCOUNT_MISMATCH');
  }
  // 2. external_reference exatamente igual.
  if (order.external_reference !== expected.externalReference) identity.push('EXTERNAL_REFERENCE_MISMATCH');
  // 6. Vínculo com o POS interno.
  if (order.config?.qr?.external_pos_id !== expected.externalPosId) identity.push('EXTERNAL_POS_ID_MISMATCH');

  if (identity.length > 0) {
    // Resposta que não é desta cobrança nunca altera estado financeiro.
    return { decision: 'RECONCILING', reasons: identity };
  }

  const payments = Array.isArray(order.transactions?.payments) ? order.transactions!.payments! : [];
  const anyProcessedPayment = payments.some((p) => p.status === PROCESSED);
  const status = order.status;
  const detail = order.status_detail;

  if (status === PROCESSED && detail === ACCREDITED) {
    return evaluateProcessed(expected, order, payments);
  }

  if (status === 'expired' && detail === 'expired') {
    if (anyProcessedPayment) return { decision: 'RECONCILING', reasons: ['EXPIRED_WITH_PROCESSED_PAYMENT'] };
    return { decision: 'EXPIRED', reasons: ['REMOTE_EXPIRED'] };
  }

  if (status === 'canceled' || status === 'cancelled') {
    if (anyProcessedPayment) return { decision: 'RECONCILING', reasons: ['CANCELLED_WITH_PROCESSED_PAYMENT'] };
    return { decision: 'CANCELLED', reasons: ['REMOTE_CANCELLED'] };
  }

  if (status === 'refunded') {
    return { decision: 'REFUNDED', reasons: ['REMOTE_REFUNDED'] };
  }

  if (status === 'created' || status === 'action_required' || status === 'at_terminal') {
    return { decision: 'PENDING', reasons: [`REMOTE_${String(status).toUpperCase()}`] };
  }

  if (status === PROCESSED) {
    // processed sem accredited (ex.: em análise) não confirma.
    return { decision: 'RECONCILING', reasons: [`PROCESSED_WITHOUT_ACCREDITED:${detail ?? 'none'}`] };
  }

  return { decision: 'RECONCILING', reasons: [`UNKNOWN_STATUS:${status ?? 'none'}/${detail ?? 'none'}`] };
}

function evaluateProcessed(expected: ChargeExpectation, order: MpOrder, payments: MpOrderPayment[]): OrderEvaluation {
  const reasons: string[] = [];

  // 3. Moeda e valores com tolerância zero.
  if (order.currency !== 'BRL') reasons.push(order.currency ? `CURRENCY_MISMATCH:${order.currency}` : 'CURRENCY_MISSING');
  const total = tryDecimalStringToCents(order.total_amount);
  const totalPaid = tryDecimalStringToCents(order.total_paid_amount);
  if (total !== expected.amountCents) reasons.push('TOTAL_AMOUNT_MISMATCH');
  if (totalPaid !== expected.amountCents) reasons.push('TOTAL_PAID_AMOUNT_MISMATCH');

  // 5. Transação correspondente processada/acreditada.
  const accredited = payments.filter((p) => isProcessedAccredited(p));
  if (accredited.length === 0) {
    reasons.push('NO_ACCREDITED_TRANSACTION');
  } else if (accredited.length > 1) {
    reasons.push('MULTIPLE_ACCREDITED_TRANSACTIONS');
  }
  const tx = accredited[0];
  let payment: ConfirmedPaymentData | undefined;
  if (tx) {
    const amount = tryDecimalStringToCents(tx.amount);
    const paid = tryDecimalStringToCents(tx.paid_amount);
    if (amount !== expected.amountCents) reasons.push('TRANSACTION_AMOUNT_MISMATCH');
    if (paid !== expected.amountCents) reasons.push('TRANSACTION_PAID_AMOUNT_MISMATCH');
    if (tx.payment_method?.id !== expected.requiredPaymentMethodId) {
      reasons.push(`PAYMENT_METHOD_MISMATCH:${tx.payment_method?.id ?? 'none'}`);
    }
    if (!tx.id) reasons.push('TRANSACTION_ID_MISSING');
    if (reasons.length === 0 && amount !== null && paid !== null && tx.id) {
      payment = {
        mpPaymentId: tx.id,
        mpReferenceId: tx.reference_id ?? null,
        amountCents: amount,
        paidAmountCents: paid,
        method: tx.payment_method?.id ?? 'unknown',
        status: tx.status!,
        statusDetail: tx.status_detail!,
      };
    }
  }

  if (reasons.length > 0 || !payment) {
    return { decision: 'RECONCILING', reasons: reasons.length ? reasons : ['PAYMENT_DATA_INCOMPLETE'] };
  }
  return { decision: 'PAID', reasons: ['PROCESSED_ACCREDITED_VALIDATED'], payment };
}
