import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@adapterpay/shared';

export const META = {
  public: 'ap:public',
  noTenant: 'ap:no_tenant',
  permissions: 'ap:permissions',
  superadmin: 'ap:superadmin',
  critical: 'ap:critical',
  skipCsrf: 'ap:skip_csrf',
  allowMfaEnrollment: 'ap:allow_mfa_enrollment',
  allowInactiveTenant: 'ap:allow_inactive_tenant',
} as const;

/** Rota pública (sem sessão). A sessão, se houver, ainda é anexada. */
export const Public = () => SetMetadata(META.public, true);
/** Autenticada, mas não exige empresa selecionada (ex.: /auth/me, MFA, superadmin). */
export const NoTenant = () => SetMetadata(META.noTenant, true);
/** Exige permissões do papel no tenant ativo (validadas no backend). */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(META.permissions, permissions);
/** Somente equipe Adapter Co, com MFA verificado na sessão. */
export const Superadmin = () => SetMetadata(META.superadmin, true);
/** Operação crítica: exige MFA confirmado recentemente quando o usuário tem MFA (ou a empresa exige). */
export const Critical = () => SetMetadata(META.critical, true);
export const SkipCsrf = () => SetMetadata(META.skipCsrf, true);
/** Permitida a superadmin que ainda não ativou MFA (fluxo de ativação). */
export const AllowMfaEnrollment = () => SetMetadata(META.allowMfaEnrollment, true);
