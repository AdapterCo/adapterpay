import type { Plan, TxClient } from '@adapterpay/database';
import { canActivate, limitFor, type LimitResource, type UsageCounts } from '@adapterpay/shared';

/**
 * Limites agregados por tenant (seção 2), aplicados com lock transacional do tenant para impedir
 * excedentes por requisições simultâneas. Chamar SEMPRE dentro de prisma.$transaction.
 */

export class SubscriptionInactiveError extends Error {
  constructor(readonly tenantStatus: string) {
    super('Assinatura inativa: operação bloqueada até a regularização do pagamento');
    this.name = 'SubscriptionInactiveError';
  }
}

export class PlanLimitError extends Error {
  constructor(
    readonly resource: LimitResource,
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Limite do plano atingido para ${resource}: ${used}/${limit}`);
    this.name = 'PlanLimitError';
  }
}

export async function lockTenant(tx: TxClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

export async function getUsage(tx: TxClient, tenantId: string): Promise<UsageCounts> {
  const [pos, stores, users] = await Promise.all([
    tx.posTerminal.count({ where: { tenantId, status: 'ACTIVE' } }),
    tx.store.count({ where: { tenantId, status: 'ACTIVE' } }),
    // Proprietário conta no limite; convites pendentes reservam vaga; superadmin não é membro.
    tx.tenantMembership.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } }),
  ]);
  return { pos, stores, users };
}

/** Tenant ACTIVE com assinatura ACTIVE. Retorna o plano vigente. Bloqueia a linha do tenant. */
export async function assertTenantOperational(tx: TxClient, tenantId: string): Promise<Plan> {
  await lockTenant(tx, tenantId);
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { subscription: { include: { plan: true } } },
  });
  if (tenant.status !== 'ACTIVE' || !tenant.subscription || tenant.subscription.status !== 'ACTIVE') {
    throw new SubscriptionInactiveError(tenant.status);
  }
  return tenant.subscription.plan;
}

export async function assertCanActivate(
  tx: TxClient,
  tenantId: string,
  resource: LimitResource,
  increment = 1,
): Promise<void> {
  const plan = await assertTenantOperational(tx, tenantId);
  const usage = await getUsage(tx, tenantId);
  if (!canActivate(plan, usage, resource, increment)) {
    throw new PlanLimitError(resource, usage[resource], limitFor(plan, resource));
  }
}
