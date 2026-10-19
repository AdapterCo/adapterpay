import { Inject, Injectable } from '@nestjs/common';
import { assertCanActivate, writeAudit, type CoreDeps } from '@adapterpay/core';
import type { createUserSchema, updateUserSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { hashPassword } from '../auth/password';
import { Errors } from '../common/errors';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';

type CreateInput = z.infer<typeof createUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;

@Injectable()
export class UsersService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

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

  /**
   * Cria o usuário direto, com a senha inicial definida pelo administrador (sem convite por email).
   * Se o email já existir em outra empresa, apenas vincula — a senha atual dessa pessoa não muda.
   */
  async create(auth: AuthContext, input: CreateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    if (input.role !== 'ADMIN' && input.storeIds.length === 0) {
      throw Errors.validation('Atribua ao menos uma loja para vendedores e contadores');
    }
    await this.validateStores(tenantId, input.storeIds);
    const passwordHash = await hashPassword(input.password);
    const { userId, existingAccount } = await this.deps.prisma.$transaction(async (tx) => {
      await assertCanActivate(tx, tenantId, 'users');
      const found = await tx.user.findUnique({ where: { email: input.email } });
      if (found?.isSuperadmin) throw Errors.validation('Este email não pode ser usado');
      const user =
        found ??
        (await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
        }));
      const existing = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      if (existing && existing.status !== 'DISABLED') throw Errors.conflict('Usuário já faz parte da empresa');
      if (existing) {
        await tx.tenantMembership.update({ where: { id: existing.id }, data: { role: input.role, status: 'ACTIVE' } });
      } else {
        await tx.tenantMembership.create({ data: { tenantId, userId: user.id, role: input.role, status: 'ACTIVE' } });
      }
      await tx.storeMembership.deleteMany({ where: { tenantId, userId: user.id } });
      if (input.role !== 'ADMIN') {
        await tx.storeMembership.createMany({ data: input.storeIds.map((storeId) => ({ tenantId, storeId, userId: user.id })) });
      }
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'user',
        resourceId: user.id,
        action: 'user.created',
        after: { email: input.email, role: input.role, storeIds: input.storeIds, existingAccount: !!found },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return { userId: user.id, existingAccount: !!found };
    });
    return { userId, status: 'ACTIVE', existingAccount };
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
        data: { role, ...(input.status ? { status: input.status } : {}) },
      });
      if (input.password) {
        // Só redefine a senha de quem pertence exclusivamente a esta empresa (não afeta contas de outros tenants).
        const otherTenants = await tx.tenantMembership.count({ where: { userId, tenantId: { not: tenantId } } });
        if (otherTenants > 0) throw Errors.forbidden('Este usuário também acessa outra empresa; ele mesmo deve trocar a senha');
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash: await hashPassword(input.password), failedLogins: 0, lockedUntil: null, status: 'ACTIVE' },
        });
        await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
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
        after: { role: updated.role, status: updated.status, storeIds: input.storeIds, passwordReset: !!input.password },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return { userId, role: updated.role, status: updated.status };
    });
  }
}
