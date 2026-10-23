import { isUniqueViolation, type PrismaClient } from '@adapterpay/database';
import { computeSavings, formatBps, formatBRL, type SavingsResult } from '@adapterpay/shared';
import type { CoreDeps } from '../context';
import { isWhatsAppConfigured, sendWhatsAppText } from '../whatsapp/evolution';

/**
 * Fechamento de caixa diário por WhatsApp: total, quantidade, ticket médio, por caixa e por vendedor,
 * e a economia do dia contra maquininha/link. Um envio por tenant e dia local (tabela daily_reports).
 * Horário de envio até 5h resume o dia anterior inteiro; a partir de 6h resume o dia atual até o envio.
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const PREVIOUS_DAY_BEFORE_HOUR = 6;

/** Diferença (ms) entre o horário local do fuso e o UTC naquele instante. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Dia (YYYY-MM-DD) e hora (0–23) locais de um instante. */
export function localDayHour(at: Date, timeZone: string): { day: string; hour: number } {
  const local = new Date(at.getTime() + tzOffsetMs(at, timeZone));
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** Instante UTC da meia-noite local de um dia (YYYY-MM-DD). */
export function localMidnight(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - tzOffsetMs(first, timeZone));
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dia que o envio deste instante resume, e o intervalo [from, to). */
export function closingWindow(now: Date, timeZone: string, reportHour: number): { day: string; from: Date; to: Date; partial: boolean } {
  const { day: today } = localDayHour(now, timeZone);
  if (reportHour < PREVIOUS_DAY_BEFORE_HOUR) {
    const day = addDays(today, -1);
    return { day, from: localMidnight(day, timeZone), to: localMidnight(today, timeZone), partial: false };
  }
  return { day: today, from: localMidnight(today, timeZone), to: now, partial: true };
}

export interface ClosingLine {
  name: string;
  count: number;
  grossCents: number;
}

export interface DailyClosing {
  tradeName: string;
  day: string;
  timeZone: string;
  until: Date;
  partial: boolean;
  paidCount: number;
  grossCents: number;
  averageCents: number;
  expiredCount: number;
  byPos: ClosingLine[];
  bySeller: ClosingLine[];
  feeUnknownCount: number;
  savings: SavingsResult;
  posRateBps: number;
  linkRateBps: number;
}

export async function buildDailyClosing(
  prisma: PrismaClient,
  tenantId: string,
  window: { day: string; from: Date; to: Date; partial: boolean },
): Promise<DailyClosing> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { tradeName: true, timezone: true, savingsPosRateBps: true, savingsLinkRateBps: true },
  });
  const [paid, expiredCount] = await Promise.all([
    prisma.charge.findMany({
      where: { tenantId, status: 'PAID', paidAt: { gte: window.from, lt: window.to } },
      select: {
        amountCents: true,
        pos: { select: { name: true, store: { select: { name: true } } } },
        seller: { select: { name: true } },
        payments: { select: { feeCents: true } },
      },
    }),
    prisma.charge.count({ where: { tenantId, status: 'EXPIRED', terminalAt: { gte: window.from, lt: window.to } } }),
  ]);

  const group = (key: (c: (typeof paid)[number]) => string) => {
    const map = new Map<string, ClosingLine>();
    for (const c of paid) {
      const k = key(c);
      const line = map.get(k) ?? { name: k, count: 0, grossCents: 0 };
      line.count += 1;
      line.grossCents += c.amountCents;
      map.set(k, line);
    }
    return [...map.values()].sort((a, b) => b.grossCents - a.grossCents);
  };

  const grossCents = paid.reduce((s, c) => s + c.amountCents, 0);
  const fees = paid.map((c) => c.payments[0]?.feeCents ?? null);
  const known = fees.filter((f): f is number => f !== null);
  return {
    tradeName: tenant.tradeName,
    day: window.day,
    timeZone: tenant.timezone,
    until: window.to,
    partial: window.partial,
    paidCount: paid.length,
    grossCents,
    averageCents: paid.length ? Math.round(grossCents / paid.length) : 0,
    expiredCount,
    byPos: group((c) => `${c.pos.store.name} · ${c.pos.name}`),
    bySeller: group((c) => c.seller.name),
    feeUnknownCount: fees.length - known.length,
    savings: computeSavings({
      grossCents,
      paidFeeCents: known.length ? known.reduce((s, f) => s + f, 0) : null,
      posRateBps: tenant.savingsPosRateBps,
      linkRateBps: tenant.savingsLinkRateBps,
    }),
    posRateBps: tenant.savingsPosRateBps,
    linkRateBps: tenant.savingsLinkRateBps,
  };
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Texto do WhatsApp (negrito com *asteriscos*). */
export function formatDailyClosing(c: DailyClosing, opts: { test?: boolean } = {}): string {
  const [y, m, d] = c.day.split('-');
  const weekday = WEEKDAYS[new Date(`${c.day}T12:00:00.000Z`).getUTCDay()];
  const until = c.partial
    ? ` até ${new Intl.DateTimeFormat('pt-BR', { timeZone: c.timeZone, hour: '2-digit', minute: '2-digit' }).format(c.until)}`
    : '';
  const lines: string[] = [
    `*Fechamento de caixa${opts.test ? ' (teste)' : ''} — ${c.tradeName}*`,
    `${d}/${m}/${y} (${weekday})${until}`,
    '',
  ];
  if (c.paidCount === 0) {
    lines.push('Nenhuma venda paga no período.');
  } else {
    lines.push(
      `Total recebido: *${formatBRL(c.grossCents)}*`,
      `Vendas: ${c.paidCount} · Ticket médio: ${formatBRL(c.averageCents)}`,
    );
  }
  if (c.expiredCount > 0) lines.push(`Cobranças expiradas sem pagamento: ${c.expiredCount}`);
  const section = (title: string, rows: ClosingLine[]) => {
    if (!rows.length) return;
    lines.push('', `*${title}*`);
    for (const r of rows.slice(0, 15)) lines.push(`• ${r.name}: ${formatBRL(r.grossCents)} (${r.count})`);
    if (rows.length > 15) lines.push(`• e mais ${rows.length - 15}`);
  };
  section('Por caixa', c.byPos);
  section('Por vendedor', c.bySeller);
  if (c.paidCount > 0) {
    lines.push(
      '',
      '*Quanto você economizou*',
      `Tarifa paga no AdapterPay: ${formatBRL(c.savings.paidFeeCents)}${c.feeUnknownCount ? ` (${c.feeUnknownCount} ainda sem tarifa informada)` : ''}`,
      `Pix na maquininha (${formatBps(c.posRateBps)}): ${formatBRL(c.savings.posFeeCents)} → economia de *${formatBRL(c.savings.savedVsPosCents)}*`,
      `Pix por link (${formatBps(c.linkRateBps)}): ${formatBRL(c.savings.linkFeeCents)} → economia de *${formatBRL(c.savings.savedVsLinkCents)}*`,
    );
  }
  lines.push('', '_AdapterPay · relatório automático_');
  return lines.join('\n');
}

