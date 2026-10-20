import { Inject, Injectable } from '@nestjs/common';
import {
  assertCanActivate,
  assertTenantOperational,
  collectAllPages,
  createStore as createRemoteStore,
  PlanLimitError,
  randomToken,
  searchStores,
  syncPos,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import { isUniqueViolation, type Prisma } from '@adapterpay/database';
import { normalizeStateName, type createStoreSchema, type importStoresConfirmSchema, type updateStoreSchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { storeIdScope } from '../common/access';
import { Errors } from '../common/errors';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';

type CreateInput = z.infer<typeof createStoreSchema>;
type UpdateInput = z.infer<typeof updateStoreSchema>;
type ImportInput = z.infer<typeof importStoresConfirmSchema>;

@Injectable()
export class StoresService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  async list(auth: AuthContext) {
    const stores = await this.deps.prisma.store.findMany({
      where: { tenantId: auth.tenantId!, ...storeIdScope(auth) },
      orderBy: { createdAt: 'asc' },
      include: {
        mpConnection: { select: { id: true, nickname: true, mpUserId: true, status: true } },
        _count: { select: { posTerminals: true } },
      },
    });
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      timezone: s.timezone,
      status: s.status,
      mpStoreId: s.mpStoreId,
      mpConnection: s.mpConnection,
      posCount: s._count.posTerminals,
      lastSyncAt: s.lastSyncAt,
      syncError: s.syncError,
      createdAt: s.createdAt,
    }));
  }

  private async getConnection(tenantId: string, id: string) {
    const conn = await this.deps.prisma.mpConnection.findFirst({ where: { id, tenantId, status: { not: 'DISCONNECTED' } } });
    if (!conn) throw Errors.notFound('Conexão Mercado Pago');
    return conn;
  }

  async create(auth: AuthContext, input: CreateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    if (input.mpConnectionId) await this.getConnection(tenantId, input.mpConnectionId);
    if (input.createRemote && (!input.mpConnectionId || !input.address)) {
      throw Errors.validation('Para criar a loja no Mercado Pago informe a conexão e o endereço completo');
    }
    if (input.createRemote && (input.address?.latitude === undefined || input.address?.longitude === undefined)) {
      throw Errors.validation('O Mercado Pago exige as coordenadas (latitude e longitude) da loja');
    }
    if (input.address) {
      // O MP só aceita o nome completo do estado ("São Paulo"); "SP" ou nome sem acento são convertidos.
      const stateName = normalizeStateName(input.address.stateName);
      if (stateName) input = { ...input, address: { ...input.address, stateName } };
      else if (input.createRemote) throw Errors.validation('Estado inválido. Escolha um estado da lista');
    }
    const wantsActive = input.activate && !input.createRemote;

    const store = await this.deps.prisma.$transaction(async (tx) => {
      if (wantsActive) await assertCanActivate(tx, tenantId, 'stores');
      else await assertTenantOperational(tx, tenantId);
      const s = await tx.store.create({
        data: {
          tenantId,
          name: input.name,
          address: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
          timezone: input.timezone,
          mpConnectionId: input.mpConnectionId ?? null,
          status: wantsActive ? 'ACTIVE' : 'INACTIVE',
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'store',
        resourceId: s.id,
        action: 'store.created',
        after: { name: s.name, status: s.status },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return s;
    });

    if (!input.createRemote) return store;

    // Fluxo A, passo 3: cria a loja correspondente no MP (contrato a validar — docs/mercado-pago.md).
    const conn = await this.getConnection(tenantId, input.mpConnectionId!);
    const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
    const externalId = `AP${randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase()}`;
    const a = input.address!;
    try {
      const remote = await this.deps.guard.run(conn.id, () =>
        createRemoteStore(
          this.deps.mpApi,
          accessToken,
          conn.mpUserId,
          {
            name: input.name,
            external_id: externalId,
            location: {
              street_number: a.streetNumber,
              street_name: a.streetName,
              city_name: a.cityName,
              state_name: a.stateName,
              latitude: a.latitude,
              longitude: a.longitude,
              reference: a.reference,
            },
          },
          `store-${store.id}`,
        ),
      );
      return this.deps.prisma.$transaction(async (tx) => {
        if (input.activate) await assertCanActivate(tx, tenantId, 'stores');
        return tx.store.update({
          where: { id: store.id },
          data: {
            mpStoreId: String(remote.id),
            mpExternalId: remote.external_id ?? externalId,
            status: input.activate ? 'ACTIVE' : 'INACTIVE',
            lastSyncAt: new Date(),
          },
        });
      });
    } catch (err) {
      await this.deps.prisma.store.update({
        where: { id: store.id },
        data: { syncError: `Falha ao criar no Mercado Pago: ${(err as Error).message}`.slice(0, 300) },
      });
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    return this.deps.prisma.$transaction(async (tx) => {
      const store = await tx.store.findFirst({ where: { id, tenantId } });
      if (!store) throw Errors.notFound('Loja');
      if (input.mpConnectionId) await this.getConnection(tenantId, input.mpConnectionId);

      if (input.mpConnectionId !== undefined && input.mpConnectionId !== store.mpConnectionId) {
        const mismatched = await tx.posTerminal.count({
          where: { storeId: id, status: 'ACTIVE', mpConnectionId: { not: input.mpConnectionId ?? undefined } },
        });
        if (mismatched > 0) throw Errors.conflict('Há POS ativos vinculados a outra conta Mercado Pago nesta loja');
      }
      if (input.status === 'ACTIVE' && store.status !== 'ACTIVE') await assertCanActivate(tx, tenantId, 'stores');
      if (input.status === 'INACTIVE' && store.status === 'ACTIVE') {
        const activePos = await tx.posTerminal.count({ where: { storeId: id, status: 'ACTIVE' } });
        if (activePos > 0) throw Errors.conflict('Desative os POS da loja antes de desativá-la', { activePos });
      }
      const updated = await tx.store.update({
        where: { id },
        data: {
          name: input.name,
          address: input.address as Prisma.InputJsonValue | undefined,
          timezone: input.timezone,
          mpConnectionId: input.mpConnectionId,
          status: input.status,
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorUserId: auth.userId,
        actorType: 'USER',
        resourceType: 'store',
        resourceId: id,
        action: 'store.updated',
        before: { name: store.name, status: store.status, mpConnectionId: store.mpConnectionId },
        after: { name: updated.name, status: updated.status, mpConnectionId: updated.mpConnectionId },
        ip: meta.ip,
        correlationId: meta.correlationId,
      });
      return updated;
    });
  }

  /** Fluxo B: lista lojas remotas disponíveis à conta, marcando já importadas. */
  async importPreview(auth: AuthContext, mpConnectionId: string) {
    const tenantId = auth.tenantId!;
    const conn = await this.getConnection(tenantId, mpConnectionId);
    const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
    const remote = await collectAllPages((offset, limit) =>
      this.deps.guard.run(conn.id, () => searchStores(this.deps.mpApi, accessToken, conn.mpUserId, { offset, limit })),
    );
    const local = await this.deps.prisma.store.findMany({
      where: { tenantId, mpConnectionId: conn.id, mpStoreId: { not: null } },
      select: { id: true, name: true, mpStoreId: true },
    });
    const byRemote = new Map(local.map((s) => [s.mpStoreId!, s]));
    return remote.map((r) => ({
      mpStoreId: String(r.id),
      name: r.name ?? `Loja ${r.id}`,
      externalId: r.external_id ?? null,
      location: r.location ?? null,
      importedAs: byRemote.get(String(r.id)) ?? null,
    }));
  }

  async importConfirm(auth: AuthContext, input: ImportInput, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const conn = await this.getConnection(tenantId, input.mpConnectionId);
    const preview = await this.importPreview(auth, conn.id);
    const available = new Map(preview.map((p) => [p.mpStoreId, p]));
    const results: Array<{ mpStoreId: string; storeId?: string; status: string; error?: string }> = [];

    for (const item of input.items) {
      const remote = available.get(item.mpStoreId);
      if (!remote) {
        results.push({ mpStoreId: item.mpStoreId, status: 'error', error: 'Loja não encontrada na conta' });
        continue;
      }
      if (remote.importedAs) {
        results.push({ mpStoreId: item.mpStoreId, storeId: remote.importedAs.id, status: 'already_imported' });
        continue;
      }
      try {
        const store = await this.deps.prisma.$transaction(async (tx) => {
          let activate = item.activate;
          if (activate) {
            try {
              await assertCanActivate(tx, tenantId, 'stores');
            } catch (err) {
              if (!(err instanceof PlanLimitError)) throw err;
              activate = false; // importa inativa para revisão quando o limite não permite
            }
          } else {
            await assertTenantOperational(tx, tenantId);
          }
          if (item.storeId) {
            const target = await tx.store.findFirst({ where: { id: item.storeId, tenantId } });
            if (!target) throw Errors.notFound('Loja interna');
            if (target.mpStoreId && target.mpStoreId !== item.mpStoreId) throw Errors.conflict('Loja interna já vinculada a outra loja remota');
            return tx.store.update({
              where: { id: target.id },
              data: { mpStoreId: item.mpStoreId, mpExternalId: remote.externalId, mpConnectionId: conn.id, lastSyncAt: new Date() },
            });
          }
          return tx.store.create({
            data: {
              tenantId,
              name: remote.name.slice(0, 120),
              mpStoreId: item.mpStoreId,
              mpExternalId: remote.externalId,
              mpConnectionId: conn.id,
              status: activate ? 'ACTIVE' : 'INACTIVE',
              lastSyncAt: new Date(),
            },
          });
        });
        results.push({ mpStoreId: item.mpStoreId, storeId: store.id, status: store.status === 'ACTIVE' ? 'imported_active' : 'imported_inactive' });
      } catch (err) {
        const msg = isUniqueViolation(err) ? 'Loja já importada' : (err as Error).message;
        results.push({ mpStoreId: item.mpStoreId, status: 'error', error: msg.slice(0, 200) });
      }
    }
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'store',
      action: 'store.imported',
      after: { connectionId: conn.id, results },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    return { results };
  }

  async sync(auth: AuthContext, id: string, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const store = await this.deps.prisma.store.findFirst({ where: { id, tenantId }, include: { posTerminals: true } });
    if (!store) throw Errors.notFound('Loja');
    const divergences: string[] = [];
    if (store.mpConnectionId && store.mpStoreId) {
      const conn = await this.getConnection(tenantId, store.mpConnectionId);
      const { accessToken } = await this.deps.tokens.getAccessToken(conn.id);
      const remote = await collectAllPages((offset, limit) =>
        this.deps.guard.run(conn.id, () => searchStores(this.deps.mpApi, accessToken, conn.mpUserId, { offset, limit })),
      );
      if (!remote.some((r) => String(r.id) === store.mpStoreId)) divergences.push('REMOTE_STORE_MISSING');
    }
    const posResults = [];
    for (const pos of store.posTerminals) {
      try {
        posResults.push({ posId: pos.id, ...(await syncPos(this.deps, pos.id, { userId: auth.userId, correlationId: meta.correlationId })) });
      } catch (err) {
        posResults.push({ posId: pos.id, error: (err as Error).message.slice(0, 200) });
      }
    }
    await this.deps.prisma.store.update({
      where: { id },
      data: { lastSyncAt: new Date(), syncError: divergences.length ? divergences.join(',') : null },
    });
    return { divergences, pos: posResults };
  }
}
