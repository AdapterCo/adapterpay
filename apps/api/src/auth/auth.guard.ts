import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CoreDeps } from '@adapterpay/core';
import { CORE } from '../common/tokens';
import { Errors } from '../common/errors';
import type { AppRequest } from '../common/request';
import { cookieNames } from './cookies';
import { META } from './decorators';
import { SessionService } from './session.service';

/** Autenticação global por cookie de sessão. Rotas públicas devem ser marcadas com @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = (key: string) => this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<AppRequest>();
    const isPublic = flag(META.public);

    const token = req.cookies?.[cookieNames(this.deps.config).session] as string | undefined;
    const session = token ? await this.sessions.findValid(token) : null;
    if (session) req.auth = await this.sessions.buildContext(session);

    if (isPublic) return true;
    const auth = req.auth;
    if (!auth) throw Errors.unauthenticated();

    // Superadmin sem MFA só acessa o fluxo de ativação de MFA.
    if (auth.isSuperadmin && !auth.mfaEnabled && !flag(META.allowMfaEnrollment)) throw Errors.mfaEnrollment();

    if (flag(META.superadmin)) {
      if (!auth.isSuperadmin) throw Errors.notFound('Rota');
      if (!auth.mfaVerified) throw Errors.mfaRequired();
      return true;
    }

    if (!flag(META.noTenant) && !flag(META.allowMfaEnrollment)) {
      if (!auth.tenantId || !auth.role) throw Errors.forbidden('Nenhuma empresa ativa vinculada a este usuário');
    }

    if (flag(META.critical)) {
      if (auth.mfaEnabled && !auth.mfaVerified) throw Errors.mfaRequired();
      if (!auth.mfaEnabled && auth.requireAdminMfa && auth.role === 'ADMIN') throw Errors.mfaEnrollment();
    }
    return true;
  }
}
