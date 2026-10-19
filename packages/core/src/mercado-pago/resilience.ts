import type { Redis } from 'ioredis';
import { MpApiError } from './http';

/**
 * Proteções por conta Mercado Pago (seção 9):
 *  - semáforo de concorrência por conta (evita sobrecarregar o provedor);
 *  - circuit breaker: após N falhas transitórias em 60s, abre por 30s;
 *  - backoff exponencial com jitter, respeitando Retry-After em 429.
 */

const CB_WINDOW_SEC = 60;
const CB_THRESHOLD = 10;
const CB_OPEN_MS = 30_000;

export class AccountGuard {
  constructor(
    private readonly redis: Redis,
    private readonly maxConcurrency: number,
  ) {}

  async isCircuitOpen(accountKey: string): Promise<boolean> {
    return (await this.redis.exists(`ap:cb:open:${accountKey}`)) === 1;
  }

  async recordFailure(accountKey: string): Promise<void> {
    const key = `ap:cb:fail:${accountKey}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, CB_WINDOW_SEC);
    if (n >= CB_THRESHOLD) {
      await this.redis.set(`ap:cb:open:${accountKey}`, '1', 'PX', CB_OPEN_MS);
      await this.redis.del(key);
    }
  }

  async recordSuccess(accountKey: string): Promise<void> {
    await this.redis.del(`ap:cb:fail:${accountKey}`);
  }

  /** Tenta ocupar uma vaga do semáforo. Retorna função de liberação ou null se cheio. */
  async tryAcquire(accountKey: string): Promise<(() => Promise<void>) | null> {
    const key = `ap:sem:${accountKey}`;
    const n = await this.redis.incr(key);
    await this.redis.pexpire(key, 30_000); // auto-recuperação se um processo morrer segurando vaga
    if (n > this.maxConcurrency) {
      await this.redis.decr(key);
      return null;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const left = await this.redis.decr(key);
      if (left < 0) await this.redis.set(key, '0', 'PX', 30_000);
    };
  }

  /**
   * Executa `fn` sob o semáforo e o circuit breaker. Lança CircuitOpenError/ConcurrencyLimitError
   * quando não é possível executar agora (o chamador reagenda sem contar como erro do provedor).
   */
  async run<T>(accountKey: string, fn: () => Promise<T>): Promise<T> {
    if (await this.isCircuitOpen(accountKey)) throw new CircuitOpenError();
    const release = await this.tryAcquire(accountKey);
    if (!release) throw new ConcurrencyLimitError();
    try {
      const out = await fn();
      await this.recordSuccess(accountKey);
      return out;
    } catch (err) {
      if (err instanceof MpApiError && err.retryable) await this.recordFailure(accountKey);
      throw err;
    } finally {
      await release();
    }
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker aberto para a conta Mercado Pago');
    this.name = 'CircuitOpenError';
  }
}

export class ConcurrencyLimitError extends Error {
  constructor() {
    super('Limite de concorrência por conta Mercado Pago atingido');
    this.name = 'ConcurrencyLimitError';
  }
}

/** Backoff exponencial com jitter total: base * 2^attempt, teto `maxMs`. */
export function backoffWithJitter(attempt: number, baseMs = 3000, maxMs = 60_000, rand = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.max(baseMs, Math.floor(exp / 2 + rand() * (exp / 2)));
}
