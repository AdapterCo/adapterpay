/**
 * Estados internos da cobrança (seção 8) e transições válidas.
 * PAID é irreversível: só evolui para REFUNDED (evento distinto). Uma resposta antiga nunca regride PAID.
 */
export const CHARGE_STATUSES = [
  'CREATING',
  'PENDING',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
  'RECONCILING',
  'REFUNDED',
] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Estados que mantêm o POS estático ocupado. */
export const ACTIVE_CHARGE_STATUSES: readonly ChargeStatus[] = ['CREATING', 'PENDING', 'RECONCILING'];

/** Estados finais do ponto de vista do POS (liberam o POS). */
export const POS_RELEASING_STATUSES: readonly ChargeStatus[] = ['PAID', 'EXPIRED', 'CANCELLED', 'FAILED', 'REFUNDED'];

const TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  CREATING: ['PENDING', 'FAILED', 'RECONCILING'],
  PENDING: ['PAID', 'EXPIRED', 'CANCELLED', 'RECONCILING'],
  RECONCILING: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED'],
  // Pagamento confirmado remotamente depois de um encerramento (pagamento atrasado detectado na reconciliação).
  // Só é aplicado quando a avaliação estrita da Order retorna PAID.
  EXPIRED: ['PAID'],
  CANCELLED: ['PAID'],
  FAILED: [],
  PAID: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function isActiveCharge(status: ChargeStatus): boolean {
  return ACTIVE_CHARGE_STATUSES.includes(status);
}

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  CREATING: 'Criando',
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  EXPIRED: 'Expirada',
  CANCELLED: 'Cancelada',
  FAILED: 'Falhou',
  RECONCILING: 'Em conciliação',
  REFUNDED: 'Estornada',
};
