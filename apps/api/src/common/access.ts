import { Errors } from './errors';
import type { AuthContext } from './request';

/** Garante que o usuário pode operar a loja (VENDEDOR/CONTADOR apenas nas lojas atribuídas). */
export function assertStoreAccess(auth: AuthContext, storeId: string): void {
  if (auth.storeIds === 'ALL') return;
  if (!auth.storeIds.includes(storeId)) throw Errors.notFound('Loja');
}

/** Filtro Prisma por lojas permitidas. */
export function storeScope(auth: AuthContext): { storeId?: { in: string[] } } {
  return auth.storeIds === 'ALL' ? {} : { storeId: { in: auth.storeIds } };
}

export function storeIdScope(auth: AuthContext): { id?: { in: string[] } } {
  return auth.storeIds === 'ALL' ? {} : { id: { in: auth.storeIds } };
}
