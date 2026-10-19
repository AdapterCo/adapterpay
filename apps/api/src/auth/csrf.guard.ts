import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { safeEqual, type CoreDeps } from '@adapterpay/core';
import { ERROR_CODES } from '@adapterpay/shared';
import { CORE } from '../common/tokens';
import { AppError } from '../common/errors';
import type { AppRequest } from '../common/request';
import { cookieNames } from './cookies';
import { META } from './decorators';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF: double-submit cookie + verificação de Origin para métodos que alteram estado. */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly appOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {
    this.appOrigin = new URL(deps.config.APP_URL).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(META.skipCsrf, [context.getHandler(), context.getClass()])) return true;

    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== this.appOrigin) {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Origem não permitida');
    }
    const cookie = req.cookies?.[cookieNames(this.deps.config).csrf] as string | undefined;
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Token CSRF inválido. Recarregue a página.');
    }
    return true;
  }
}
