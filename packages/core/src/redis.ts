import Redis, { type RedisOptions } from 'ioredis';
import { randomToken } from './crypto';

export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, {
    // BullMQ exige maxRetriesPerRequest=null para conexões bloqueantes.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    ...opts,
  });
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Lock distribuído simples (SET NX PX). Retorna token para liberação segura, ou null. */
export async function acquireLock(redis: Redis, key: string, ttlMs: number): Promise<string | null> {
  const token = randomToken(16);
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? token : null;
}

export async function releaseLock(redis: Redis, key: string, token: string): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, key, token);
}

/** Aguarda o lock por até waitMs, tentando a cada 100ms. */
export async function acquireLockWait(redis: Redis, key: string, ttlMs: number, waitMs: number): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const token = await acquireLock(redis, key, ttlMs);
    if (token) return token;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export type { Redis };
