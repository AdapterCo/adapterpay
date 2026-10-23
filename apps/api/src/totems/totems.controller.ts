import { randomInt } from 'node:crypto';
import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingService, randomToken, sha256Hex, writeAudit, type CoreDeps } from '@adapterpay/core';
import { isPgUniqueViolation } from '@adapterpay/database';
import { totemCreateSchema } from '@adapterpay/shared';
import { z } from 'zod';
import { Critical, RequirePermission } from '../auth/decorators';
import { Errors } from '../common/errors';
import { CurrentAuth, Meta, requireTenant, type AuthContext, type RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { ApiZodBody, ZBody } from '../common/zod';

const PAIRING_TTL_MS = 30 * 60 * 1000;
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const renameSchema = z.object({ name: z.string().trim().min(2).max(60) });

export function newPairingCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++) c += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return c;
}

/** Totens de autoatendimento (painel do administrador). Cada totem ativo é um adicional mensal. */
@ApiTags('totems')
@Controller('totems')
export class TotemsController {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly billing: BillingService,
  ) {}

  @Get()
  @RequirePermission('totems:manage')
  async list(@CurrentAuth() auth: AuthContext) {
    const tenantId = requireTenant(auth);
    const [totems, sub] = await Promise.all([
      this.deps.prisma.totemDevice.findMany({
        where: { tenantId, status: 'ACTIVE' },
        include: { pos: { select: { name: true, store: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.deps.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: { select: { name: true, totemPriceCents: true } } } }),
    ]);
    return {
      totemPriceCents: sub?.plan.totemPriceCents ?? null,
      planName: sub?.plan.name ?? null,
      totemQuantity: sub?.totemQuantity ?? 0,
      items: totems.map((t) => ({
        id: t.id,
        name: t.name,
        posId: t.posId,
        posName: t.pos.name,
        storeName: t.pos.store.name,
        paired: !!t.tokenHash,
        pairingPending: !!t.pairingCodeHash && !!t.pairingExpiresAt && t.pairingExpiresAt > new Date(),
        pairedAt: t.pairedAt,
        lastSeenAt: t.lastSeenAt,
      })),
    };
  }

  @Post()
  @HttpCode(201)
  @Critical()
  @RequirePermission('totems:manage')
  @ApiZodBody(totemCreateSchema)
  async create(@CurrentAuth() auth: AuthContext, @ZBody(totemCreateSchema) body: z.infer<typeof totemCreateSchema>, @Meta() meta: RequestMeta) {
    const tenantId = requireTenant(auth);
    const sub = await this.deps.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub || sub.status !== 'ACTIVE') throw Errors.validation('Ative a assinatura para usar totens');
    if (sub.plan.totemPriceCents === null) throw Errors.validation('Seu plano não inclui totens. Fale com a Adapter Co. ou mude de plano.');
    const pos = await this.deps.prisma.posTerminal.findFirst({ where: { id: body.posId, tenantId }, select: { id: true, storeId: true, status: true } });
    if (!pos) throw Errors.notFound('POS');
    if (pos.status !== 'ACTIVE') throw Errors.validation('Ative o POS antes de ligá-lo a um totem');

    const code = newPairingCode();
    let totem;
    try {
      totem = await this.deps.prisma.$transaction(async (tx) => {
        // Usuário de serviço: aparece como "vendedor" nas vendas do totem e nunca faz login.
        const user = await tx.user.create({
          data: {
            email: `totem-${randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, '')}@totem.adapterpay.invalid`,
            name: body.name,
            passwordHash: null,
            status: 'DISABLED',
          },
        });
        return tx.totemDevice.create({
          data: {
            tenantId,
            storeId: pos.storeId,
            posId: pos.id,
            userId: user.id,
            name: body.name,
            pairingCodeHash: sha256Hex(code),
            pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
          },
        });
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) throw Errors.conflict('Este POS já está ligado a outro totem. Crie um POS para cada totem.');
      throw err;
    }
    await this.syncQuantity(tenantId);
    await this.audit(auth, meta, totem.id, 'totem.created', { name: body.name, posId: body.posId });
    return { id: totem.id, pairingCode: code, pairingExpiresAt: totem.pairingExpiresAt };
  }

  /** Novo código de pareamento (troca de tablet). O token atual continua até um novo pareamento. */
  @Post(':id/pairing-code')
  @RequirePermission('totems:manage')
  async newCode(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const t = await this.find(auth, id);
    const code = newPairingCode();
    const updated = await this.deps.prisma.totemDevice.update({
      where: { id: t.id },
      data: { pairingCodeHash: sha256Hex(code), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS) },
    });
    await this.audit(auth, meta, t.id, 'totem.pairing_code_created');
    return { pairingCode: code, pairingExpiresAt: updated.pairingExpiresAt };
  }

  @Patch(':id')
  @RequirePermission('totems:manage')
  async rename(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(renameSchema) body: z.infer<typeof renameSchema>) {
    const t = await this.find(auth, id);
    await this.deps.prisma.$transaction([
      this.deps.prisma.totemDevice.update({ where: { id: t.id }, data: { name: body.name } }),
      this.deps.prisma.user.update({ where: { id: t.userId }, data: { name: body.name } }),
    ]);
    return { ok: true };
  }

  /** Revoga: o tablet perde o acesso na hora e o totem sai da mensalidade na próxima renovação. */
  @Delete(':id')
  @HttpCode(204)
  @Critical()
  @RequirePermission('totems:manage')
  async revoke(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    const t = await this.find(auth, id);
    await this.deps.prisma.totemDevice.update({
      where: { id: t.id },
      data: { status: 'REVOKED', tokenHash: null, pairingCodeHash: null, pairingExpiresAt: null },
    });
    await this.syncQuantity(t.tenantId);
    await this.audit(auth, meta, t.id, 'totem.revoked');
  }

  private async syncQuantity(tenantId: string): Promise<void> {
    const active = await this.deps.prisma.totemDevice.count({ where: { tenantId, status: 'ACTIVE' } });
    await this.billing.setTotemQuantity(tenantId, active);
  }

  private async find(auth: AuthContext, id: string) {
    const t = await this.deps.prisma.totemDevice.findFirst({ where: { id, tenantId: requireTenant(auth), status: 'ACTIVE' } });
    if (!t) throw Errors.notFound('Totem');
    return t;
  }

  private audit(auth: AuthContext, meta: RequestMeta, id: string, action: string, after?: object) {
    return writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'totem',
      resourceId: id,
      action,
      after,
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }
}
