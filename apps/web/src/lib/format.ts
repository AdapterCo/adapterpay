import { CHARGE_STATUS_LABELS, formatBRL, type ChargeStatus } from '@adapterpay/shared';

export { formatBRL };

export function formatDateTime(iso: string | Date | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(d);
}

export function formatDate(iso: string | Date | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone }).format(d);
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export function chargeTone(status: string): Tone {
  switch (status as ChargeStatus) {
    case 'PAID':
      return 'success';
    case 'PENDING':
    case 'CREATING':
      return 'info';
    case 'RECONCILING':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'danger';
    case 'REFUNDED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function chargeLabel(status: string): string {
  return CHARGE_STATUS_LABELS[status as ChargeStatus] ?? status;
}

export const POS_STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: 'Em revisão',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  REMOTE_MISSING: 'Ausente no Mercado Pago',
  NEEDS_REGULARIZATION: 'Precisa regularizar',
};

export const SUBSCRIPTION_LABELS: Record<string, string> = {
  PENDING: 'Aguardando pagamento',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Suspensa (vencida)',
  CANCELED: 'Cancelada',
};

export const TENANT_STATUS_LABELS: Record<string, string> = {
  PENDING_ACTIVATION: 'Aguardando ativação',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
};

/** Data local (YYYY-MM-DD) -> ISO do início/fim do dia no fuso do navegador. */
export function dayRangeToIso(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  t.setDate(t.getDate() + 1);
  return { from: f.toISOString(), to: t.toISOString() };
}

export function todayInput(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
