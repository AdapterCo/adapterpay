import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { CoreDeps } from '@adapterpay/core';
import {
  currentShare,
  ERROR_CODES,
  nextTableChargeCents,
  paidPercent,
  remainingCents,
  tableChooseSchema,
  validateBrCode,
} from '@adapterpay/shared';
import type { z } from 'zod';
import { Public, SkipCsrf } from '../auth/decorators';
import { ChargesService } from '../charges/charges.service';
import { AppError, Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { Meta, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ZBody } from '../common/zod';
import { billState } from './tables.controller';

const SLUG_RE = /^[a-z0-9]{20,40}$/;
const RECENT_PAID_MS = 10 * 60 * 1000;
const ACTIVE = ['CREATING', 'PENDING', 'RECONCILING'];

type TableRow = Awaited<ReturnType<PublicTablesController['table']>>;

/**
 * Página da mesa (QR da mesa, sem login): o cliente escolhe pagar integral ou dividido e paga a vez dele.
 * O valor de cada cobrança é sempre calculado aqui, a partir da conta; o celular só pede "pagar minha parte".
 */
@ApiTags('public')
@Public()
@SkipCsrf()
@Controller('public/tables')
export class PublicTablesController {
  private readonly appOrigin: string;

  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly charges: ChargesService,
  ) {
    this.appOrigin = new URL(deps.config.APP_URL).origin;
  }

  /** Proteção equivalente ao CSRF: mesma origem + cabeçalho próprio (formulários de outros sites não enviam). */
  private assertSameOrigin(req: Request): void {
    const origin = req.headers.origin;
    if ((typeof origin === 'string' && origin !== this.appOrigin) || req.headers['x-adapterpay-table'] !== '1') {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Origem não permitida');
    }
  }

  /** Cobranças da mesa saem em nome de quem abriu a conta (garçom/caixa), só na loja da mesa. */
  private tableAuth(t: TableRow, openedById: string, role: 'VENDEDOR' | 'ADMIN'): AuthContext {
    return {
      sessionId: `table:${t.id}`,
      userId: openedById,
      email: '',
      name: t.name,
      isSuperadmin: false,
      mfaEnabled: false,
      mfaVerified: false,
      tenantId: t.tenantId,
      role,
      isOwner: false,
      storeIds: [t.storeId],
      tenantStatus: null,
      subscriptionStatus: null,
      requireAdminMfa: false,
    };
  }

  private async table(slug: string) {
    if (!SLUG_RE.test(slug)) throw Errors.notFound('Mesa');
    const t = await this.deps.prisma.restaurantTable.findUnique({
      where: { publicSlug: slug },
      include: {
        pos: { select: { id: true, qrCode: true, activeChargeId: true, status: true, store: { select: { name: true } } } },
        tenant: { select: { tradeName: true, logoUrl: true, brandColor: true, googleReviewUrl: true, restaurantMode: true, deletedAt: true } },
      },
    });
    if (!t || t.status !== 'ACTIVE' || !t.tenant.restaurantMode || t.tenant.deletedAt) throw Errors.notFound('Mesa');
    return t;
  }

  private openBill(tableId: string) {
    return this.deps.prisma.tableBill.findFirst({ where: { tableId, status: 'OPEN' } });
  }

  @Get(':slug')
  @RateLimit({ key: 'pub-table', limit: 120, windowSec: 60 })
  async view(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return this.render(await this.table(slug));
  }

  /** Pagar integral ou dividido em N pessoas. Se já houve pagamentos, N vale para quem ainda falta pagar. */
  @Post(':slug/choose')
  @HttpCode(200)
  @RateLimit({ key: 'pub-table-choose', limit: 20, windowSec: 60 })
  async choose(@Param('slug') slug: string, @Req() req: Request, @ZBody(tableChooseSchema) body: z.infer<typeof tableChooseSchema>) {
    this.assertSameOrigin(req);
    const t = await this.table(slug);
    const bill = await this.openBill(t.id);
    if (!bill) throw Errors.validation('Esta mesa não tem conta aberta. Chame o garçom.');
    if (await this.activeChargeOf(t, bill.id)) throw Errors.conflict('Há um Pix desta mesa em andamento. Aguarde a confirmação.');
    await this.deps.prisma.tableBill.update({
      where: { id: bill.id },
      data:
        body.mode === 'FULL'
          ? { mode: 'FULL', splitCount: null }
          : { mode: 'SPLIT', splitCount: bill.paidShares + body.people!, paidShares: bill.mode === 'SPLIT' ? bill.paidShares : 0 },
    });
    return this.render(await this.table(slug));
  }

  /** Gera o Pix da vez (integral: tudo o que falta; dividido: a parte desta pessoa). */
  @Post(':slug/pay')
  @HttpCode(201)
  @RateLimit({ key: 'pub-table-pay', limit: 12, windowSec: 60 })
  async pay(@Param('slug') slug: string, @Req() req: Request, @Meta() meta: RequestMeta) {
    this.assertSameOrigin(req);
    const t = await this.table(slug);
    const bill = await this.openBill(t.id);
    if (!bill) throw Errors.validation('Esta mesa não tem conta aberta. Chame o garçom.');
    if (!bill.mode) throw Errors.validation('Escolha pagar integral ou dividido');
    const s = billState(bill);
    const amount = nextTableChargeCents(s);
    if (amount <= 0) throw Errors.validation('A conta desta mesa já está paga');
    const share = currentShare(s);
    const created = await this.charges.create(this.tableAuth(t, bill.openedById, 'VENDEDOR'), { posId: t.posId, amountCents: amount }, undefined, meta, {
      tableBillId: bill.id,
      description: share ? `${t.name} · parte ${share.number} de ${share.of}` : `${t.name} · conta integral`,
    });
    return { chargeId: created.id, ...(await this.render(await this.table(slug))) };
  }

  /** Libera o caixa da mesa quando alguém desistiu do Pix (senão ele expira sozinho em até 3 minutos). */
  @Post(':slug/cancel')
  @HttpCode(200)
  @RateLimit({ key: 'pub-table-cancel', limit: 10, windowSec: 60 })
  async cancel(@Param('slug') slug: string, @Req() req: Request, @Meta() meta: RequestMeta) {
    this.assertSameOrigin(req);
    const t = await this.table(slug);
    const bill = await this.openBill(t.id);
    const c = bill ? await this.activeChargeOf(t, bill.id) : null;
    if (bill && c?.orderId) {
      await this.charges.cancel(this.tableAuth(t, bill.openedById, 'ADMIN'), c.id, meta).catch((err) => {
        this.deps.logger.warn({ chargeId: c.id, err: (err as Error).message }, 'cancelamento pela mesa não confirmado');
      });
    }
    return this.render(await this.table(slug));
  }

  private async activeChargeOf(t: TableRow, billId: string) {
    if (!t.pos.activeChargeId) return null;
    const c = await this.deps.prisma.charge.findUnique({
      where: { id: t.pos.activeChargeId },
      select: { id: true, status: true, amountCents: true, expiresAt: true, orderId: true, tableBillId: true, description: true },
    });
    return c && c.tableBillId === billId && ACTIVE.includes(c.status) ? c : null;
  }

  /** Visão segura da mesa: conta, vez de quem paga e o Pix somente enquanto a cobrança está ativa. */
  private async render(t: TableRow) {
    const base = {
      tableName: t.name,
      storeName: t.pos.store.name,
      tradeName: t.tenant.tradeName,
      logoUrl: t.tenant.logoUrl,
      brandColor: t.tenant.brandColor,
      googleReviewUrl: t.tenant.googleReviewUrl,
      serverTime: new Date().toISOString(),
    };
    const open = await this.openBill(t.id);
    const bill =
      open ??
      (await this.deps.prisma.tableBill.findFirst({
        where: { tableId: t.id, status: 'PAID', closedAt: { gte: new Date(Date.now() - RECENT_PAID_MS) } },
        orderBy: { closedAt: 'desc' },
      }));
    if (!bill) return { ...base, bill: null, charge: null };
    const s = billState(bill);
    const c = open ? await this.activeChargeOf(t, open.id) : null;
    const live = !!c && c.status === 'PENDING' && !!c.expiresAt && c.expiresAt > new Date();
    const brOk = !!t.pos.qrCode && validateBrCode(t.pos.qrCode).valid;
    return {
      ...base,
      bill: {
        id: bill.id,
        state: bill.status as 'OPEN' | 'PAID',
        totalCents: bill.totalCents,
        paidCents: bill.paidCents,
        remainingCents: remainingCents(s),
        percent: paidPercent(s),
        mode: s.mode,
        splitCount: bill.splitCount,
        paidShares: bill.paidShares,
        share: currentShare(s),
        nextChargeCents: nextTableChargeCents(s),
      },
      charge: c
        ? {
            id: c.id,
            state: live && brOk ? 'PENDING' : 'PREPARING',
            amountCents: c.amountCents,
            label: c.description,
            expiresAt: c.expiresAt,
            pixCopyPaste: live && brOk ? t.pos.qrCode : null,
          }
        : null,
    };
  }
}
