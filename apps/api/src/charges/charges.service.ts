import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  applyChargeTransition,
  assertTenantOperational,
  cancelOrder,
  getOrder,
  isPosOrderReady,
  MpApiError,
  randomToken,
  submitOrder,
  localDayHour,
  writeAudit,
  type CoreDeps,
} from '@adapterpay/core';
import { isPgUniqueViolation, isUniqueViolation, type ChargeStatus, type Prisma } from '@adapterpay/database';
import { cartDescription, cartTotalCents, ERROR_CODES, evaluateOrder, MAX_CHARGE_CENTS, type CartLine, type CreateChargeInput, type listChargesQuerySchema } from '@adapterpay/shared';
import type { z } from 'zod';
import { assertStoreAccess, storeScope } from '../common/access';
import { AppError, Errors } from '../common/errors';
import { QueueService } from '../common/queue.service';
import type { AuthContext, RequestMeta } from '../common/request';
import { CORE } from '../common/tokens';

type ListQuery = z.infer<typeof listChargesQuerySchema>;

const ACTIVE: ChargeStatus[] = ['CREATING', 'PENDING', 'RECONCILING'];

function newExternalReference(): string {
  return `ADAPTERPAY_${randomToken(15).replace(/[^A-Za-z0-9]/g, '').slice(0, 20).toUpperCase()}`;
}

@Injectable()
export class ChargesService {
  private readonly apiWorkerId = `api-${process.pid}-${randomToken(4)}`;

  constructor(
    @Inject(CORE) private readonly deps: CoreDeps,
    private readonly queue: QueueService,
  ) {}

  publicChargeUrl(token: string): string {
    return new URL(`/c/${token}`, this.deps.config.APP_URL).toString();
  }

