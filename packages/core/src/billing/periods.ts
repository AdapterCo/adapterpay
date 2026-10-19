/**
 * Datas de ciclo de assinatura. Todos os instantes são UTC.
 * O vencimento de uma competência é o instante exato `current_period_end` (UTC);
 * a exibição usa BILLING_DISPLAY_TIMEZONE (America/Sao_Paulo por padrão).
 */

/** Soma meses preservando o dia; se o mês alvo não tiver o dia, usa o último dia do mês. */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(d, lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function formatInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
