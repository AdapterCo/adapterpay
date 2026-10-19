import { Inject, Injectable } from '@nestjs/common';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getUserMe,
  randomToken,
  sha256Hex,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import { isPgUniqueViolation } from '@adapterpay/database';
import { ERROR_CODES } from '@adapterpay/shared';
import { AppError, Errors } from '../../common/errors';
import type { AuthContext, RequestMeta } from '../../common/request';
import { CORE } from '../../common/tokens';

const STATE_TTL_MS = 10 * 60 * 1000;

export type CallbackOutcome = { ok: true; connectionId: string } | { ok: false; error: string };

@Injectable()
export class MercadoPagoService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  /** Cria `state` aleatório de uso único, associado a tenant/admin/sessão, e devolve a URL de autorização. */
  async startAuthorization(auth: AuthContext, connectionId?: string): Promise<string> {
    const tenantId = auth.tenantId!;
    if (connectionId) {
      const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id: connectionId, tenantId } });
      if (!conn) throw Errors.notFound('Conexão');
    }
    const state = randomToken(32);
    const codeVerifier = this.deps.config.MP_OAUTH_PKCE ? randomToken(48) : undefined;
    await this.deps.prisma.oAuthState.create({
      data: {
        stateHash: sha256Hex(state),
        tenantId,
        userId: auth.userId,
        sessionId: auth.sessionId,
        connectionId: connectionId ?? null,
        codeVerifierEnc: codeVerifier ? this.deps.encryptor.encrypt(codeVerifier) : null,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    return buildAuthorizationUrl({
      authBase: this.deps.config.MP_AUTH_BASE,
      clientId: this.deps.config.MP_CLIENT_ID,
      redirectUri: this.deps.config.MP_OAUTH_REDIRECT_URI,
      state,
      codeVerifier,
    });
  }

  /**
   * Callback OAuth: valida state (uso único, expiração, mesma sessão), troca o code no backend,
   * identifica a conta e grava tokens cifrados. Conflitos de propriedade são tratados explicitamente.
   */
  async handleCallback(params: {
    code?: string;
    state?: string;
    error?: string;
    auth?: AuthContext;
    meta: RequestMeta;
  }): Promise<CallbackOutcome> {
    if (!params.state) return { ok: false, error: 'state_missing' };
    const row = await this.deps.prisma.oAuthState.findUnique({ where: { stateHash: sha256Hex(params.state) } });
    if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return { ok: false, error: 'state_invalid' };
    if (!params.auth || params.auth.sessionId !== row.sessionId) return { ok: false, error: 'session_mismatch' };
    const consumed = await this.deps.prisma.oAuthState.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return { ok: false, error: 'state_reused' };
    if (params.error) return { ok: false, error: `denied_${params.error}`.slice(0, 60) };
    if (!params.code) return { ok: false, error: 'code_missing' };

    const tokens = await exchangeAuthorizationCode(this.deps.mpApi, {
      clientId: this.deps.config.MP_CLIENT_ID,
      clientSecret: this.deps.config.MP_CLIENT_SECRET,
      code: params.code,
      redirectUri: this.deps.config.MP_OAUTH_REDIRECT_URI,
      codeVerifier: row.codeVerifierEnc ? this.deps.encryptor.decrypt(row.codeVerifierEnc) : undefined,
    }).catch((err) => {
      this.deps.logger.warn({ err: (err as Error).message }, 'falha na troca do authorization code');
      return null;
    });
    if (!tokens?.access_token || tokens.user_id === undefined) return { ok: false, error: 'token_exchange_failed' };

    const me = await getUserMe(this.deps.mpApi, tokens.access_token).catch(() => null);
    const mpUserId = String(tokens.user_id);
    if (me && String(me.id) !== mpUserId) return { ok: false, error: 'identity_mismatch' };

    // Conta já pertence a OUTRO tenant (conexão não desconectada): conflito explícito.
    const owner = await this.deps.prisma.mpConnection.findFirst({
      where: { mpUserId, status: { not: 'DISCONNECTED' }, tenantId: { not: row.tenantId } },
    });
    if (owner) {
      await writeAudit(this.deps.prisma, {
        tenantId: row.tenantId,
        actorUserId: row.userId,
        actorType: 'USER',
        resourceType: 'mp_connection',
        action: 'mp.connect_conflict',
        after: { mpUserId },
        ip: params.meta.ip,
        correlationId: params.meta.correlationId,
      });
      return { ok: false, error: 'account_in_use' };
    }

    if (row.connectionId) {
      const target = await this.deps.prisma.mpConnection.findUniqueOrThrow({ where: { id: row.connectionId } });
      if (target.mpUserId !== mpUserId) return { ok: false, error: 'account_mismatch' };
    }

    const data = {
      nickname: me?.nickname ?? null,
      email: me?.email ?? null,
      accessTokenEnc: this.deps.encryptor.encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? this.deps.encryptor.encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      scopes: tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : [],
      liveMode: tokens.live_mode ?? null,
      status: 'ACTIVE' as const,
      lastError: null,
      lastTestedAt: new Date(),
      connectedById: row.userId,
    };

    try {
      const existing = await this.deps.prisma.mpConnection.findUnique({
        where: { tenantId_mpUserId: { tenantId: row.tenantId, mpUserId } },
      });
      const conn = existing
        ? await this.deps.prisma.mpConnection.update({ where: { id: existing.id }, data })
        : await this.deps.prisma.mpConnection.create({ data: { ...data, tenantId: row.tenantId, mpUserId } });
      await writeAudit(this.deps.prisma, {
        tenantId: row.tenantId,
        actorUserId: row.userId,
        actorType: 'USER',
        resourceType: 'mp_connection',
        resourceId: conn.id,
        action: existing ? 'mp.reconnected' : 'mp.connected',
        after: { mpUserId, nickname: data.nickname, scopes: data.scopes, liveMode: data.liveMode },
        ip: params.meta.ip,
        correlationId: params.meta.correlationId,
      });
      return { ok: true, connectionId: conn.id };
    } catch (err) {
      if (isPgUniqueViolation(err)) return { ok: false, error: 'account_in_use' };
      throw err;
    }
  }

  async list(tenantId: string) {
    const conns = await this.deps.prisma.mpConnection.findMany({
      where: { tenantId, status: { not: 'DISCONNECTED' } },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { stores: true, posTerminals: true } } },
    });
    // Nunca retornar tokens.
    return conns.map((c) => ({
      id: c.id,
      mpUserId: c.mpUserId,
      nickname: c.nickname,
      email: c.email,
      scopes: c.scopes,
      liveMode: c.liveMode,
      status: c.status,
      tokenExpiresAt: c.tokenExpiresAt,
      lastSyncAt: c.lastSyncAt,
      lastTestedAt: c.lastTestedAt,
      lastError: c.lastError,
      storeCount: c._count.stores,
      posCount: c._count.posTerminals,
      createdAt: c.createdAt,
    }));
  }

  async test(tenantId: string, id: string) {
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id, tenantId } });
    if (!conn) throw Errors.notFound('Conexão');
    const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
    const me = await getUserMe(this.deps.mpApi, accessToken);
    if (String(me.id) !== conn.mpUserId) {
      await this.deps.tokens.markNeedsReconnect(conn.id, tenantId, 'identidade divergente no teste');
      throw new AppError(409, ERROR_CODES.MP_RECONNECT_REQUIRED, 'A conta autorizada mudou; reconecte.');
    }
    await this.deps.prisma.mpConnection.update({
      where: { id: conn.id },
      data: { lastTestedAt: new Date(), nickname: me.nickname ?? conn.nickname, email: me.email ?? conn.email, lastError: null },
    });
    return { ok: true, mpUserId: conn.mpUserId, nickname: me.nickname ?? null };
  }

  /** Desconexão segura: bloqueada com cobranças ativas; POS ativos exigem confirmação explícita. */
  async disconnect(auth: AuthContext, id: string, confirm: boolean, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id, tenantId } });
    if (!conn || conn.status === 'DISCONNECTED') throw Errors.notFound('Conexão');
    const activeCharges = await this.deps.prisma.charge.count({
      where: { mpConnectionId: id, status: { in: ['CREATING', 'PENDING', 'RECONCILING'] } },
    });
    if (activeCharges > 0) {
      throw Errors.conflict('Há cobranças em andamento nesta conta. Aguarde a conciliação antes de desconectar.', { activeCharges });
    }
    const activePos = await this.deps.prisma.posTerminal.count({ where: { mpConnectionId: id, status: 'ACTIVE' } });
    if (activePos > 0 && !confirm) {
      throw Errors.conflict('Existem POS ativos nesta conta. Confirme para desativá-los e desconectar.', { activePos });
    }
    await this.deps.prisma.$transaction(async (tx) => {
      await tx.posTerminal.updateMany({ where: { mpConnectionId: id, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
      await tx.mpConnection.update({
        where: { id },
        data: {
          status: 'DISCONNECTED',
          accessTokenEnc: this.deps.encryptor.encrypt(''),
          refreshTokenEnc: null,
          tokenExpiresAt: null,
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'mp_connection',
        resourceId: id,
        action: 'mp.disconnected',
        after: { deactivatedPos: activePos },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
    });
    return { ok: true, deactivatedPos: activePos };
  }
}
