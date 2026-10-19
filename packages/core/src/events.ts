import type { Redis } from 'ioredis';

/**
 * Eventos internos entre worker/API e o SSE. O payload é mínimo e NUNCA contém dados sensíveis:
 * o assinante (API) recompõe a visão segura a partir do banco antes de enviar ao navegador.
 */
export type InternalEvent =
  | { type: 'charge.updated'; tenantId: string; chargeId: string; posId: string; status: string }
  | { type: 'pos.updated'; tenantId: string; posId: string }
  | { type: 'notification.created'; tenantId: string; notificationId: string }
  | { type: 'subscription.updated'; tenantId: string };

export const channels = {
  pos: (posId: string) => `ap:events:pos:${posId}`,
  charge: (chargeId: string) => `ap:events:charge:${chargeId}`,
  tenant: (tenantId: string) => `ap:events:tenant:${tenantId}`,
};

export class EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: InternalEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const targets = [channels.tenant(event.tenantId)];
    if (event.type === 'charge.updated') {
      targets.push(channels.pos(event.posId), channels.charge(event.chargeId));
    } else if (event.type === 'pos.updated') {
      targets.push(channels.pos(event.posId));
    }
    await Promise.all(targets.map((ch) => this.redis.publish(ch, payload)));
  }
}
