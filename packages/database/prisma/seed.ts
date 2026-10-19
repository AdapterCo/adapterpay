import { PrismaClient } from '@prisma/client';
import { PLAN_DEFINITIONS } from '@adapterpay/shared';

/**
 * Seed idempotente: cria/atualiza os 4 planos comerciais.
 * Não cria superadmin com senha padrão — use `pnpm --filter @adapterpay/api cli:create-superadmin`.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const p of PLAN_DEFINITIONS) {
      await prisma.plan.upsert({
        where: { id: p.id },
        create: { ...p, active: true },
        update: {
          name: p.name,
          priceCents: p.priceCents,
          maxPos: p.maxPos,
          maxStores: p.maxStores,
          maxUsers: p.maxUsers,
          sortOrder: p.sortOrder,
        },
      });
    }
    console.log(JSON.stringify({ msg: 'seed: planos sincronizados', count: PLAN_DEFINITIONS.length }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
