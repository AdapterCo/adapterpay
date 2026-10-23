/** Planos comerciais (seção 2). A fonte de verdade em runtime é a tabela `plans`; estes valores semeiam o banco. */
export interface PlanDefinition {
  id: string;
  name: string;
  priceCents: number;
  maxPos: number;
  maxStores: number;
  maxUsers: number;
  sortOrder: number;
}

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  { id: 'inicial', name: 'Inicial', priceCents: 2990, maxPos: 1, maxStores: 1, maxUsers: 2, sortOrder: 1 },
  { id: 'essencial', name: 'Essencial', priceCents: 5990, maxPos: 3, maxStores: 3, maxUsers: 5, sortOrder: 2 },
  { id: 'profissional', name: 'Profissional', priceCents: 9990, maxPos: 10, maxStores: 10, maxUsers: 15, sortOrder: 3 },
  { id: 'empresarial', name: 'Empresarial', priceCents: 17990, maxPos: 25, maxStores: 25, maxUsers: 40, sortOrder: 4 },
];

export type LimitResource = 'pos' | 'stores' | 'users';

export interface PlanLimits {
  maxPos: number;
  maxStores: number;
  maxUsers: number;
}

export interface UsageCounts {
  pos: number;
  stores: number;
  users: number;
}

export function limitFor(plan: PlanLimits, resource: LimitResource): number {
  switch (resource) {
    case 'pos':
      return plan.maxPos;
    case 'stores':
      return plan.maxStores;
    case 'users':
      return plan.maxUsers;
  }
}

/** Mensalidade com o adicional de totens: preço do plano + quantidade × preço por totem. */
export function subscriptionMonthlyCents(plan: { priceCents: number; totemPriceCents: number | null }, totemQuantity: number): number {
  return plan.priceCents + (plan.totemPriceCents ?? 0) * Math.max(0, totemQuantity);
}

/**
 * Valores de cobrança recorrente aceitos para um plano: mensalidade com 0..maxTotems totens.
 * A quantidade de totens pode ter mudado entre a cobrança do cartão e a consulta.
 */
export function acceptedMonthlyAmounts(plan: { priceCents: number; totemPriceCents: number | null }, maxTotems: number): number[] {
  const out: number[] = [];
  for (let q = 0; q <= Math.max(0, maxTotems); q++) out.push(subscriptionMonthlyCents(plan, q));
  return out;
}

/** true se for permitido ativar mais `increment` itens do recurso. */
export function canActivate(plan: PlanLimits, usage: UsageCounts, resource: LimitResource, increment = 1): boolean {
  return usage[resource] + increment <= limitFor(plan, resource);
}

/** Lista recursos que excedem o plano alvo (usado em downgrade). */
export function excessForPlan(
  plan: PlanLimits,
  usage: UsageCounts,
): Array<{ resource: LimitResource; used: number; limit: number }> {
  const out: Array<{ resource: LimitResource; used: number; limit: number }> = [];
  (['pos', 'stores', 'users'] as const).forEach((r) => {
    const limit = limitFor(plan, r);
    if (usage[r] > limit) out.push({ resource: r, used: usage[r], limit });
  });
  return out;
}

/**
 * Política de prorrata de upgrade (documentada em docs/assinaturas.md):
 * diferença de mensalidade proporcional aos segundos restantes do período pago, arredondada PARA CIMA ao centavo.
 * Cálculo em inteiros (BigInt) para não usar float.
 */
export function prorataUpgradeCents(params: {
  currentPriceCents: number;
  targetPriceCents: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): number {
  const { currentPriceCents, targetPriceCents, periodStart, periodEnd, now } = params;
  const diff = targetPriceCents - currentPriceCents;
  if (diff <= 0) return 0;
  const totalSec = Math.max(1, Math.floor((periodEnd.getTime() - periodStart.getTime()) / 1000));
  const remainingSec = Math.floor((periodEnd.getTime() - now.getTime()) / 1000);
  if (remainingSec <= 0) return 0;
  const total = BigInt(totalSec);
  const remaining = BigInt(Math.min(remainingSec, totalSec));
  const cents = (BigInt(diff) * remaining + total - 1n) / total; // ceil
  return Number(cents);
}
