export const TENANT_ROLES = ['ADMIN', 'VENDEDOR', 'CONTADOR'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const ROLE_LABELS: Record<TenantRole, string> = {
  ADMIN: 'Administrador',
  VENDEDOR: 'Vendedor',
  CONTADOR: 'Contador',
};

/** Permissões nomeadas. A autorização é sempre resolvida no backend; o frontend usa apenas para esconder ações. */
export type Permission =
  | 'charges:create'
  | 'charges:read'
  | 'charges:cancel'
  | 'stores:manage'
  | 'stores:read'
  | 'pos:manage'
  | 'pos:read'
  | 'pos:read_brcode'
  | 'users:manage'
  | 'mp:manage'
  | 'subscription:manage'
  | 'subscription:read'
  | 'reports:read'
  | 'reports:export'
  | 'settings:manage'
  | 'audit:read'
  | 'products:manage'
  | 'products:read'
  | 'loyalty:manage'
  | 'loyalty:use';

const MATRIX: Record<TenantRole, readonly Permission[]> = {
  ADMIN: [
    'charges:create',
    'charges:read',
    'charges:cancel',
    'stores:manage',
    'stores:read',
    'pos:manage',
    'pos:read',
    'pos:read_brcode',
    'users:manage',
    'mp:manage',
    'subscription:manage',
    'subscription:read',
    'reports:read',
    'reports:export',
    'settings:manage',
    'audit:read',
    'products:manage',
    'products:read',
    'loyalty:manage',
    'loyalty:use',
  ],
  VENDEDOR: ['charges:create', 'charges:read', 'charges:cancel', 'stores:read', 'pos:read', 'products:read', 'loyalty:use'],
  CONTADOR: ['charges:read', 'reports:read', 'reports:export', 'stores:read'],
};

export function roleHasPermission(role: TenantRole, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsForRole(role: TenantRole): readonly Permission[] {
  return MATRIX[role];
}

/** Papéis cujo acesso a lojas é restrito às lojas atribuídas (store_memberships). ADMIN vê todas. */
export function isStoreScopedRole(role: TenantRole): boolean {
  return role !== 'ADMIN';
}
