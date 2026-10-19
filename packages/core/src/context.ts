import { createPrismaClient, type PrismaClient } from '@adapterpay/database';
import type { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from './config';
import { Encryptor } from './crypto';
import { EventPublisher } from './events';
import { createLogger, type Logger } from './logger';
import { AccountGuard, MercadoPagoHttp } from './mercado-pago';
import { createRedis } from './redis';
import { MpTokenService } from './connections/token-service';

/** Dependências compartilhadas por API e worker. Montado uma vez por processo. */
export interface CoreDeps {
  config: AppConfig;
  prisma: PrismaClient;
  redis: Redis;
  encryptor: Encryptor;
  mpApi: MercadoPagoHttp;
  events: EventPublisher;
  guard: AccountGuard;
  tokens: MpTokenService;
  logger: Logger;
}

export function createCoreDeps(serviceName: string, overrides: Partial<CoreDeps> = {}): CoreDeps {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger(serviceName);
  const prisma = overrides.prisma ?? createPrismaClient();
  const redis = overrides.redis ?? createRedis(config.REDIS_URL);
  const encryptor =
    overrides.encryptor ?? new Encryptor(config.ENCRYPTION_KEY_ID, config.ENCRYPTION_KEY, config.ENCRYPTION_PREVIOUS_KEYS);
  const mpApi =
    overrides.mpApi ??
    new MercadoPagoHttp({ baseUrl: config.MP_API_BASE, timeoutMs: config.MP_HTTP_TIMEOUT_MS, userAgent: 'AdapterPay/1.0' });
  const events = overrides.events ?? new EventPublisher(redis);
  const guard = overrides.guard ?? new AccountGuard(redis, config.MP_MAX_CONCURRENCY_PER_ACCOUNT);
  const tokens =
    overrides.tokens ?? new MpTokenService({ prisma, redis, encryptor, mpApi, config, logger, events });
  return { config, logger, prisma, redis, encryptor, mpApi, events, guard, tokens };
}
