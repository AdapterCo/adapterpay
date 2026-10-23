import type { PrismaClient, TxClient } from '@adapterpay/database';
import type { EventPublisher } from './events';

/** Notificações do painel. O único envio externo é o fechamento de caixa diário por WhatsApp (reports/daily-closing). */
export async function createNotification(
  db: PrismaClient | TxClient,
  events: EventPublisher | null,
  params: { tenantId: string; userId?: string | null; kind: string; title: string; body: string; link?: string | null },
): Promise<void> {
  const n = await db.notification.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      kind: params.kind,
      title: params.title.slice(0, 200),
      body: params.body.slice(0, 1000),
      link: params.link ?? null,
    },
  });
  if (events) {
    await events.publish({ type: 'notification.created', tenantId: params.tenantId, notificationId: n.id }).catch(() => undefined);
  }
}
