import { describe, expect, it } from 'vitest';
import { canTransition, CHARGE_STATUSES, isActiveCharge } from './charge-states';
import { canActivate, excessForPlan, PLAN_DEFINITIONS, prorataUpgradeCents } from './plans';
import { roleHasPermission } from './roles';
import { createChargeSchema, registerSchema } from './schemas';

describe('máquina de estados da cobrança', () => {
  it('PAID nunca regride', () => {
    for (const s of CHARGE_STATUSES) {
      if (s === 'REFUNDED') continue;
      expect(canTransition('PAID', s)).toBe(false);
    }
    expect(canTransition('PAID', 'REFUNDED')).toBe(true);
  });

  it('transições principais', () => {
    expect(canTransition('CREATING', 'PENDING')).toBe(true);
    expect(canTransition('PENDING', 'PAID')).toBe(true);
    expect(canTransition('PENDING', 'EXPIRED')).toBe(true);
    expect(canTransition('PENDING', 'RECONCILING')).toBe(true);
    expect(canTransition('RECONCILING', 'PAID')).toBe(true);
    expect(canTransition('EXPIRED', 'PENDING')).toBe(false);
    expect(canTransition('FAILED', 'PENDING')).toBe(false);
    expect(canTransition('PENDING', 'PENDING')).toBe(false);
  });

  it('estados ativos ocupam o POS', () => {
    expect(isActiveCharge('CREATING')).toBe(true);
    expect(isActiveCharge('PENDING')).toBe(true);
    expect(isActiveCharge('RECONCILING')).toBe(true);
    expect(isActiveCharge('EXPIRED')).toBe(false);
    expect(isActiveCharge('PAID')).toBe(false);
  });
});

describe('planos e limites', () => {
  it('tabela comercial da seção 2', () => {
    expect(PLAN_DEFINITIONS.map((p) => [p.id, p.priceCents, p.maxPos, p.maxStores, p.maxUsers])).toEqual([
      ['inicial', 2990, 1, 1, 2],
      ['essencial', 5990, 3, 3, 5],
      ['profissional', 9990, 10, 10, 15],
      ['empresarial', 17990, 25, 25, 40],
    ]);
  });

  it.each(PLAN_DEFINITIONS.map((p) => [p.id, p] as const))('limites do plano %s', (_id, plan) => {
    expect(canActivate(plan, { pos: plan.maxPos - 1, stores: 0, users: 0 }, 'pos')).toBe(true);
    expect(canActivate(plan, { pos: plan.maxPos, stores: 0, users: 0 }, 'pos')).toBe(false);
    expect(canActivate(plan, { pos: 0, stores: plan.maxStores, users: 0 }, 'stores')).toBe(false);
    expect(canActivate(plan, { pos: 0, stores: 0, users: plan.maxUsers }, 'users')).toBe(false);
  });

  it('excedentes para downgrade', () => {
    const inicial = PLAN_DEFINITIONS[0]!;
    expect(excessForPlan(inicial, { pos: 3, stores: 1, users: 2 })).toEqual([{ resource: 'pos', used: 3, limit: 1 }]);
    expect(excessForPlan(inicial, { pos: 1, stores: 1, users: 2 })).toEqual([]);
  });

  it('prorrata arredonda para cima em centavos inteiros', () => {
    const periodStart = new Date('2026-01-01T00:00:00Z');
    const periodEnd = new Date('2026-01-31T00:00:00Z');
    const half = new Date('2026-01-16T00:00:00Z');
    expect(
      prorataUpgradeCents({ currentPriceCents: 2990, targetPriceCents: 5990, periodStart, periodEnd, now: half }),
    ).toBe(1500);
    expect(
      prorataUpgradeCents({ currentPriceCents: 5990, targetPriceCents: 2990, periodStart, periodEnd, now: half }),
    ).toBe(0);
    expect(
      prorataUpgradeCents({ currentPriceCents: 2990, targetPriceCents: 5990, periodStart, periodEnd, now: periodEnd }),
    ).toBe(0);
  });
});

describe('RBAC', () => {
  it('vendedor não gerencia usuários nem lê BR Code administrativo', () => {
    expect(roleHasPermission('VENDEDOR', 'charges:create')).toBe(true);
    expect(roleHasPermission('VENDEDOR', 'users:manage')).toBe(false);
    expect(roleHasPermission('VENDEDOR', 'reports:read')).toBe(false);
    expect(roleHasPermission('VENDEDOR', 'mp:manage')).toBe(false);
  });
  it('contador é somente leitura', () => {
    expect(roleHasPermission('CONTADOR', 'reports:export')).toBe(true);
    expect(roleHasPermission('CONTADOR', 'charges:create')).toBe(false);
    expect(roleHasPermission('CONTADOR', 'charges:cancel')).toBe(false);
  });
});

describe('schemas', () => {
  it('cobrança exige inteiro positivo em centavos', () => {
    const posId = '7f1d8b6e-1c2a-4c4e-9b1a-1a2b3c4d5e6f';
    expect(createChargeSchema.safeParse({ posId, amountCents: 100 }).success).toBe(true);
    expect(createChargeSchema.safeParse({ posId, amountCents: 0 }).success).toBe(false);
    expect(createChargeSchema.safeParse({ posId, amountCents: 1.5 }).success).toBe(false);
    expect(createChargeSchema.safeParse({ posId, amountCents: -100 }).success).toBe(false);
  });
  it('cadastro normaliza CPF/CNPJ e exige termos', () => {
    const base = {
      planId: 'inicial',
      legalName: 'Empresa Teste LTDA',
      tradeName: 'Teste',
      taxId: '12.345.678/0001-90',
      adminName: 'Fulano',
      email: 'ADMIN@Example.com ',
      password: 'senhaforte123',
      acceptTerms: true,
    };
    const r = registerSchema.parse(base);
    expect(r.taxId).toBe('12345678000190');
    expect(r.email).toBe('admin@example.com');
    expect(registerSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
  });
});
