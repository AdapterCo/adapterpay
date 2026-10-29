import { Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { isWhatsAppConfigured, sendWhatsAppText, writeAudit, type CoreDeps } from '@adapterpay/core';
import { formatBRL, referralLink } from '@adapterpay/shared';
import { z } from 'zod';
import { NoTenant, Superadmin } from '../auth/decorators';
import { Errors } from '../common/errors';
import { CurrentAuth, Meta, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ZBody } from '../common/zod';

const payoutSchema = z.object({ note: z.string().trim().max(200).optional() });
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) });

/** Parceiros de indicação (superadmin): quanto cada um tem a receber, chave Pix e registro do pagamento. */
@ApiTags('admin')
@NoTenant()
@Superadmin()
@Controller('admin/partners')
export class AdminPartnersController {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  @Get()
  async list() {
    const [partners, groups] = await Promise.all([
      this.deps.prisma.referralPartner.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
      this.deps.prisma.partnerReferral.groupBy({ by: ['partnerId', 'status'], _count: { _all: true }, _sum: { amountCents: true } }),
    ]);
    const stat = (id: string, status: string) => groups.find((g) => g.partnerId === id && g.status === status);
    return partners.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      pixKeyType: p.pixKeyType,
      // Chave inteira só aqui: é com ela que a equipe faz o Pix ao parceiro.
      pixKey: this.deps.encryptor.decrypt(p.pixKeyEnc),
      code: p.code,
      link: referralLink(this.deps.config.APP_URL, p.code),
      status: p.status,
      createdAt: p.createdAt,
      registered: (['REGISTERED', 'EARNED', 'PAID_OUT'] as const).reduce((s, st) => s + (stat(p.id, st)?._count._all ?? 0), 0),
      paying: (stat(p.id, 'EARNED')?._count._all ?? 0) + (stat(p.id, 'PAID_OUT')?._count._all ?? 0),
      toReceiveCents: stat(p.id, 'EARNED')?._sum.amountCents ?? 0,
      receivedCents: stat(p.id, 'PAID_OUT')?._sum.amountCents ?? 0,
    }));
  }

  /** Registra o Pix feito ao parceiro: quita todas as indicações "a receber" de uma vez. */
  @Post(':id/payout')
  async payout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(payoutSchema) body: z.infer<typeof payoutSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const result = await this.deps.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM referral_partners WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked.length) throw Errors.notFound('Parceiro');
      const due = await tx.partnerReferral.findMany({ where: { partnerId: id, status: 'EARNED' }, select: { id: true, amountCents: true } });
      if (!due.length) throw Errors.validation('Este parceiro não tem valores a receber.');
      const amountCents = due.reduce((s, r) => s + r.amountCents, 0);
      const payout = await tx.partnerPayout.create({ data: { partnerId: id, amountCents, count: due.length, note: body.note || null, actorUserId: auth.userId } });
      await tx.partnerReferral.updateMany({ where: { id: { in: due.map((r) => r.id) }, status: 'EARNED' }, data: { status: 'PAID_OUT', payoutId: payout.id } });
      await writeAudit(tx, {
        actorUserId: auth.userId,
        actorType: 'SUPERADMIN',
        resourceType: 'referral_partner',
        resourceId: id,
        action: 'admin.partner_payout',
        after: { payoutId: payout.id, amountCents, count: due.length },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return { payout, amountCents, count: due.length };
    });
    // Aviso ao parceiro (melhor esforço): ele confere o valor no painel.
    const p = await this.deps.prisma.referralPartner.findUniqueOrThrow({ where: { id } });
    if (isWhatsAppConfigured(this.deps.config)) {
      await sendWhatsAppText(
        this.deps.config,
        p.phone,
        `Olá, ${p.name.split(' ')[0]}! A Adapter Co. registrou o Pix de ${formatBRL(result.amountCents)} referente a ${result.count} ${result.count === 1 ? 'indicação' : 'indicações'} do AdapterPay. Confira no seu painel de indicações.`,
      ).catch((err) => this.deps.logger.warn({ err: (err as Error).message }, 'aviso de pagamento ao parceiro não enviado'));
    }
    return { amountCents: result.amountCents, count: result.count, paidAt: result.payout.paidAt };
  }

  /** Bloqueado: o código deixa de valer para novos cadastros (indicações já feitas continuam no painel). */
  @Post(':id/status')
  async setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(statusSchema) body: z.infer<typeof statusSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const p = await this.deps.prisma.referralPartner.findUnique({ where: { id } });
    if (!p) throw Errors.notFound('Parceiro');
    await this.deps.prisma.referralPartner.update({ where: { id }, data: { status: body.status } });
    await writeAudit(this.deps.prisma, {
      actorUserId: auth.userId,
      actorType: 'SUPERADMIN',
      resourceType: 'referral_partner',
      resourceId: id,
      action: 'admin.partner_status',
      before: { status: p.status },
      after: { status: body.status },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { ok: true };
  }
}
