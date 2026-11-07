import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { refreshPaymentLinkIfStale, type CoreDeps } from '@adapterpay/core';
import { firstName, type PaymentLinkStatus, type PublicPaymentLinkView } from '@adapterpay/shared';
import { Public } from '../auth/decorators';
import { Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CORE } from '../common/tokens';

/** Página pública do link (/l/:token): só dados seguros; o Pix aparece apenas enquanto está em aberto. */
@ApiTags('public')
@Public()
@Controller('public/payment-links')
export class PublicPaymentLinksController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get(':token')
  @RateLimit({ key: 'pub-payment-link', limit: 120, windowSec: 60 })
  async view(@Param('token') token: string, @Res({ passthrough: true }) res: Response): Promise<PublicPaymentLinkView> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw Errors.notFound('Link');
    let link = await this.deps.prisma.paymentLink.findUnique({ where: { publicToken: token } });
    if (!link) throw Errors.notFound('Link');
    // Cliente com a página aberta: consulta o MP (no máximo a cada 5 s) para confirmar o pagamento rápido.
    link = await refreshPaymentLinkIfStale(this.deps, link).catch(() => link!);
    const [store, tenant] = await Promise.all([
      this.deps.prisma.store.findUniqueOrThrow({ where: { id: link.storeId }, select: { name: true } }),
      this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: link.tenantId }, select: { tradeName: true, logoUrl: true } }),
    ]);
    const pending = link.status === 'PENDING' && link.expiresAt.getTime() > Date.now();
    return {
      storeName: store.name,
      tradeName: tenant.tradeName,
      logoUrl: tenant.logoUrl,
      customerFirstName: firstName(link.customerName),
      description: link.description,
      amountCents: link.amountCents,
      state: link.status as PaymentLinkStatus,
      expiresAt: link.expiresAt.toISOString(),
      serverTime: new Date().toISOString(),
      pixCopyPaste: pending ? link.pixCopyPaste : null,
      paidAt: link.paidAt?.toISOString() ?? null,
    };
  }
}
