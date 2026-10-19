import { Inject, Injectable } from '@nestjs/common';
import { randomToken, sha256Hex, type CoreDeps } from '@adapterpay/core';
import type { Session, User } from '@adapterpay/database';
import type { TenantRole } from '@adapterpay/shared';
import { CORE } from '../common/tokens';
import type { AuthContext, RequestMeta } from '../common/request';
import { SESSION_IDLE_MS, SESSION_TTL_MS } from './cookies';

const MFA_STEP_UP_MS = 12 * 3600 * 1000;

@Injectable()
export class SessionService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  async create(user: User, meta: RequestMeta, mfaVerified: boolean): Promise<{ token: string; session: Session }> {
    const token = randomToken(32);
    const membership = await this.deps.prisma.tenantMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
    });
    const session = await this.deps.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        activeTenantId: membership?.tenantId ?? null,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { token, session };
  }

  async findValid(token: string): Promise<(Session & { user: User }) | null> {
    if (!token || token.length > 200) return null;
    const session = await this.deps.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (now - session.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
    if (session.user.status !== 'ACTIVE') return null;
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.deps.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.deps.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.deps.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Resolve tenant/papel/lojas a partir da sessão — nunca de IDs enviados pelo cliente. */
  async buildContext(session: Session & { user: User }): Promise<AuthContext> {
    const user = session.user;
    const memberships = await this.deps.prisma.tenantMembership.findMany({
      where: { userId: user.id, status: 'ACTIVE', tenant: { deletedAt: null } },
      include: { tenant: { include: { subscription: { select: { status: true } } } } },
    });
    const active = memberships.find((m) => m.tenantId === session.activeTenantId) ?? memberships[0] ?? null;
    if (active && active.tenantId !== session.activeTenantId) {
      await this.deps.prisma.session.update({ where: { id: session.id }, data: { activeTenantId: active.tenantId } });
    }
    let storeIds: AuthContext['storeIds'] = 'ALL';
    if (active && active.role !== 'ADMIN') {
      const sm = await this.deps.prisma.storeMembership.findMany({
        where: { tenantId: active.tenantId, userId: user.id },
        select: { storeId: true },
      });
      storeIds = sm.map((s) => s.storeId);
    }
    const mfaVerified = !!session.mfaVerifiedAt && Date.now() - session.mfaVerifiedAt.getTime() < MFA_STEP_UP_MS;
    return {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      isSuperadmin: user.isSuperadmin,
      mfaEnabled: !!user.mfaEnabledAt,
      mfaVerified,
      tenantId: active?.tenantId ?? null,
      role: (active?.role as TenantRole | undefined) ?? null,
      isOwner: active?.isOwner ?? false,
      storeIds,
      tenantStatus: active?.tenant.status ?? null,
      subscriptionStatus: active?.tenant.subscription?.status ?? null,
      requireAdminMfa: active?.tenant.requireAdminMfa ?? false,
    };
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.deps.prisma.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
  }
}
