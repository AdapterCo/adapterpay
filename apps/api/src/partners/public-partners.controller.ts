import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { isWhatsAppConfigured, randomToken, sendWhatsAppText, sha256Hex, uniqueReferralCode, type CoreDeps } from '@adapterpay/core';
import { isUniqueViolation } from '@adapterpay/database';
import {
  ERROR_CODES,
  formatBRL,
  maskBusinessName,
  maskPixKey,
  partnerSignupSchema,
  REFERRAL_BONUS_CENTS,
  REFERRAL_WELCOME_CENTS,
  referralLink,
} from '@adapterpay/shared';
import type { z } from 'zod';
import { Public, SkipCsrf } from '../auth/decorators';
import { AppError, Errors } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

/** Token do painel: randomToken(32) em base64url (43 caracteres). */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/**
 * Parceiros de indicação sem conta: cadastro (nome, WhatsApp e chave Pix) e painel de acompanhamento
 * por link secreto. Só o hash do token fica no banco; a chave Pix é criptografada.
 */
@ApiTags('public')
@Public()
@SkipCsrf()
@Controller('public/partners')
export class PublicPartnersController {
  private readonly appOrigin: string;

  constructor(@Inject(CORE) private readonly deps: CoreDeps) {
    this.appOrigin = new URL(deps.config.APP_URL).origin;
  }

  /** Proteção equivalente ao CSRF: mesma origem + cabeçalho próprio. */
  private assertSameOrigin(req: Request): void {
    const origin = req.headers.origin;
    if ((typeof origin === 'string' && origin !== this.appOrigin) || req.headers['x-adapterpay-partner'] !== '1') {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Origem não permitida');
    }
  }

  private panelUrl(token: string): string {
    return `${this.deps.config.APP_URL.replace(/\/$/, '')}/indique/painel/${token}`;
  }

  /** Manda o link de divulgação e o do painel para o WhatsApp do parceiro (instância da plataforma). */
  private async sendAccess(name: string, phone: string, code: string, token: string): Promise<boolean> {
    if (!isWhatsAppConfigured(this.deps.config)) return false;
    const text = [
      `Olá, ${name.split(' ')[0]}! Aqui está o seu link de indicação do AdapterPay:`,
      referralLink(this.deps.config.APP_URL, code),
      '',
      `Cada lojista que se cadastrar por ele ganha ${formatBRL(REFERRAL_WELCOME_CENTS)} de desconto, e você recebe ${formatBRL(REFERRAL_BONUS_CENTS)} por Pix quando ele pagar a primeira mensalidade.`,
      '',
      'Acompanhe quantos se cadastraram e quanto você tem a receber (não compartilhe este link):',
      this.panelUrl(token),
    ].join('\n');
    try {
      await sendWhatsAppText(this.deps.config, phone, text);
      return true;
    } catch (err) {
      this.deps.logger.warn({ err: (err as Error).message }, 'link do parceiro não enviado por WhatsApp');
      return false;
    }
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ key: 'partner-signup', limit: 5, windowSec: 3600, by: 'ip' })
  @ApiZodBody(partnerSignupSchema)
  async signup(@Req() req: Request, @ZBody(partnerSignupSchema) body: z.infer<typeof partnerSignupSchema>) {
    this.assertSameOrigin(req);
    const token = randomToken(32);
    const existing = await this.deps.prisma.referralPartner.findUnique({ where: { phone: body.phone } });
    if (existing) return this.resendAccess(existing, token);

    let partner;
    try {
      partner = await this.deps.prisma.$transaction(async (tx) =>
        tx.referralPartner.create({
          data: {
            name: body.name,
            phone: body.phone,
            pixKeyType: body.pixKeyType,
            pixKeyEnc: this.deps.encryptor.encrypt(body.pixKey),
            code: await uniqueReferralCode(tx),
            accessTokenHash: sha256Hex(token),
          },
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err, 'phone')) {
        const again = await this.deps.prisma.referralPartner.findUniqueOrThrow({ where: { phone: body.phone } });
        return this.resendAccess(again, token);
      }
      throw err;
    }
    const whatsappSent = await this.sendAccess(partner.name, partner.phone, partner.code, token);
    return {
      status: 'CREATED' as const,
      code: partner.code,
      link: referralLink(this.deps.config.APP_URL, partner.code),
      panelUrl: this.panelUrl(token),
      whatsappSent,
    };
  }

  /**
   * WhatsApp já cadastrado: quem sabe só o número não vê o painel. Um link novo vai para o próprio
   * WhatsApp do parceiro, e só depois do envio o link anterior deixa de valer.
   */
  private async resendAccess(partner: { id: string; name: string; phone: string; code: string }, token: string) {
    const sent = await this.sendAccess(partner.name, partner.phone, partner.code, token);
    if (sent) await this.deps.prisma.referralPartner.update({ where: { id: partner.id }, data: { accessTokenHash: sha256Hex(token) } });
    return { status: 'EXISTS' as const, whatsappSent: sent };
  }

  /** Painel do parceiro: quantos se cadastraram, quantos pagaram, quanto há a receber e o que já foi pago. */
  @Get(':token')
  @RateLimit({ key: 'partner-panel', limit: 60, windowSec: 60, by: 'ip' })
  async panel(@Param('token') token: string) {
    if (!TOKEN_RE.test(token)) throw Errors.notFound('Painel');
    const p = await this.deps.prisma.referralPartner.findUnique({
      where: { accessTokenHash: sha256Hex(token) },
      include: {
        referrals: { include: { tenant: { select: { tradeName: true } } }, orderBy: { createdAt: 'desc' }, take: 500 },
        payouts: { orderBy: { paidAt: 'desc' }, take: 100 },
      },
    });
    if (!p) throw Errors.notFound('Painel');
    const earned = p.referrals.filter((r) => r.status === 'EARNED');
    const paidOut = p.referrals.filter((r) => r.status === 'PAID_OUT');
    return {
      name: p.name,
      status: p.status,
      code: p.code,
      link: referralLink(this.deps.config.APP_URL, p.code),
      pixKeyType: p.pixKeyType,
      pixKeyMasked: maskPixKey(this.deps.encryptor.decrypt(p.pixKeyEnc)),
      bonusCents: REFERRAL_BONUS_CENTS,
      welcomeCents: REFERRAL_WELCOME_CENTS,
      totals: {
        registered: p.referrals.length,
        paying: earned.length + paidOut.length,
        waiting: p.referrals.length - earned.length - paidOut.length,
        toReceiveCents: earned.reduce((s, r) => s + r.amountCents, 0),
        receivedCents: p.payouts.reduce((s, x) => s + x.amountCents, 0),
      },
      referrals: p.referrals.map((r) => ({
        business: maskBusinessName(r.tenant.tradeName),
        createdAt: r.createdAt,
        status: r.status,
        amountCents: r.amountCents,
        earnedAt: r.earnedAt,
      })),
      payouts: p.payouts.map((x) => ({ amountCents: x.amountCents, count: x.count, paidAt: x.paidAt })),
    };
  }
}
