import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { availableCreditCents, uniqueReferralCode, type CoreDeps } from '@adapterpay/core';
import { REFERRAL_BONUS_CENTS, REFERRAL_WELCOME_CENTS, referralLink } from '@adapterpay/shared';
import { RequirePermission } from '../auth/decorators';
import { CurrentAuth, requireTenant, type AuthContext } from '../common/request';
import { CORE } from '../common/tokens';

/** Link de indicação do lojista, saldo de créditos e quem ele já indicou. */
@ApiTags('subscriptions')
@Controller('referrals')
export class ReferralsController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  @RequirePermission('subscription:read')
  async overview(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    let tenant = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { referralCode: true, billingCreditCents: true } });
    if (!tenant.referralCode) {
      // Contas antigas sem código: gera na primeira visita (a migração já cobre as existentes).
      tenant = await this.deps.prisma.$transaction(async (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: { referralCode: await uniqueReferralCode(tx) }, select: { referralCode: true, billingCreditCents: true } }),
      );
    }
    const [referred, credits, available] = await Promise.all([
      this.deps.prisma.tenant.findMany({
        where: { referredByTenantId: tenantId },
        select: { id: true, tradeName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.deps.prisma.billingCredit.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.deps.prisma.$transaction((tx) => availableCreditCents(tx, tenantId)),
    ]);
    const rewarded = new Set(credits.filter((c) => c.kind === 'REFERRAL_BONUS').map((c) => c.referredTenantId));
    return {
      code: tenant.referralCode,
      link: referralLink(this.deps.config.APP_URL, tenant.referralCode!),
      bonusCents: REFERRAL_BONUS_CENTS,
      welcomeCents: REFERRAL_WELCOME_CENTS,
      creditCents: tenant.billingCreditCents,
      availableCents: available,
      earnedCents: credits.filter((c) => c.kind === 'REFERRAL_BONUS').reduce((s, c) => s + c.amountCents, 0),
      referrals: referred.map((r) => ({ tradeName: r.tradeName, createdAt: r.createdAt, rewarded: rewarded.has(r.id) })),
      history: credits.map((c) => ({ kind: c.kind, amountCents: c.amountCents, createdAt: c.createdAt })),
    };
  }
}
