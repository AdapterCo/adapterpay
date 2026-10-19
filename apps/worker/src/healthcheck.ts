import Redis from 'ioredis';
import { WORKER_HEARTBEAT_KEY } from '@adapterpay/core';

/** Healthcheck do container: falha se o heartbeat do worker tiver mais de 60s. */
async function main(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) process.exit(1);
  const redis = new Redis(url, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const raw = await redis.get(WORKER_HEARTBEAT_KEY);
    const at = raw ? (JSON.parse(raw) as { at: number }).at : 0;
    process.exit(Date.now() - at < 60_000 ? 0 : 1);
  } catch {
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

void main();