  /**
   * Fluxo principal (seção 8): valida assinatura/limites/permissões/OAuth/POS, reserva o POS
   * com exclusão mútua (lock + índice parcial), cria CREATING com referência e chave idempotente,
   * chama a Orders API e grava PENDING. O worker acompanha até o estado final.
   */
  async create(
    auth: AuthContext,
    input: CreateChargeInput,
    clientRequestId: string | undefined,
    meta: RequestMeta,
    opts: { totemId?: string; tableBillId?: string; description?: string } = {},
  ) {
    const tenantId = auth.tenantId!;
    if (clientRequestId !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(clientRequestId)) {
      throw Errors.validation('Idempotency-Key inválida');
    }
    if (clientRequestId) {
      const prior = await this.deps.prisma.charge.findUnique({ where: { tenantId_clientRequestId: { tenantId, clientRequestId } } });
      if (prior) {
        if (prior.posId !== input.posId || prior.amountCents !== input.amountCents) {
          throw Errors.conflict('Idempotency-Key reutilizada com dados diferentes');
        }
        return this.detail(auth, prior.id);
      }
    }

    const pos = await this.deps.prisma.posTerminal.findFirst({
      where: { id: input.posId, tenantId },
      include: { mpConnection: true, store: true },
    });
    if (!pos) throw Errors.notFound('POS');
    assertStoreAccess(auth, pos.storeId);
    if (pos.store.status !== 'ACTIVE') throw new AppError(422, ERROR_CODES.POS_INACTIVE, 'A loja deste POS está inativa');
    const ready = isPosOrderReady(pos);
    if (!ready.ready) {
      throw new AppError(422, ready.reason === 'POS_INACTIVE' ? ERROR_CODES.POS_INACTIVE : ERROR_CODES.POS_NOT_ORDER_READY, `POS indisponível para cobrança (${ready.reason})`);
    }
    if (pos.mpConnection.status !== 'ACTIVE') {
      throw new AppError(409, ERROR_CODES.MP_RECONNECT_REQUIRED, 'A conta Mercado Pago deste POS precisa ser reconectada');
    }
    // POS de mesa ou de totem só recebe cobranças da própria mesa/totem (não conflita com o balcão).
    if (!opts.tableBillId) {
      const table = await this.deps.prisma.restaurantTable.findFirst({ where: { posId: pos.id, status: 'ACTIVE' }, select: { name: true } });
      if (table) throw new AppError(422, ERROR_CODES.POS_INACTIVE, `Este POS é da ${table.name}. Use a tela de Mesas.`);
    }
    if (!opts.totemId) {
      const totem = await this.deps.prisma.totemDevice.findFirst({ where: { posId: pos.id, status: 'ACTIVE' }, select: { name: true } });
      if (totem) throw new AppError(422, ERROR_CODES.POS_INACTIVE, `Este POS é do totem "${totem.name}".`);
    }

    // Fidelidade: cliente identificado no caixa e, opcionalmente, um código de cashback como desconto.
    let loyaltyCustomerId: string | null = null;
    let reward: { id: string; valueCents: number } | null = null;
    if (input.loyalty) {
      const tenant = await this.deps.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { loyaltyMode: true } });
      if (tenant.loyaltyMode === 'OFF') throw Errors.validation('A fidelidade está desligada nas configurações');
      const customer = await this.deps.prisma.loyaltyCustomer.findFirst({ where: { id: input.loyalty.customerId, tenantId }, select: { id: true } });
      if (!customer) throw Errors.notFound('Cliente');
      loyaltyCustomerId = customer.id;
      if (input.loyalty.rewardCode) {
        const r = await this.deps.prisma.loyaltyReward.findFirst({
          where: { tenantId, customerId: customer.id, code: input.loyalty.rewardCode, kind: 'CASHBACK', status: 'AVAILABLE' },
          select: { id: true, valueCents: true },
        });
        if (!r?.valueCents) throw Errors.validation('Código de cashback inválido ou já usado');
        reward = { id: r.id, valueCents: r.valueCents };
      }
    }
    const discount = reward?.valueCents ?? 0;

    // Carrinho do catálogo: preços SEMPRE do servidor; o total enviado precisa bater com o recalculado.
    let lines: Array<CartLine & { productId: string }> = [];
    if (input.items?.length) {
      const products = await this.deps.prisma.product.findMany({
        where: { tenantId, active: true, id: { in: input.items.map((i) => i.productId) } },
        select: { id: true, name: true, priceCents: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      if (byId.size !== input.items.length) {
        throw Errors.validation('Um ou mais produtos do carrinho não estão mais disponíveis. Atualize o catálogo.');
      }
      lines = input.items.map((i) => {
        const p = byId.get(i.productId)!;
        return { productId: p.id, name: p.name, unitPriceCents: p.priceCents, quantity: i.quantity };
      });
      const total = cartTotalCents(lines);
      if (total > MAX_CHARGE_CENTS) throw Errors.validation('Total do carrinho acima do limite por cobrança');
      if (discount >= total) throw Errors.validation('O cashback vale mais que esta compra. Use o código numa compra maior.');
      if (total - discount !== input.amountCents) {
        throw new AppError(409, ERROR_CODES.CONFLICT, 'Os preços do catálogo mudaram. Confira o total e gere a cobrança de novo.', { amountCents: total - discount });
      }
    }
    const description = opts.description ?? (input.description || (lines.length ? cartDescription(lines) : null));

    let chargeId: string;
    try {
      chargeId = await this.deps.prisma.$transaction(async (tx) => {
        await assertTenantOperational(tx, tenantId);
        await tx.$queryRaw`SELECT id FROM pos_terminals WHERE id = ${pos.id}::uuid FOR UPDATE`;
        const locked = await tx.posTerminal.findUniqueOrThrow({ where: { id: pos.id } });
        if (locked.status !== 'ACTIVE') throw new AppError(422, ERROR_CODES.POS_INACTIVE, 'POS inativo');
        if (locked.activeChargeId) await this.throwPosBusy(tx, locked.activeChargeId);
        if (locked.externalId !== pos.externalId) throw Errors.conflict('POS alterado durante a operação; tente novamente');

        // Número do pedido do dia na loja (retirada/cozinha): pedidos com itens do catálogo ou do totem.
        let orderNumber: number | null = null;
        if (lines.length > 0 || opts.totemId) {
          const day = localDayHour(new Date(), pos.store.timezone).day;
          const counter = await tx.$queryRaw<Array<{ last: number }>>`
            INSERT INTO order_counters (store_id, day, last) VALUES (${pos.storeId}::uuid, ${day}, 1)
            ON CONFLICT (store_id, day) DO UPDATE SET last = order_counters.last + 1
            RETURNING last`;
          orderNumber = counter[0]!.last;
        }

        const charge = await tx.charge.create({
          data: {
            tenantId,
            storeId: pos.storeId,
            posId: pos.id,
            sellerId: auth.userId,
            mpConnectionId: pos.mpConnectionId,
            externalReference: newExternalReference(),
            idempotencyKey: randomUUID(),
            clientRequestId: clientRequestId ?? null,
            externalPosId: pos.externalId!,
            amountCents: input.amountCents,
            description,
            status: 'CREATING',
            publicToken: randomToken(24),
            loyaltyCustomerId,
            loyaltyRewardId: reward?.id ?? null,
            discountCents: discount,
            totemId: opts.totemId ?? null,
            tableBillId: opts.tableBillId ?? null,
            orderNumber,
          },
        });
        if (reward) {
          // Reserva o código para esta cobrança; volta a ficar disponível se ela não for paga.
          const reserved = await tx.loyaltyReward.updateMany({
            where: { id: reward.id, status: 'AVAILABLE' },
            data: { status: 'RESERVED', reservedChargeId: charge.id },
          });
          if (reserved.count !== 1) throw Errors.conflict('Este código de cashback acabou de ser usado em outra cobrança');
        }
        if (lines.length) {
          await tx.chargeItem.createMany({
            data: lines.map((l) => ({ chargeId: charge.id, productId: l.productId, name: l.name, unitPriceCents: l.unitPriceCents, quantity: l.quantity })),
          });
        }
        await tx.posTerminal.update({ where: { id: pos.id }, data: { activeChargeId: charge.id } });
        // Job de polling já nasce com lease da API; se a API cair antes do envio, o worker reconcilia.
        await tx.pollingJob.create({
          data: {
            chargeId: charge.id,
            nextAttemptAt: new Date(Date.now() + 20_000),
            leaseOwner: this.apiWorkerId,
            leaseUntil: new Date(Date.now() + 30_000),
          },
        });
        await tx.paymentEvent.create({ data: { chargeId: charge.id, newState: 'CREATING', reason: 'CHARGE_CREATED' } });
        await writeAudit(tx, {
          tenantId,
          actorUserId: auth.userId,
          actorType: 'USER',
          resourceType: 'charge',
          resourceId: charge.id,
          action: 'charge.created',
          after: { posId: pos.id, amountCents: input.amountCents, externalReference: charge.externalReference },
          ip: meta.ip,
          correlationId: meta.correlationId,
        });
        return charge.id;
      });
    } catch (err) {
      // Duas requisições simultâneas com a mesma Idempotency-Key: a segunda devolve a cobrança da primeira.
      // O nome do alvo em P2002 varia (campo ou coluna); a existência da cobrança com a mesma chave confirma o caso.
      if (clientRequestId && isUniqueViolation(err)) {
        const prior = await this.deps.prisma.charge.findUnique({ where: { tenantId_clientRequestId: { tenantId, clientRequestId } } });
        if (prior) {
          if (prior.posId !== input.posId || prior.amountCents !== input.amountCents) {
            throw Errors.conflict('Idempotency-Key reutilizada com dados diferentes');
          }
          return this.detail(auth, prior.id);
        }
      }
      if (isPgUniqueViolation(err, 'charges_one_active_per_pos') || isPgUniqueViolation(err, 'active_charge_id')) {
        const busy = await this.deps.prisma.posTerminal.findUnique({ where: { id: pos.id } });
        if (busy?.activeChargeId) await this.throwPosBusy(this.deps.prisma, busy.activeChargeId);
        throw new AppError(409, ERROR_CODES.POS_BUSY, 'POS ocupado com outra cobrança');
      }
      throw err;
    }

    let outcome;
    try {
      outcome = await submitOrder(this.deps, chargeId);
    } finally {
      await this.deps.prisma.pollingJob.updateMany({
        where: { chargeId, leaseOwner: this.apiWorkerId },
        data: { leaseOwner: null, leaseUntil: null },
      });
    }
    if (outcome.kind !== 'FAILED') {
      await this.queue.enqueuePoll(chargeId, this.deps.config.POLL_INTERVAL_SECONDS * 1000).catch((err) => {
        // O sweeper do worker cobre falhas de enfileiramento (polling_jobs.next_attempt_at).
        this.deps.logger.warn({ chargeId, err: (err as Error).message }, 'falha ao enfileirar polling');
      });
    }
    const view = await this.detail(auth, chargeId);
    if (outcome.kind === 'FAILED') {
      throw new AppError(502, ERROR_CODES.MP_UPSTREAM_ERROR, 'O Mercado Pago recusou a criação da cobrança. O POS foi liberado.', {
        chargeId,
        reason: outcome.reason,
      });
    }
    return view;
  }

  private async throwPosBusy(db: Prisma.TransactionClient | CoreDeps['prisma'], activeChargeId: string): Promise<never> {
    const active = await db.charge.findUnique({
      where: { id: activeChargeId },
      select: { id: true, externalReference: true, expiresAt: true, status: true, amountCents: true },
    });
    const remaining = active?.expiresAt ? Math.max(0, Math.ceil((active.expiresAt.getTime() - Date.now()) / 1000)) : null;
    throw new AppError(409, ERROR_CODES.POS_BUSY, 'Este POS já tem uma cobrança ativa. Use outro POS ou aguarde.', {
      chargeId: active?.id ?? activeChargeId,
      reference: active?.externalReference ?? null,
      status: active?.status ?? null,
      remainingSeconds: remaining,
    });
  }

  async list(auth: AuthContext, q: ListQuery) {
    const tenantId = auth.tenantId!;
    const where: Prisma.ChargeWhereInput = {
      tenantId,
      ...storeScope(auth),
      ...(q.storeId ? { storeId: q.storeId } : {}),
      ...(q.posId ? { posId: q.posId } : {}),
      ...(q.sellerId ? { sellerId: q.sellerId } : {}),
      ...(q.status ? { status: q.status as ChargeStatus } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { externalReference: { contains: q.q, mode: 'insensitive' } },
              { orderId: { contains: q.q } },
              { description: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // VENDEDOR consulta só as vendas das últimas 24 h nas lojas autorizadas; um `from` mais antigo não amplia a janela.
    if (auth.role === 'VENDEDOR') {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const from = q.from ? new Date(q.from) : null;
      where.createdAt = { gte: from && from > since ? from : since, ...(q.to ? { lte: new Date(q.to) } : {}) };
    }
    const [total, items] = await Promise.all([
      this.deps.prisma.charge.count({ where }),
      this.deps.prisma.charge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          pos: { select: { name: true } },
          store: { select: { name: true } },
          seller: { select: { name: true } },
          payments: { select: { feeCents: true, netAmountCents: true, paidAmountCents: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: items.map((c) => ({
        id: c.id,
        status: c.status,
        statusReason: c.statusReason,
        amountCents: c.amountCents,
        description: c.description,
        externalReference: c.externalReference,
        orderId: c.orderId,
        posId: c.posId,
        posName: c.pos.name,
        storeId: c.storeId,
        storeName: c.store.name,
        sellerName: c.seller.name,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
        paidAt: c.paidAt,
        feeCents: c.payments[0]?.feeCents ?? null,
        netAmountCents: c.payments[0]?.netAmountCents ?? null,
      })),
    };
  }

  async detail(auth: AuthContext, id: string) {
    const c = await this.deps.prisma.charge.findFirst({
      where: { id, tenantId: auth.tenantId! },
      include: {
        pos: { select: { name: true, publicSlug: true } },
        store: { select: { name: true } },
        seller: { select: { id: true, name: true } },
        payments: true,
        events: { orderBy: { occurredAt: 'asc' }, select: { previousState: true, newState: true, reason: true, occurredAt: true } },
        items: { select: { name: true, unitPriceCents: true, quantity: true } },
        loyaltyCustomer: { select: { name: true } },
      },
    });
    if (!c) throw Errors.notFound('Cobrança');
    assertStoreAccess(auth, c.storeId);
    return {
      id: c.id,
      status: c.status,
      statusReason: c.statusReason,
      amountCents: c.amountCents,
      currency: c.currency,
      description: c.description,
      externalReference: c.externalReference,
      orderId: c.orderId,
      mpPaymentId: c.mpPaymentId,
      posId: c.posId,
      posName: c.pos.name,
      storeId: c.storeId,
      storeName: c.store.name,
      seller: c.seller,
      createdAt: c.createdAt,
      mpCreatedAt: c.mpCreatedAt,
      expiresAt: c.expiresAt,
      paidAt: c.paidAt,
      terminalAt: c.terminalAt,
      lastPolledAt: c.lastPolledAt,
      serverTime: new Date().toISOString(),
      publicChargeUrl: this.publicChargeUrl(c.publicToken),
      publicPosUrl: new URL(`/p/${c.pos.publicSlug}`, this.deps.config.APP_URL).toString(),
      payments: c.payments.map((p) => ({
        mpPaymentId: p.mpPaymentId,
        mpReferenceId: p.mpReferenceId,
        amountCents: p.amountCents,
        paidAmountCents: p.paidAmountCents,
        feeCents: p.feeCents,
        netAmountCents: p.netAmountCents,
        method: p.method,
        status: p.status,
        statusDetail: p.statusDetail,
        confirmedAt: p.confirmedAt,
        refundedAt: p.refundedAt,
      })),
      events: c.events,
      items: c.items,
      discountCents: c.discountCents,
      loyaltyCustomerName: c.loyaltyCustomer?.name ?? null,
      orderNumber: c.orderNumber,
      fulfillmentStatus: c.fulfillmentStatus,
    };
  }

  async status(auth: AuthContext, id: string) {
    const c = await this.deps.prisma.charge.findFirst({
      where: { id, tenantId: auth.tenantId! },
      select: { id: true, status: true, storeId: true, expiresAt: true, paidAt: true, statusReason: true },
    });
    if (!c) throw Errors.notFound('Cobrança');
    assertStoreAccess(auth, c.storeId);
    return { id: c.id, status: c.status, statusReason: c.statusReason, expiresAt: c.expiresAt, paidAt: c.paidAt, serverTime: new Date().toISOString() };
  }

  /**
   * Cancelamento manual: somente via operação remota e confirmado por GET da Order.
   * Nunca libera o POS por cancelamento apenas local.
   */
  async cancel(auth: AuthContext, id: string, meta: RequestMeta) {
    const tenantId = auth.tenantId!;
    const c = await this.deps.prisma.charge.findFirst({
      where: { id, tenantId },
      include: { tenant: { select: { allowSellerCancel: true } }, mpConnection: { select: { mpUserId: true } } },
    });
    if (!c) throw Errors.notFound('Cobrança');
    assertStoreAccess(auth, c.storeId);
    if (auth.role === 'VENDEDOR' && (c.sellerId !== auth.userId || !c.tenant.allowSellerCancel)) {
      throw Errors.forbidden('Cancelamento não permitido para este usuário');
    }
    if (!ACTIVE.includes(c.status) || !c.orderId) throw Errors.conflict('Somente cobranças pendentes com Order criada podem ser canceladas');

    await this.deps.prisma.charge.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    const { accessToken } = await this.deps.tokens.getAccessToken(c.mpConnectionId);
    try {
      await this.deps.guard.run(c.mpConnectionId, () => cancelOrder(this.deps.mpApi, accessToken, c.orderId!, `cancel-${c.id}`));
    } catch (err) {
      if (err instanceof MpApiError && err.definitiveClientError) {
        throw new AppError(409, ERROR_CODES.MP_UNSUPPORTED_OPERATION, 'O Mercado Pago não aceitou o cancelamento desta Order. Aguarde a expiração.', {
          providerStatus: err.status,
        });
      }
      throw err;
    }
    const order = await this.deps.guard.run(c.mpConnectionId, () => getOrder(this.deps.mpApi, accessToken, c.orderId!));
    const evaluation = evaluateOrder(
      {
        orderId: c.orderId,
        externalReference: c.externalReference,
        amountCents: c.amountCents,
        externalPosId: c.externalPosId,
        mpUserId: c.mpConnection.mpUserId,
        requiredPaymentMethodId: 'pix',
      },
      order,
    );
    if (evaluation.decision === 'CANCELLED' || evaluation.decision === 'PAID') {
      await applyChargeTransition(this.deps.prisma, this.deps.events, {
        chargeId: id,
        target: evaluation.decision,
        reasons: evaluation.decision === 'CANCELLED' ? ['MANUAL_CANCEL_CONFIRMED'] : evaluation.reasons,
        payment: evaluation.payment,
        providerPayload: order,
      });
    }
    await writeAudit(this.deps.prisma, {
      tenantId,
      actorUserId: auth.userId,
      actorType: 'USER',
      resourceType: 'charge',
      resourceId: id,
      action: 'charge.cancel_requested',
      after: { remoteDecision: evaluation.decision },
      ip: meta.ip,
      correlationId: meta.correlationId,
    });
    if (evaluation.decision !== 'CANCELLED' && evaluation.decision !== 'PAID') {
      throw new AppError(409, ERROR_CODES.MP_UNSUPPORTED_OPERATION, 'Cancelamento não confirmado pelo Mercado Pago. A cobrança segue em acompanhamento.', {
        remoteDecision: evaluation.decision,
      });
    }
    return this.detail(auth, id);
  }
}
