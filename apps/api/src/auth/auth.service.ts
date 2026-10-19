import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hmacSha256Hex,
  otpauthUrl,
  randomToken,
  sha256Hex,
  verifyTotp,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import { isUniqueViolation, type EmailTokenPurpose, type User } from '@adapterpay/database';
import { ERROR_CODES, permissionsForRole, type LoginInput, type RegisterInput } from '@adapterpay/shared';
import { AppError, Errors } from '../common/errors';
import { MailerService } from '../common/mailer.service';
import { RateLimitService } from '../common/rate-limit';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';
import { hashPassword, verifyPassword } from './password';
import { SessionService } from './session.service';

const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly sessions: SessionService,
    private readonly mailer: MailerService,
    private readonly limiter: RateLimitService,
  ) {}

  private link(path: string): string {
    return new URL(path, this.deps.config.APP_URL).toString();
  }

  private async issueEmailToken(userId: string, purpose: EmailTokenPurpose, ttlMs: number, tenantId?: string): Promise<string> {
    const token = randomToken(32);
    await this.deps.prisma.emailToken.create({
      data: { userId, purpose, tenantId: tenantId ?? null, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
    const row = await this.deps.prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw Errors.validation('Link inválido ou expirado');
    }
    const consumed = await this.deps.prisma.emailToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw Errors.validation('Link já utilizado');
    return row;
  }

  // ------------------------------------------------------------------ cadastro

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ email: string }> {
    await this.limiter.enforce(`register:${meta.ip}`, 5, 3600);
    const plan = await this.deps.prisma.plan.findFirst({ where: { id: input.planId, active: true } });
    if (!plan) throw Errors.validation('Plano indisponível');
    const existing = await this.deps.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw Errors.conflict('Este email já possui cadastro. Faça login ou recupere a senha.');

    const passwordHash = await hashPassword(input.password);
    let user: User;
    try {
      user = await this.deps.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            legalName: input.legalName,
            tradeName: input.tradeName,
            taxIdEnc: this.deps.encryptor.encrypt(input.taxId),
            taxIdHash: hmacSha256Hex(this.deps.config.SESSION_SECRET, input.taxId),
            status: 'PENDING_ACTIVATION',
          },
        });
        const u = await tx.user.create({
          data: { email: input.email, name: input.adminName, passwordHash, status: 'PENDING_VERIFICATION' },
        });
        await tx.tenantMembership.create({
          data: { tenantId: tenant.id, userId: u.id, role: 'ADMIN', status: 'ACTIVE', isOwner: true },
        });
        // Assinatura pendente: sem uso operacional até pagamento e ativação (sem teste grátis).
        await tx.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'PENDING' } });
        await writeAudit(tx, {
          tenantId: tenant.id,
          actorUserId: u.id,
          actorType: 'USER',
          resourceType: 'tenant',
          resourceId: tenant.id,
          action: 'tenant.registered',
          after: { tradeName: tenant.tradeName, planId: plan.id },
          ip: meta.ip,
          userAgent: meta.userAgent,
          correlationId: meta.correlationId,
        });
        return u;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'email')) throw Errors.conflict('Este email já possui cadastro.');
      throw err;
    }

    const token = await this.issueEmailToken(user.id, 'VERIFY_EMAIL', 48 * 3600 * 1000);
    await this.mailer.send(
      user.email,
      'Confirme seu email',
      `Olá, ${user.name}!\n\nConfirme seu email para continuar a contratação do AdapterPay:\n${this.link(`/verificar-email?token=${token}`)}\n\nO link expira em 48 horas.`,
    );
    return { email: user.email };
  }

  async verifyEmail(token: string): Promise<void> {
    const row = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.deps.prisma.user.updateMany({
      where: { id: row.userId, status: 'PENDING_VERIFICATION' },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
  }

  async resendVerification(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(`resend:${meta.ip}`, 5, 3600);
    await this.limiter.enforce(`resend-email:${sha256Hex(email)}`, 3, 3600);
    const user = await this.deps.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'PENDING_VERIFICATION') return; // resposta idêntica: sem enumeração
    const token = await this.issueEmailToken(user.id, 'VERIFY_EMAIL', 48 * 3600 * 1000);
    await this.mailer.send(user.email, 'Confirme seu email', `Confirme seu email:\n${this.link(`/verificar-email?token=${token}`)}`);
  }

  // ------------------------------------------------------------------ login

  async login(input: LoginInput, meta: RequestMeta): Promise<{ token: string; user: User }> {
    await this.limiter.enforce(`login-ip:${meta.ip}`, 30, 900);
    await this.limiter.enforce(`login-email:${sha256Hex(input.email)}`, 10, 900);

    const user = await this.deps.prisma.user.findUnique({ where: { email: input.email } });
    const invalid = new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Email ou senha inválidos');
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Conta temporariamente bloqueada por tentativas inválidas. Tente mais tarde.');
    }
    const ok = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLogins + 1;
        await this.deps.prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null },
        });
      }
      throw invalid;
    }
    if (user.status === 'PENDING_VERIFICATION') {
      throw new AppError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Confirme seu email antes de entrar');
    }
    if (user.status !== 'ACTIVE') throw invalid;

    let mfaVerified = false;
    if (user.mfaEnabledAt) {
      if (!input.mfaCode) throw new AppError(401, ERROR_CODES.MFA_REQUIRED, 'Informe o código do autenticador');
      mfaVerified = await this.checkMfaCode(user, input.mfaCode);
      if (!mfaVerified) throw new AppError(401, ERROR_CODES.MFA_REQUIRED, 'Código inválido');
    }

    await this.deps.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { token, session } = await this.sessions.create(user, meta, mfaVerified);
    await writeAudit(this.deps.prisma, {
      tenantId: session.activeTenantId,
      actorUserId: user.id,
      actorType: user.isSuperadmin ? 'SUPERADMIN' : 'USER',
      resourceType: 'session',
      resourceId: session.id,
      action: 'auth.login',
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    return { token, user };
  }

  /** TOTP de 6 dígitos ou código de recuperação (uso único). */
  private async checkMfaCode(user: User, code: string): Promise<boolean> {
    if (!user.mfaSecretEnc) return false;
    if (/^\d{6}$/.test(code)) {
      const secret = this.deps.encryptor.decrypt(user.mfaSecretEnc);
      // Impede reuso do mesmo código dentro da janela.
      const replayKey = `ap:mfa-used:${user.id}:${code}`;
      if (!verifyTotp(secret, code)) return false;
      const fresh = await this.deps.redis.set(replayKey, '1', 'EX', 90, 'NX');
      return fresh === 'OK';
    }
    const hash = sha256Hex(code.toUpperCase());
    if (!user.mfaRecoveryHashes.includes(hash)) return false;
    await this.deps.prisma.user.update({
      where: { id: user.id },
      data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((h) => h !== hash) },
    });
    await writeAudit(this.deps.prisma, {
      actorUserId: user.id,
      actorType: 'USER',
      resourceType: 'user',
      resourceId: user.id,
      action: 'auth.mfa_recovery_code_used',
    });
    return true;
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
  }

  // ------------------------------------------------------------------ senha

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(`forgot:${meta.ip}`, 5, 3600);
    await this.limiter.enforce(`forgot-email:${sha256Hex(email)}`, 3, 3600);
    const user = await this.deps.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'DISABLED') return;
    const token = await this.issueEmailToken(user.id, 'RESET_PASSWORD', 3600 * 1000);
    await this.mailer.send(
      user.email,
      'Redefinição de senha',
      `Recebemos um pedido para redefinir sua senha.\n${this.link(`/redefinir-senha?token=${token}`)}\n\nO link expira em 1 hora. Se não foi você, ignore este email.`,
    );
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const row = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    const passwordHash = await hashPassword(password);
    await this.deps.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    await this.sessions.revokeAllForUser(row.userId);
    await writeAudit(this.deps.prisma, {
      actorUserId: row.userId,
      actorType: 'USER',
      resourceType: 'user',
      resourceId: row.userId,
      action: 'auth.password_reset',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }

  // ------------------------------------------------------------------ sessão/tenant

  async me(auth: AuthContext) {
    const memberships = await this.deps.prisma.tenantMembership.findMany({
      where: { userId: auth.userId, status: 'ACTIVE' },
      include: { tenant: { select: { id: true, tradeName: true, status: true } } },
    });
    let tenant = null;
    if (auth.tenantId) {
      const t = await this.deps.prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        include: { subscription: { include: { plan: true } } },
      });
      const [stores, pos, connections] = await Promise.all([
        this.deps.prisma.store.count({ where: { tenantId: t.id } }),
        this.deps.prisma.posTerminal.count({ where: { tenantId: t.id } }),
        this.deps.prisma.mpConnection.count({ where: { tenantId: t.id, status: 'ACTIVE' } }),
      ]);
      tenant = {
        id: t.id,
        tradeName: t.tradeName,
        status: t.status,
        timezone: t.timezone,
        logoUrl: t.logoUrl,
        brandColor: t.brandColor,
        subscription: t.subscription
          ? {
              status: t.subscription.status,
              planId: t.subscription.planId,
              planName: t.subscription.plan.name,
              currentPeriodEnd: t.subscription.currentPeriodEnd,
              cancelAtPeriodEnd: t.subscription.cancelAtPeriodEnd,
            }
          : null,
        onboarding: { mpConnected: connections > 0, hasStore: stores > 0, hasPos: pos > 0 },
      };
    }
    return {
      user: {
        id: auth.userId,
        email: auth.email,
        name: auth.name,
        isSuperadmin: auth.isSuperadmin,
        mfaEnabled: auth.mfaEnabled,
        mfaVerified: auth.mfaVerified,
      },
      role: auth.role,
      isOwner: auth.isOwner,
      permissions: auth.role ? permissionsForRole(auth.role) : [],
      storeIds: auth.storeIds,
      tenant,
      memberships: memberships.map((m) => ({ tenantId: m.tenantId, tradeName: m.tenant.tradeName, role: m.role, tenantStatus: m.tenant.status })),
    };
  }

  async switchTenant(auth: AuthContext, tenantId: string): Promise<void> {
    const m = await this.deps.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: auth.userId } },
    });
    if (!m || m.status !== 'ACTIVE') throw Errors.notFound('Empresa');
    await this.deps.prisma.session.update({ where: { id: auth.sessionId }, data: { activeTenantId: tenantId } });
  }

  // ------------------------------------------------------------------ MFA

  async mfaSetup(auth: AuthContext): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    const user = await this.deps.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabledAt) throw Errors.conflict('MFA já está ativo');
    const secret = generateTotpSecret();
    await this.deps.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: this.deps.encryptor.encrypt(secret) } });
    const url = otpauthUrl('AdapterPay', user.email, secret);
    return { otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240 }), secret };
  }

  async mfaEnable(auth: AuthContext, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    await this.limiter.enforce(`mfa:${auth.userId}`, 10, 900);
    const user = await this.deps.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabledAt) throw Errors.conflict('MFA já está ativo');
    if (!user.mfaSecretEnc || !verifyTotp(this.deps.encryptor.decrypt(user.mfaSecretEnc), code)) {
      throw Errors.validation('Código inválido');
    }
    const { codes, hashes } = generateRecoveryCodes();
    await this.deps.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabledAt: new Date(), mfaRecoveryHashes: hashes },
    });
    await this.sessions.markMfaVerified(auth.sessionId);
    await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    await writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: user.id,
      actorType: user.isSuperadmin ? 'SUPERADMIN' : 'USER',
      resourceType: 'user',
      resourceId: user.id,
      action: 'auth.mfa_enabled',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { recoveryCodes: codes };
  }

  async mfaChallenge(auth: AuthContext, code: string): Promise<void> {
    await this.limiter.enforce(`mfa:${auth.userId}`, 10, 900);
    const user = await this.deps.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaEnabledAt) throw Errors.validation('MFA não está ativo');
    if (!(await this.checkMfaCode(user, code))) throw Errors.validation('Código inválido');
    await this.sessions.markMfaVerified(auth.sessionId);
  }

  async mfaDisable(auth: AuthContext, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.deps.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.isSuperadmin) throw Errors.forbidden('MFA é obrigatório para a equipe Adapter Co');
    if (auth.requireAdminMfa && auth.role === 'ADMIN') throw Errors.forbidden('A empresa exige MFA para administradores');
    if (!user.mfaEnabledAt || !(await this.checkMfaCode(user, code))) throw Errors.validation('Código inválido');
    await this.deps.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryHashes: [] },
    });
    await writeAudit(this.deps.prisma, {
      tenantId: auth.tenantId,
      actorUserId: user.id,
      actorType: 'USER',
      resourceType: 'user',
      resourceId: user.id,
      action: 'auth.mfa_disabled',
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
  }

  async regenerateRecoveryCodes(auth: AuthContext): Promise<{ recoveryCodes: string[] }> {
    if (!auth.mfaEnabled) throw Errors.validation('MFA não está ativo');
    if (!auth.mfaVerified) throw Errors.mfaRequired();
    const { codes, hashes } = generateRecoveryCodes();
    await this.deps.prisma.user.update({ where: { id: auth.userId }, data: { mfaRecoveryHashes: hashes } });
    return { recoveryCodes: codes };
  }
}
