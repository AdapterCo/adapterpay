import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export type TxClient = Prisma.TransactionClient;

/** Cria o PrismaClient com logging mínimo (queries nunca são logadas: podem conter dados sensíveis). */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { level: 'warn', emit: 'stdout' },
      { level: 'error', emit: 'stdout' },
    ],
  });
}

/** Erro de violação de unicidade (P2002), útil para idempotência/concorrência. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!target) return true;
  const meta = err.meta?.target;
  if (Array.isArray(meta)) return meta.some((t) => String(t).includes(target));
  return typeof meta === 'string' ? meta.includes(target) : true;
}

/** Violação de constraint vinda de SQL bruto (índice parcial) chega como P2010/P2002 ou erro 23505. */
export function isPgUniqueViolation(err: unknown, constraint?: string): boolean {
  if (isUniqueViolation(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('23505') && !msg.toLowerCase().includes('unique constraint')) return false;
  return constraint ? msg.includes(constraint) : true;
}
