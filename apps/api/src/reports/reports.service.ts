import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { localDayHour, localMidnight, type CoreDeps } from '@adapterpay/core';
import { Prisma } from '@adapterpay/database';
import { CHARGE_STATUS_LABELS, centsToDecimalString, computeSavings, type ChargeStatus } from '@adapterpay/shared';
import { storeScope } from '../common/access';
import { Errors } from '../common/errors';
import type { AuthContext } from '../common/request';
import { CORE } from '../common/tokens';

interface Range {
  from: Date;
  to: Date;
  storeId?: string;
  posId?: string;
  sellerId?: string;
}

const EXPORT_LIMIT = 50_000;

/** Início do dia (00:00) no fuso do tenant, em UTC. */
function startOfDayInTz(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Offset do fuso naquele instante.
  const local = new Date(new Date(now).toLocaleString('en-US', { timeZone }));
  const offsetMs = local.getTime() - now.getTime();
  return new Date(new Date(`${parts}T00:00:00.000Z`).getTime() - offsetMs);
}

@Injectable()
export class ReportsService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  private scopeSql(auth: AuthContext, r: Partial<Range>): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`c.tenant_id = ${auth.tenantId}::uuid`];
    if (auth.storeIds !== 'ALL') {
      if (auth.storeIds.length === 0) parts.push(Prisma.sql`FALSE`);
      else parts.push(Prisma.sql`c.store_id = ANY(${auth.storeIds}::uuid[])`);
    }
    if (r.storeId) parts.push(Prisma.sql`c.store_id = ${r.storeId}::uuid`);
    if (r.posId) parts.push(Prisma.sql`c.pos_id = ${r.posId}::uuid`);
    if (r.sellerId) parts.push(Prisma.sql`c.seller_id = ${r.sellerId}::uuid`);
    return Prisma.join(parts, ' AND ');
  }

  private async summary(auth: AuthContext, r: Range) {
    const scope = this.scopeSql(auth, r);
    const rows = await this.deps.prisma.$queryRaw<
      Array<{ paid_count: bigint; gross: bigint | null; fee: bigint | null; net: bigint | null; fee_unknown: bigint }>
    >`
      SELECT COUNT(*)::bigint AS paid_count,
             SUM(c.amount_cents)::bigint AS gross,
             SUM(p.fee_cents)::bigint AS fee,
             SUM(p.net_amount_cents)::bigint AS net,
             COUNT(*) FILTER (WHERE p.fee_cents IS NULL)::bigint AS fee_unknown
      FROM charges c
      LEFT JOIN payments p ON p.charge_id = c.id
      WHERE ${scope} AND c.status IN ('PAID') AND c.paid_at >= ${r.from} AND c.paid_at < ${r.to}`;
    const s = rows[0]!;
    return {
      paidCount: Number(s.paid_count),
      grossCents: Number(s.gross ?? 0),
      // null quando nenhuma tarifa foi exposta pelo provedor (não assumir zero).
      feeCents: s.fee === null ? null : Number(s.fee),
      netCents: s.net === null ? null : Number(s.net),
      feeUnknownCount: Number(s.fee_unknown),
    };
  }

  private async grouped(auth: AuthContext, r: Range, column: 'store_id' | 'pos_id' | 'seller_id') {
    const scope = this.scopeSql(auth, r);
    const col = Prisma.raw(`c.${column}`);
    const rows = await this.deps.prisma.$queryRaw<Array<{ key: string; paid_count: bigint; gross: bigint | null }>>`
      SELECT ${col}::text AS key, COUNT(*)::bigint AS paid_count, SUM(c.amount_cents)::bigint AS gross
      FROM charges c
      WHERE ${scope} AND c.status = 'PAID' AND c.paid_at >= ${r.from} AND c.paid_at < ${r.to}
      GROUP BY ${col} ORDER BY gross DESC NULLS LAST LIMIT 50`;
    const ids = rows.map((x) => x.key);
    const names = new Map<string, string>();
    if (column === 'store_id') (await this.deps.prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).forEach((s) => names.set(s.id, s.name));
    if (column === 'pos_id') (await this.deps.prisma.posTerminal.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).forEach((s) => names.set(s.id, s.name));
    if (column === 'seller_id') (await this.deps.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).forEach((s) => names.set(s.id, s.name));
    return rows.map((x) => ({ id: x.key, name: names.get(x.key) ?? '—', paidCount: Number(x.paid_count), grossCents: Number(x.gross ?? 0) }));
  }

  async dashboard(auth: AuthContext) {
    const tenant = await this.deps.prisma.tenant.findUniqueOrThrow({
      where: { id: auth.tenantId! },
      select: { timezone: true, savingsPosRateBps: true, savingsLinkRateBps: true },
    });
    const now = new Date();
    const today = startOfDayInTz(now, tenant.timezone);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const monthAgo = new Date(today.getTime() - 29 * 86_400_000);
    const monthStart = localMidnight(`${localDayHour(now, tenant.timezone).day.slice(0, 8)}01`, tenant.timezone);
    const month = await this.summary(auth, { from: monthStart, to: tomorrow });
    const scope = this.scopeSql(auth, {});
    const baseWhere = { tenantId: auth.tenantId!, ...storeScope(auth) };

    const [todaySummary, active, expiredToday, reconciling, byStore, byPos, bySeller, recent, topProducts] = await Promise.all([
      this.summary(auth, { from: today, to: tomorrow }),
      this.deps.prisma.charge.count({ where: { ...baseWhere, status: { in: ['CREATING', 'PENDING'] } } }),
      this.deps.prisma.charge.count({ where: { ...baseWhere, status: 'EXPIRED', terminalAt: { gte: today, lt: tomorrow } } }),
      this.deps.prisma.charge.count({ where: { ...baseWhere, status: 'RECONCILING' } }),
      this.grouped(auth, { from: monthAgo, to: tomorrow }, 'store_id'),
      this.grouped(auth, { from: monthAgo, to: tomorrow }, 'pos_id'),
      this.grouped(auth, { from: monthAgo, to: tomorrow }, 'seller_id'),
      // Últimas vendas pagas (atualiza ao vivo no painel via evento charge.updated).
      this.deps.prisma.charge.findMany({
        where: { ...baseWhere, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take: 8,
        select: {
          id: true,
          amountCents: true,
          paidAt: true,
          description: true,
          orderNumber: true,
          pos: { select: { name: true } },
          totem: { select: { name: true } },
          items: { select: { name: true, quantity: true } },
        },
      }),
      // Mais vendidos do mês: itens de catálogo/totem das cobranças pagas.
      this.deps.prisma.$queryRaw<Array<{ name: string; qty: bigint; gross: bigint }>>`
        SELECT i.name, SUM(i.quantity)::bigint AS qty, SUM(i.quantity * i.unit_price_cents)::bigint AS gross
        FROM charge_items i
        JOIN charges c ON c.id = i.charge_id
        WHERE ${scope} AND c.status = 'PAID' AND c.paid_at >= ${monthStart} AND c.paid_at < ${tomorrow}
        GROUP BY i.name
        ORDER BY qty DESC, gross DESC
        LIMIT 8`,
    ]);
    return {
      timezone: tenant.timezone,
      today: { ...todaySummary, activeCharges: active, expiredToday, reconciling },
      // "Quanto você economizou" no mês corrente: tarifa real paga x Pix na maquininha/link.
      savingsMonth: {
        ...computeSavings({
          grossCents: month.grossCents,
          paidFeeCents: month.feeCents,
          posRateBps: tenant.savingsPosRateBps,
          linkRateBps: tenant.savingsLinkRateBps,
        }),
        paidCount: month.paidCount,
        feeUnknownCount: month.feeUnknownCount,
        posRateBps: tenant.savingsPosRateBps,
        linkRateBps: tenant.savingsLinkRateBps,
      },
      recentSales: recent.map((c) => ({
        id: c.id,
        amountCents: c.amountCents,
        paidAt: c.paidAt,
        orderNumber: c.orderNumber,
        origin: c.totem?.name ?? c.pos.name,
        summary: c.items.length ? c.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') : c.description,
      })),
      topProducts: topProducts.map((p) => ({ name: p.name, quantity: Number(p.qty), grossCents: Number(p.gross) })),
      last30Days: { byStore, byPos, bySeller },
    };
  }

  async sales(auth: AuthContext, r: Range) {
    this.assertRange(r);
    const [summary, byStore, byPos, bySeller, divergences] = await Promise.all([
      this.summary(auth, r),
      this.grouped(auth, r, 'store_id'),
      this.grouped(auth, r, 'pos_id'),
      this.grouped(auth, r, 'seller_id'),
      this.deps.prisma.charge.findMany({
        where: { tenantId: auth.tenantId!, ...storeScope(auth), status: 'RECONCILING' },
        select: { id: true, externalReference: true, amountCents: true, statusReason: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const refunds = await this.deps.prisma.payment.findMany({
      where: { tenantId: auth.tenantId!, refundedAt: { gte: r.from, lt: r.to }, charge: storeScope(auth) },
      select: { mpPaymentId: true, amountCents: true, refundedAt: true, chargeId: true },
    });
    return { range: { from: r.from, to: r.to }, summary, byStore, byPos, bySeller, divergences, refunds };
  }

  private assertRange(r: Range): void {
    if (!(r.from < r.to)) throw Errors.validation('Período inválido');
    if (r.to.getTime() - r.from.getTime() > 366 * 86_400_000) throw Errors.validation('Período máximo de 366 dias');
  }

  async exportRows(auth: AuthContext, r: Range) {
    this.assertRange(r);
    const charges = await this.deps.prisma.charge.findMany({
      where: {
        tenantId: auth.tenantId!,
        ...storeScope(auth),
        ...(r.storeId ? { storeId: r.storeId } : {}),
        ...(r.posId ? { posId: r.posId } : {}),
        ...(r.sellerId ? { sellerId: r.sellerId } : {}),
        createdAt: { gte: r.from, lt: r.to },
      },
      include: {
        store: { select: { name: true } },
        pos: { select: { name: true } },
        seller: { select: { name: true } },
        payments: true,
      },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_LIMIT + 1,
    });
    if (charges.length > EXPORT_LIMIT) throw Errors.validation(`Exportação limitada a ${EXPORT_LIMIT} linhas; reduza o período`);
    const dec = (v: number | null | undefined) => (v === null || v === undefined ? '' : centsToDecimalString(v));
    return charges.map((c) => {
      const p = c.payments[0];
      return {
        criado_em: c.createdAt.toISOString(),
        pago_em: c.paidAt?.toISOString() ?? '',
        loja: c.store.name,
        pos: c.pos.name,
        vendedor: c.seller.name,
        referencia: c.externalReference,
        order_id: c.orderId ?? '',
        payment_id: p?.mpPaymentId ?? c.mpPaymentId ?? '',
        reference_id: p?.mpReferenceId ?? '',
        status: CHARGE_STATUS_LABELS[c.status as ChargeStatus],
        valor: dec(c.amountCents),
        valor_pago: dec(p?.paidAmountCents),
        tarifa: dec(p?.feeCents),
        liquido: dec(p?.netAmountCents),
        metodo: p?.method ?? '',
        estornado_em: p?.refundedAt?.toISOString() ?? '',
        descricao: c.description ?? '',
      };
    });
  }

  toCsv(rows: Array<Record<string, string>>): Buffer {
    const headers = rows.length ? Object.keys(rows[0]!) : ['criado_em'];
    const esc = (v: string) => {
      // Neutraliza fórmulas em planilhas (CSV injection).
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(','))];
    return Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8');
  }

  async toXlsx(rows: Array<Record<string, string>>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AdapterPay';
    const ws = wb.addWorksheet('Cobranças');
    const headers = rows.length ? Object.keys(rows[0]!) : ['criado_em'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 4) }));
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
