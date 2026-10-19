import { Inject, Injectable } from '@nestjs/common';
import { assertCanActivate, randomToken, sha256Hex, writeAudit, type CoreDeps } from '@adapterpay/core';
import type { inviteUserSchema, updateUserSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/errors';
import { MailerService } from '../common/mailer.service';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';

type InviteInput = z.infer<typeof inviteUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

@Injectable()
export class UsersService {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly mailer: MailerService,
    private readonly sessions: SessionService,
  ) {}

  async list(auth: AuthContext) {
    const tenantId = auth.tenantId!;
    const memberships = await this.deps.prisma.tenantMembership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, email: true, name: true, status: true, mfaEnabledAt: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const storeLinks = await this.deps.prisma.storeMembership.findMany({ where: { tenantId }, select: { userId: true, storeId: true } });
    const byUser = new Map<string, string[]>();
    storeLinks.forEach((s) => byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s.storeId]));
    return memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      isOwner: m.isOwner,
      mfaEnabled: !!m.user.mfaEnabledAt,
      lastLoginAt: m.user.lastLoginAt,
      storeIds: m.role === 'ADMIN' ? 'ALL' : (byUser.get(m.userId) ?? []),
    }));
  }

  private async validateStores(tenantId: string, storeIds: string[]): Promise<void> {
    if (storeIds.length === 0) return;
    const n = await this.deps.prisma.store.count({ where: { tenantId, id: { in: storeIds } } });
    if (n !== new Set(storeIds).size) throw Errors.validation('Loja inválida');
  }

  async invite(auth: AuthContext, input: InviteInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    if (input.role !== 'ADMIN' && input.storeIds.length === 0) {
      throw Errors.validation('Atribua ao menos uma loja para vendedores e contadores');
    }
    await this.validateStores(tenantId, input.storeIds);
    const token = randomToken(32);
    const { userId } = await this.deps.prisma.$transaction(async (tx) => {
      await assertCanActivate(tx, tenantId, 'users');
      const user =
        (await tx.user.findUnique({ where: { email: input.email } })) ??
        (await tx.user.create({ data: { email: input.email, name: input.name, status: 'PENDING_VERIFICATION' } }));
      if (user.isSuperadmin) throw Errors.validation('Este email não pode ser convidado');
      const existing = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      if (existing && existing.status !== 'DISABLED') throw Errors.conflict('Usuário já faz parte da empresa');
      if (existing) {
        await tx.tenantMembership.update({ where: { id: existing.id }, data: { role: input.role, status: 'INVITED' } });
      } else {
        await tx.tenantMembership.create({ data: { tenantId, userId: user.id, role: input.role, status: 'INVITED' } });
      }
      await tx.storeMembership.deleteMany({ where: { tenantId, userId: user.id } });
      if (input.role !== 'ADMIN') {
        await tx.storeMembership.createMany({ data: input.storeIds.map((storeId) => ({ tenantId, storeId, userId: user.id })) });
      }
      await tx.emailToken.create({
        data: { userId: user.id, tenantId, purpose: 'INVITE', tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'user',
        resourceId: user.id,
        action: 'user.invited',
        after: { email: input.email, role: input.role, storeIds: input.storeIds },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return { userId: user.id };
    });
    const tenant = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tradeName: true } });
    await this.mailer.send(
      input.email,
      `Convite para ${tenant.tradeName}`,
      `Você foi convidado para acessar ${tenant.tradeName} no AdapterPay.\n\nAceite o convite:\n${new URL(`/convite?token=${token}`, this.deps.config.APP_URL).toString()}\n\nO convite expira em 7 dias.`,
    );
    return { userId, status: 'INVITED' };
  }

  async acceptInvite(params: { token: string; name?: string; password?: string }, meta: RequestMeta) {
    const row = await this.deps.prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(params.token) } });
    if (!row || row.purpose !== 'INVITE' || row.consumedAt || row.expiresAt.getTime() < Date.now() || !row.tenantId) {
      throw Errors.validation('Convite inválido ou expirado');
    }
    const user = await this.deps.prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    const needsPassword = !user.passwordHash;
    if (needsPassword && (!params.password || !params.name)) throw Errors.validation('Informe nome e senha para criar seu acesso');
    const passwordHash = needsPassword ? await hashPassword(params.password!) : undefined;
    await this.deps.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw Errors.validation('Convite já utilizado');
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(needsPassword ? { passwordHash, name: params.name } : {}),
          status: user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await tx.tenantMembership.updateMany({
        where: { tenantId: row.tenantId!, userId: user.id, status: 'INVITED' },
        data: { status: 'ACTIVE' },
      });
      await writeAudit(tx, {
        tenantId: row.tenantId,
        actorUserId: user.id,
        actorType: 'USER',
        resourceType: 'user',
        resourceId: user.id,
        action: 'user.invite_accepted',
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
    });
    return { ok: true, email: user.email };
  }

  async update(auth: AuthContext, userId: string, input: UpdateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    return this.deps.prisma.$transaction(async (tx) => {
      const m = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (!m) throw Errors.notFound('Usuário');
      if (m.isOwner && (input.role !== undefined && input.role !== 'ADMIN' || input.status === 'DISABLED')) {
        throw Errors.forbidden('O proprietário não pode ser rebaixado ou desativado');
      }
      if (userId === auth.userId && (input.status === 'DISABLED' || (input.role && input.role !== 'ADMIN'))) {
        throw Errors.forbidden('Você não pode alterar o próprio acesso administrativo');
      }
      if (input.status === 'ACTIVE' && m.status === 'DISABLED') await assertCanActivate(tx, tenantId, 'users');
      const role = input.role ?? m.role;
      if (input.storeIds) {
        await this.validateStores(tenantId, input.storeIds);
        await tx.storeMembership.deleteMany({ where: { tenantId, userId } });
        if (role !== 'ADMIN') await tx.storeMembership.createMany({ data: input.storeIds.map((storeId) => ({ tenantId, storeId, userId })) });
      }
      const updated = await tx.tenantMembership.update({
        where: { id: m.id },
        data: { role, ...(input.status ? { status: input.status === 'ACTIVE' && m.status === 'INVITED' ? 'INVITED' : input.status } : {}) },
      });
      if (input.status === 'DISABLED') {
        // Desativa sem apagar histórico; encerra sessões apontando para esta empresa.
        await tx.session.updateMany({ where: { userId, activeTenantId: tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'user',
        resourceId: userId,
        action: 'user.updated',
        before: { role: m.role, status: m.status },
        after: { role: updated.role, status: updated.status, storeIds: input.storeIds },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return { userId, role: updated.role, status: updated.status };
    });
  }
}
