import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CoreDeps } from '@adapterpay/core';
import { ERROR_CODES } from '@adapterpay/shared';
import { CORE } from './tokens';
import { AppError } from './errors';
import type { AppRequest } from './request';

export interface RateLimitRule {
  key: string;
  limit: number;
  windowSec: number;
  by?: 'ip' | 'user' | 'ip+param';
  param?: string;
}

const RATE_LIMIT_KEY = 'ap:rate_limit';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);

@Injectable()
export class RateLimitService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  /** Janela fixa via INCR/EXPIRE. Retorna segundos para nova tentativa quando excedido. */
  async hit(bucket: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfter: number }> {
    const key = `ap:rl:${bucket}`;
    const n = await this.deps.redis.incr(key);
    if (n === 1) await this.deps.redis.expire(key, windowSec);
    if (n > limit) {
      const ttl = await this.deps.redis.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSec };
    }
    return { allowed: true, retryAfter: 0 };
  }

  async enforce(bucket: string, limit: number, windowSec: number): Promise<void> {
    const r = await this.hit(bucket, limit, windowSec);
    if (!r.allowed) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Muitas tentativas. Aguarde e tente novamente.', undefined, {
        'Retry-After': String(r.retryAfter),
      });
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    for (const rule of rules) {
      let subject = req.ip ?? 'unknown';
      if (rule.by === 'user') subject = req.auth?.userId ?? subject;
      if (rule.by === 'ip+param' && rule.param) subject = `${subject}:${String(req.params?.[rule.param] ?? '')}`;
      await this.limiter.enforce(`${rule.key}:${subject}`, rule.limit, rule.windowSec);
    }
    return true;
  }
}
