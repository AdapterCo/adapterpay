import type { ActorType, Prisma, PrismaClient, TxClient } from '@adapterpay/database';
import { redactPayload } from './redact';

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorType: ActorType;
  resourceType: string;
  resourceId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

/** Grava trilha de auditoria com before/after saneados (sem tokens/segredos). */
export async function writeAudit(db: PrismaClient | TxClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      action: entry.action,
      before: entry.before === undefined ? undefined : (redactPayload(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redactPayload(entry.after) as Prisma.InputJsonValue),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 300) ?? null,
      correlationId: entry.correlationId ?? null,
    },
  });
}
