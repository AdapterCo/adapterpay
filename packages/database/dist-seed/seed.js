"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const shared_1 = require("@adapterpay/shared");
/**
 * Seed idempotente: cria/atualiza os 4 planos comerciais.
 * Não cria superadmin com senha padrão — use `pnpm --filter @adapterpay/api cli:create-superadmin`.
 */
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        for (const p of shared_1.PLAN_DEFINITIONS) {
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
        console.log(JSON.stringify({ msg: 'seed: planos sincronizados', count: shared_1.PLAN_DEFINITIONS.length }));
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map