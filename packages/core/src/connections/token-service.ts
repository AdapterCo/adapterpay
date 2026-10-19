import type { PrismaClient } from '@adapterpay/database';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../config';
import type { Encryptor } from '../crypto';
import type { EventPublisher } from '../events';
import type { Logger } from '../logger';
import { MpApiError, type MercadoPagoHttp, refreshAccessToken } from '../mercado-pago';
import { createNotification } from '../notifications';
import { acquireLockWait, releaseLock } from '../redis';

export class MpReconnectRequiredError extends Error {
  constructor(readonly connectionId: string, reason: string) {
    super(`Conexão Mercado Pago requer reconexão: ${reason}`);
    this.name = 'MpReconnectRequiredError';
  }
}

const REFRESH_MARGIN_MS = 24 * 3600 * 1000; // renova com 24h de antecedência

/**
 * Acesso aos tokens dos LOJISTAS. Tokens são decifrados apenas em memória, no momento do uso,
 * e nunca retornados ao frontend nem registrados em logs.
 * Renovação serializada por lock distribuído e releitura da linha (tolerante a concorrência).
 */
export class MpTokenService {
  constructor(
    private readonly d: {
      prisma: PrismaClient;
      redis: Redis;
      encryptor: Encryptor;
      mpApi: MercadoPagoHttp;
      config: AppConfig;
      logger: Logger;
      events: EventPublisher;
    },
  ) {}

  async getAccessToken(connectionId: string): Promise<{ accessToken: string; mpUserId: string }> {
    const conn = await this.d.prisma.mpConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new MpReconnectRequiredError(connectionId, 'conexão inexistente');
    if (conn.status !== 'ACTIVE') throw new MpReconnectRequiredError(connectionId, conn.status);
    if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS) {
      return this.refresh(connectionId);
    }
    return { accessToken: this.d.encryptor.decrypt(conn.accessTokenEnc), mpUserId: conn.mpUserId };
  }

  /** Renova o token. Se outro processo já renovou, apenas retorna o novo valor. */
  async refresh(connectionId: string, force = false): Promise<{ accessToken: string; mpUserId: string }> {
    const lockKey = `ap:lock:mp-refresh:${connectionId}`;
    const token = await acquireLockWait(this.d.redis, lockKey, 30_000, 15_000);
    if (!token) throw new Error('Não foi possível obter lock de renovação de token');
    try {
      const conn = await this.d.prisma.mpConnection.findUniqueOrThrow({ where: { id: connectionId } });
      if (conn.status !== 'ACTIVE') throw new MpReconnectRequiredError(connectionId, conn.status);
      const stillValid = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() >= REFRESH_MARGIN_MS;
      if (stillValid && !force) {
        return { accessToken: this.d.encryptor.decrypt(conn.accessTokenEnc), mpUserId: conn.mpUserId };
      }
      if (!conn.refreshTokenEnc) {
        await this.markNeedsReconnect(connectionId, conn.tenantId, 'refresh_token ausente');
        throw new MpReconnectRequiredError(connectionId, 'refresh_token ausente');
      }
      let res;
      try {
        res = await refreshAccessToken(this.d.mpApi, {
          clientId: this.d.config.MP_CLIENT_ID,
          clientSecret: this.d.config.MP_CLIENT_SECRET,
          refreshToken: this.d.encryptor.decrypt(conn.refreshTokenEnc),
        });
      } catch (err) {
        if (err instanceof MpApiError && (err.status === 400 || err.status === 401 || err.status === 403)) {
          await this.markNeedsReconnect(connectionId, conn.tenantId, `refresh negado (${err.providerCode ?? err.status})`);
          throw new MpReconnectRequiredError(connectionId, 'refresh negado');
        }
        throw err;
      }
      if (String(res.user_id) !== conn.mpUserId) {
        await this.markNeedsReconnect(connectionId, conn.tenantId, 'refresh retornou outra conta');
        throw new MpReconnectRequiredError(connectionId, 'conta divergente');
      }
      await this.d.prisma.mpConnection.update({
        where: { id: connectionId },
        data: {
          accessTokenEnc: this.d.encryptor.encrypt(res.access_token),
          refreshTokenEnc: res.refresh_token ? this.d.encryptor.encrypt(res.refresh_token) : conn.refreshTokenEnc,
          tokenExpiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
          scopes: res.scope ? res.scope.split(/[\s,]+/).filter(Boolean) : conn.scopes,
          lastError: null,
        },
      });
      this.d.logger.info({ connectionId }, 'token MP renovado');
      return { accessToken: res.access_token, mpUserId: conn.mpUserId };
    } finally {
      await releaseLock(this.d.redis, lockKey, token);
    }
  }

  /** Chamado quando o provedor responde 401 em uso normal: tenta uma renovação forçada. */
  async handleUnauthorized(connectionId: string): Promise<{ accessToken: string; mpUserId: string }> {
    return this.refresh(connectionId, true);
  }

  async markNeedsReconnect(connectionId: string, tenantId: string, reason: string): Promise<void> {
    const updated = await this.d.prisma.mpConnection.updateMany({
      where: { id: connectionId, status: 'ACTIVE' },
      data: { status: 'NEEDS_RECONNECT', lastError: reason.slice(0, 300) },
    });
    if (updated.count > 0) {
      this.d.logger.warn({ connectionId, reason }, 'conexão MP requer reconexão');
      await createNotification(this.d.prisma, this.d.events, {
        tenantId,
        kind: 'mp.reconnect_required',
        title: 'Reconecte sua conta Mercado Pago',
        body: 'A autorização da conta Mercado Pago foi revogada ou expirou. Novas cobranças ficam bloqueadas até a reconexão.',
        link: '/app/integracoes/mercado-pago',
      });
    }
  }
}
