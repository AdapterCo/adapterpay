import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, type Permission } from '@adapterpay/shared';
import { Errors } from '../common/errors';
import type { AppRequest } from '../common/request';
import { META } from './decorators';

/** RBAC por papel no tenant ativo. Escopo por loja é verificado nos serviços (assertStoreAccess). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(META.permissions, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const auth = context.switchToHttp().getRequest<AppRequest>().auth;
    if (!auth?.role) throw Errors.forbidden();
    for (const p of required) {
      if (!roleHasPermission(auth.role, p)) throw Errors.forbidden();
    }
    return true;
  }
}
