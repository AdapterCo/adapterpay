import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createRedis, type CoreDeps, type InternalEvent } from '@adapterpay/core';
import { CORE } from '../common/tokens';

type Handler = (event: InternalEvent) => void;

/**
 * Hub de eventos: uma única conexão Redis em modo subscriber por processo, com contagem de
 * referências por canal. Cada conexão SSE registra handlers e remove ao encerrar.
 */
@Injectable()
export class EventsHub implements OnModuleDestroy {
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(@Inject(CORE) private readonly deps: CoreDeps) {
    this.sub = createRedis(deps.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.sub.on('message', (channel: string, message: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let event: InternalEvent;
      try {
        event = JSON.parse(message) as InternalEvent;
      } catch {
        return;
      }
      for (const h of set) {
        try {
          h(event);
        } catch (err) {
          this.deps.logger.warn({ err: (err as Error).message }, 'handler SSE falhou');
        }
      }
    });
  }

  subscribe(channel: string, handler: Handler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      void this.sub.subscribe(channel);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        void this.sub.unsubscribe(channel);
      }
    };
  }

  /** Limita conexões SSE simultâneas por chave (ex.: IP), com auto-expiração. */
  async acquireSlot(key: string, max: number): Promise<(() => void) | null> {
    const k = `ap:sse:${key}`;
    const n = await this.deps.redis.incr(k);
    await this.deps.redis.expire(k, 900);
    if (n > max) {
      await this.deps.redis.decr(k);
      return null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      void this.deps.redis.decr(k);
    };
  }

  onModuleDestroy(): void {
    this.sub.disconnect();
  }
}
