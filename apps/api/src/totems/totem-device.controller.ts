import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomToken, sha256Hex, type CoreDeps } from '@adapterpay/core';
import {
  ERROR_CODES,
  normalizeBrWhatsApp,
  totemOrderSchema,
  totemPairSchema,
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
import { productImageUrl } from '../products/product-images';

const COOKIE_MAX_AGE_MS = 400 * 86_400_000;
const SEEN_THROTTLE_MS = 60_000;

type Device = Awaited<ReturnType<TotemDeviceController['device']>>;

/**
 * API do dispositivo totem. Sem sessão de usuário: o tablet se autentica pelo cookie do totem
 * (token aleatório, guardado só como hash), que só permite catálogo e pedidos no POS do próprio totem.
 */
@ApiTags('totem')
@Public()
@SkipCsrf()
@Controller('totem')
export class TotemDeviceController {
  private readonly appOrigin: string;

  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly charges: ChargesService,
  ) {
    this.appOrigin = new URL(deps.config.APP_URL).origin;
  }

  private cookieName(): string {
    return this.deps.config.NODE_ENV === 'production' ? '__Host-ap_totem' : 'ap_totem';
  }

  /** Proteção equivalente ao CSRF: mesma origem + cabeçalho próprio (formulários de outros sites não enviam). */
  private assertSameOrigin(req: Request): void {
    const origin = req.headers.origin;
    if ((typeof origin === 'string' && origin !== this.appOrigin) || req.headers['x-adapterpay-totem'] !== '1') {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Origem não permitida');
    }
  }

  private async device(req: Request) {
    const token = req.cookies?.[this.cookieName()] as string | undefined;
    if (!token || token.length > 200) throw new AppError(401, 'TOTEM_UNPAIRED', 'Totem não pareado');
    const d = await this.deps.prisma.totemDevice.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: {
        pos: { include: { store: true } },
        tenant: { select: { id: true, tradeName: true, logoUrl: true, brandColor: true, status: true, loyaltyMode: true, loyaltyCashbackBps: true, loyaltyGiftEvery: true, loyaltyGiftName: true } },
      },
    });
    if (!d || d.status !== 'ACTIVE') throw new AppError(401, 'TOTEM_UNPAIRED', 'Totem não pareado ou revogado');
    if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > SEEN_THROTTLE_MS) {
      await this.deps.prisma.totemDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    }
    return d;
  }

  /** Contexto de "vendedor" do totem: usuário de serviço, só a loja do totem. */
  private authFor(d: Device, role: 'VENDEDOR' | 'ADMIN' = 'VENDEDOR'): AuthContext {
    return {
      sessionId: `totem:${d.id}`,
      userId: d.userId,
      email: '',
      name: d.name,
      isSuperadmin: false,
      mfaEnabled: false,
      mfaVerified: false,
      tenantId: d.tenantId,
      role,
      isOwner: false,
      storeIds: [d.storeId],
      tenantStatus: d.tenant.status,
      subscriptionStatus: null,
      requireAdminMfa: false,
    };
  }

  @Post('pair')
  @HttpCode(200)
  @RateLimit({ key: 'totem-pair', limit: 10, windowSec: 600 })
  async pair(@Req() req: Request, @Res({ passthrough: true }) res: Response, @ZBody(totemPairSchema) body: z.infer<typeof totemPairSchema>) {
    this.assertSameOrigin(req);
    const d = await this.deps.prisma.totemDevice.findUnique({ where: { pairingCodeHash: sha256Hex(body.code) } });
    if (!d || d.status !== 'ACTIVE' || !d.pairingExpiresAt || d.pairingExpiresAt < new Date()) {
      throw Errors.validation('Código inválido ou expirado. Gere um novo código no painel, em Totens.');
    }
    const token = randomToken(32);
    await this.deps.prisma.totemDevice.update({
      where: { id: d.id },
      data: { tokenHash: sha256Hex(token), pairingCodeHash: null, pairingExpiresAt: null, pairedAt: new Date(), lastSeenAt: new Date() },
    });
    res.cookie(this.cookieName(), token, {
      httpOnly: true,
      secure: this.deps.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return { ok: true, name: d.name };
  }

  @Get('session')
  async session(@Req() req: Request) {
    const d = await this.device(req);
    return {
      totemName: d.name,
      storeName: d.pos.store.name,
      tradeName: d.tenant.tradeName,
      logoUrl: d.tenant.logoUrl,
      brandColor: d.tenant.brandColor,
      operational: d.tenant.status === 'ACTIVE' && d.pos.status === 'ACTIVE',
      loyalty:
        d.tenant.loyaltyMode === 'OFF'
          ? null
          : { mode: d.tenant.loyaltyMode, cashbackBps: d.tenant.loyaltyCashbackBps, giftEvery: d.tenant.loyaltyGiftEvery, giftName: d.tenant.loyaltyGiftName },
    };
  }

  @Get('catalog')
  async catalog(@Req() req: Request) {
    const d = await this.device(req);
    const rows = await this.deps.prisma.product.findMany({
      where: { tenantId: d.tenantId, active: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, priceCents: true, category: true, imageKey: true },
    });
    return rows.map(({ imageKey, ...p }) => ({ ...p, imageUrl: productImageUrl(imageKey) }));
  }

  /** Só informa se o WhatsApp já participa (nada sobre o cliente é exibido no totem). */
  @Post('loyalty/identify')
  @HttpCode(200)
  @RateLimit({ key: 'totem-loyalty', limit: 30, windowSec: 60 })
  async identify(@Req() req: Request) {
    this.assertSameOrigin(req);
    const d = await this.device(req);
    const phone = normalizeBrWhatsApp(String((req.body as { phone?: unknown })?.phone ?? ''));
    if (!phone) throw Errors.validation('Informe o WhatsApp com DDD');
    const c = await this.deps.prisma.loyaltyCustomer.findUnique({ where: { tenantId_phone: { tenantId: d.tenantId, phone } }, select: { id: true } });
    return { known: !!c };
  }

  @Post('orders')
  @HttpCode(201)
  @RateLimit({ key: 'totem-order', limit: 30, windowSec: 60 })
  async createOrder(@Req() req: Request, @ZBody(totemOrderSchema) body: z.infer<typeof totemOrderSchema>, @Meta() meta: RequestMeta) {
    this.assertSameOrigin(req);
    const d = await this.device(req);
    let loyalty: { customerId: string; rewardCode?: string } | undefined;
    if (body.loyalty) {
      if (d.tenant.loyaltyMode === 'OFF') throw Errors.validation('A fidelidade está desligada nesta loja');
      const phone = normalizeBrWhatsApp(body.loyalty.phone);
      if (!phone) throw Errors.validation('Informe o WhatsApp com DDD');
      let customer = await this.deps.prisma.loyaltyCustomer.findUnique({ where: { tenantId_phone: { tenantId: d.tenantId, phone } }, select: { id: true } });
      if (!customer) {
        if (!body.loyalty.name) throw new AppError(422, 'LOYALTY_NAME_REQUIRED', 'Informe seu nome para entrar na fidelidade');
        customer = await this.deps.prisma.loyaltyCustomer.create({
          data: { tenantId: d.tenantId, phone, name: body.loyalty.name, whatsappOptIn: body.loyalty.whatsappOptIn ?? false },
          select: { id: true },
        });
      }
      loyalty = { customerId: customer.id, ...(body.loyalty.rewardCode ? { rewardCode: body.loyalty.rewardCode } : {}) };
    }
    // O totem envia o total do carrinho (sem desconto); o cashback é descontado aqui antes de criar a cobrança.
    let amountCents = body.amountCents;
    if (loyalty?.rewardCode) {
      const reward = await this.deps.prisma.loyaltyReward.findFirst({
        where: { tenantId: d.tenantId, customerId: loyalty.customerId, code: loyalty.rewardCode, kind: 'CASHBACK', status: 'AVAILABLE' },
        select: { valueCents: true },
      });
      if (!reward?.valueCents) throw Errors.validation('Código de cashback inválido, já usado ou de outro WhatsApp');
      if (reward.valueCents >= body.amountCents) throw Errors.validation('O cashback vale mais que esta compra. Use o código numa compra maior.');
      amountCents = body.amountCents - reward.valueCents;
    }
    const created = await this.charges.create(
      this.authFor(d),
      { posId: d.posId, amountCents, items: body.items, ...(loyalty ? { loyalty } : {}) },
      undefined,
      meta,
      { totemId: d.id },
    );
    return this.view(d, created.id);
  }

  @Get('orders/:id')
  async getOrder(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.device(req);
    return this.view(d, id);
  }

  /** Cliente desistiu (ou o totem ficou parado): cancela no Mercado Pago para liberar o caixa. */
  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancelOrder(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    this.assertSameOrigin(req);
    const d = await this.device(req);
    const c = await this.deps.prisma.charge.findFirst({ where: { id, totemId: d.id }, select: { status: true, orderId: true } });
    if (!c) throw Errors.notFound('Pedido');
    if (['CREATING', 'PENDING', 'RECONCILING'].includes(c.status) && c.orderId) {
      await this.charges.cancel(this.authFor(d, 'ADMIN'), id, meta).catch((err) => {
        // Sem confirmação do cancelamento: a cobrança expira sozinha em até 3 minutos.
        this.deps.logger.warn({ chargeId: id, err: (err as Error).message }, 'cancelamento pelo totem não confirmado');
      });
    }
    return this.view(d, id);
  }

  /** Visão do pedido para a tela do totem: só dados seguros e o Pix enquanto a cobrança está ativa. */
  private async view(d: Device, chargeId: string) {
    const c = await this.deps.prisma.charge.findFirst({
      where: { id: chargeId, totemId: d.id },
      include: { pos: { select: { qrCode: true, activeChargeId: true } } },
    });
    if (!c) throw Errors.notFound('Pedido');
    const live = c.status === 'PENDING' && c.pos.activeChargeId === c.id && !!c.expiresAt && c.expiresAt > new Date();
    const brOk = !!c.pos.qrCode && validateBrCode(c.pos.qrCode).valid;
    return {
      id: c.id,
      status: c.status,
      amountCents: c.amountCents,
      discountCents: c.discountCents,
      orderNumber: c.orderNumber,
      expiresAt: c.expiresAt,
      paidAt: c.paidAt,
      serverTime: new Date().toISOString(),
      pixCopyPaste: live && brOk ? c.pos.qrCode : null,
    };
  }
}
