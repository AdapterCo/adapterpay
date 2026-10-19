import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRole } from '@adapterpay/shared';
import { Errors } from './errors';

/** Contexto de autenticação resolvido no backend a cada requisição (nunca a partir de IDs do cliente). */
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
  mfaEnabled: boolean;
  /** MFA confirmado nesta sessão */
  mfaVerified: boolean;
  tenantId: string | null;
  role: TenantRole | null;
  isOwner: boolean;
  /** 'ALL' para ADMIN; lista de lojas atribuídas para VENDEDOR/CONTADOR */
  storeIds: 'ALL' | string[];
  tenantStatus: string | null;
  subscriptionStatus: string | null;
  requireAdminMfa: boolean;
}

export interface AppRequest extends Request {
  auth?: AuthContext;
  correlationId?: string;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null,
    correlationId: req.correlationId ?? null,
  };
});

/** Tenant obrigatório para rotas de painel. */
export function requireTenant(auth: AuthContext): string {
  if (!auth.tenantId) throw Errors.forbidden('Selecione uma empresa');
  return auth.tenantId;
}
