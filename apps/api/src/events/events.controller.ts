import { Controller, Header, Inject, type MessageEvent, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { channels, type CoreDeps, type InternalEvent } from '@adapterpay/core';
import { ERROR_CODES } from '@adapterpay/shared';
import { AppError } from '../common/errors';
import { CurrentAuth, requireTenant, type AuthContext } from '../common/request';
import { CORE } from '../common/tokens';
import { EventsHub } from './events-hub.service';

const MAX_STREAM_MS = 10 * 60 * 1000;

/** SSE autenticado do painel: canal isolado por tenant, filtrado pelo escopo de lojas do usuário. */
@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly hub: EventsHub,
    @Inject(CORE) private readonly deps: CoreDeps,
  ) {}

  @Sse('stream')
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  async stream(@CurrentAuth() auth: AuthContext): Promise<Observable<MessageEvent>> {
    const tenantId = requireTenant(auth);
    const release = await this.hub.acquireSlot(`user:${auth.userId}`, 5);
    if (!release) throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Muitas conexões abertas');
    const storeCache = new Map<string, string>();

    return new Observable<MessageEvent>((subscriber) => {
      const allowed = async (event: InternalEvent): Promise<boolean> => {
        if (auth.storeIds === 'ALL') return true;
        if (event.type !== 'charge.updated' && event.type !== 'pos.updated') return event.type === 'notification.created';
        let storeId = storeCache.get(event.posId);
        if (!storeId) {
          const pos = await this.deps.prisma.posTerminal.findUnique({ where: { id: event.posId }, select: { storeId: true } });
          if (!pos) return false;
          storeId = pos.storeId;
          storeCache.set(event.posId, storeId);
        }
        return auth.storeIds.includes(storeId);
      };
      const unsubscribe = this.hub.subscribe(channels.tenant(tenantId), (event) => {
        void allowed(event).then((ok) => {
          if (!ok) return;
          // Payload mínimo: o cliente recarrega os dados pelos endpoints autorizados.
          const data =
            event.type === 'charge.updated'
              ? { type: event.type, chargeId: event.chargeId, posId: event.posId, status: event.status }
              : event.type === 'pos.updated'
                ? { type: event.type, posId: event.posId }
                : { type: event.type };
          subscriber.next({ type: 'message', data });
        });
      });
      subscriber.next({ type: 'ready', data: { ok: true } });
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: String(Date.now()) }), 15_000);
      const timeout = setTimeout(() => subscriber.complete(), MAX_STREAM_MS);
      return () => {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        unsubscribe();
        release();
      };
    });
  }
}