/** Envia agora o fechamento do dia atual (parcial) para o WhatsApp configurado — botão "Enviar teste". */
export async function sendDailyClosingTest(deps: CoreDeps, tenantId: string, phone: string): Promise<void> {
  const tenant = await deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
  const now = new Date();
  const { day } = localDayHour(now, tenant.timezone);
  const closing = await buildDailyClosing(deps.prisma, tenantId, { day, from: localMidnight(day, tenant.timezone), to: now, partial: true });
  await sendWhatsAppText(deps.config, phone, formatDailyClosing(closing, { test: true }));
}

/** Job periódico do worker: envia os fechamentos devidos. Idempotente por (tenant, dia). */
export async function runDailyReports(deps: CoreDeps, now = new Date()): Promise<{ sent: number; failed: number }> {
  if (!isWhatsAppConfigured(deps.config)) return { sent: 0, failed: 0 };
  const tenants = await deps.prisma.tenant.findMany({
    where: { dailyReportEnabled: true, dailyReportPhone: { not: null }, status: 'ACTIVE', deletedAt: null },
    select: { id: true, timezone: true, dailyReportHour: true, dailyReportPhone: true },
  });
  let sent = 0;
  let failed = 0;
  for (const t of tenants) {
    if (localDayHour(now, t.timezone).hour < t.dailyReportHour) continue;
    const window = closingWindow(now, t.timezone, t.dailyReportHour);
    if (!(await claim(deps.prisma, t.id, window.day, now))) continue;
    try {
      const closing = await buildDailyClosing(deps.prisma, t.id, window);
      await sendWhatsAppText(deps.config, t.dailyReportPhone!, formatDailyClosing(closing));
      await deps.prisma.dailyReport.update({
        where: { tenantId_day: { tenantId: t.id, day: window.day } },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      sent++;
    } catch (err) {
      failed++;
      deps.logger.warn({ tenantId: t.id, day: window.day, err: (err as Error).message }, 'fechamento diário não enviado');
      await deps.prisma.dailyReport.update({
        where: { tenantId_day: { tenantId: t.id, day: window.day } },
        data: { status: 'FAILED', lastError: (err as Error).message.slice(0, 300) },
      });
    }
  }
  return { sent, failed };
}

/** Reserva o envio do dia: cria a linha, ou retoma uma falha/pendência antiga com tentativas restantes. */
async function claim(prisma: PrismaClient, tenantId: string, day: string, now: Date): Promise<boolean> {
  try {
    await prisma.dailyReport.create({ data: { tenantId, day, status: 'PENDING', attempts: 1 } });
    return true;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  const retried = await prisma.dailyReport.updateMany({
    where: {
      tenantId,
      day,
      status: { in: ['FAILED', 'PENDING'] },
      attempts: { lt: MAX_ATTEMPTS },
      updatedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) },
    },
    data: { status: 'PENDING', attempts: { increment: 1 } },
  });
  return retried.count === 1;
}
