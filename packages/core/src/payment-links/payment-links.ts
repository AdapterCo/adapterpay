import { randomUUID } from 'node:crypto';
import type { PaymentLink } from '@adapterpay/database';
import { firstName, formatBRL, normalizeSearchName, PAYMENT_LINK_TTL_MS, tryDecimalStringToCents } from '@adapterpay/shared';
import { writeAudit } from '../audit';
import { paymentFees } from '../charges/fees';
import type { CoreDeps } from '../context';
import { randomToken } from '../crypto';
import { assertTenantOperational } from '../limits';
import { cancelPayment, createStorePixPayment, getPayment, MpApiError, type MpPayment } from '../mercado-pago';
import { createNotification } from '../notifications';

/**
 * Links de pagamento externos (Pix avulso na conta MP da loja, válido por 24 h).
 *
 * Ciclo: PENDING -> PAID | EXPIRED | CANCELLED. O pagamento é confirmado por polling
 * (worker + consulta sob demanda quando o cliente ou o lojista abre o link). Antes de marcar
 * EXPIRED ou CANCELLED o Pix é consultado de novo, para não perder um pagamento de última hora.
 */

export class PaymentLinkError extends Error {
  constructor(
    readonly code: 'STORE_NOT_FOUND' | 'STORE_NOT_CONNECTED' | 'PROVIDER_ERROR' | 'NOT_PENDING' | 'ALREADY_PAID',
    message: string,
  ) {
    super(message);
  }
}

/** Depois do vencimento, ainda consultamos por este tempo antes de dar o link como expirado. */
const EXPIRY_GRACE_MS = 2 * 60_000;

/** Ritmo do polling: rápido logo após o envio (quando a maioria paga), depois mais espaçado. */
export function nextPaymentLinkPollMs(createdAt: Date, now = Date.now()): number {
  const age = now - createdAt.getTime();
  if (age < 15 * 60_000) return 15_000;
  if (age < 2 * 3600_000) return 60_000;
  return 5 * 60_000;
}

function newExternalReference(): string {
  return `ADAPTERPAY_LINK_${randomToken(15).replace(/[^A-Za-z0-9]/g, '').slice(0, 20).toUpperCase()}`;
}

/** O MP exige e-mail do pagador no Pix; o cliente do lojista não informa, então usamos um endereço técnico do domínio. */
function payerEmail(deps: CoreDeps): string {
  return `pix@${new URL(deps.config.APP_URL).hostname}`;
}

export async function createPaymentLink(
  deps: CoreDeps,
  p: {
    tenantId: string;
    storeId: string;
    createdById: string;
    customerName: string;
    customerPhone?: string | null;
    description?: string | null;
    amountCents: number;
  },
): Promise<PaymentLink> {
  const store = await deps.prisma.store.findFirst({
    where: { id: p.storeId, tenantId: p.tenantId, status: 'ACTIVE' },
    select: { id: true, mpConnectionId: true, tenant: { select: { tradeName: true } } },
  });
  if (!store) throw new PaymentLinkError('STORE_NOT_FOUND', 'Loja não encontrada');
  if (!store.mpConnectionId) {
    throw new PaymentLinkError('STORE_NOT_CONNECTED', 'Esta loja não está vinculada a uma conta Mercado Pago');
  }
  await deps.prisma.$transaction((tx) => assertTenantOperational(tx, p.tenantId));

  const id = randomUUID();
  const externalReference = newExternalReference();
  const expiresAt = new Date(Date.now() + PAYMENT_LINK_TTL_MS);
  const description = (p.description?.trim() || `Pagamento a ${store.tenant.tradeName}`).slice(0, 140);
  const connectionId = store.mpConnectionId;

  const { accessToken } = await deps.tokens.getAccessToken(connectionId);
  let payment: MpPayment;
  try {
    payment = await deps.guard.run(connectionId, () =>
      createStorePixPayment(deps.mpApi, accessToken, {
        amountCents: p.amountCents,
        description,
        externalReference,
        payerEmail: payerEmail(deps),
        payerFirstName: firstName(p.customerName).slice(0, 60) || 'Cliente',
        expiresAt,
        idempotencyKey: id,
      }),
    );
  } catch (err) {
    deps.logger.warn({ tenantId: p.tenantId, err: (err as Error).message }, 'MP recusou o Pix do link de pagamento');
    throw new PaymentLinkError('PROVIDER_ERROR', 'O Mercado Pago não gerou o Pix. Confira a conexão da loja e tente de novo.');
  }
  const qr = payment.point_of_interaction?.transaction_data?.qr_code;
  if (!payment.id || !qr) throw new PaymentLinkError('PROVIDER_ERROR', 'O Mercado Pago não devolveu o código Pix');

  try {
    return await deps.prisma.paymentLink.create({
      data: {
        id,
        tenantId: p.tenantId,
        storeId: store.id,
        mpConnectionId: connectionId,
        createdById: p.createdById,
        customerName: p.customerName.trim(),
        customerSearch: normalizeSearchName(p.customerName),
        customerPhone: p.customerPhone ?? null,
        description: p.description?.trim() || null,
        amountCents: p.amountCents,
        externalReference,
        publicToken: randomToken(24),
        mpPaymentId: String(payment.id),
        pixCopyPaste: qr,
        providerStatus: payment.status ?? null,
        expiresAt,
        nextPollAt: new Date(Date.now() + 15_000),
      },
    });
  } catch (err) {
    // Sem registro no banco o Pix ficaria órfão e pagável: cancela no provedor antes de falhar.
    await cancelPayment(deps.mpApi, accessToken, String(payment.id)).catch(() => undefined);
    throw err;
  }
}

/** Pagamento aprovado e coerente com o link (valor, moeda, referência e ID). */
export function isApprovedPaymentForLink(payment: MpPayment, link: Pick<PaymentLink, 'externalReference' | 'amountCents' | 'mpPaymentId'>): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (payment.status !== 'approved') reasons.push(`STATUS_${payment.status ?? 'none'}`);
  if (payment.currency_id && payment.currency_id !== 'BRL') reasons.push('CURRENCY');
  if (payment.external_reference !== link.externalReference) reasons.push('EXTERNAL_REFERENCE');
  if (tryDecimalStringToCents(payment.transaction_amount) !== link.amountCents) reasons.push('AMOUNT');
  if (String(payment.id) !== link.mpPaymentId) reasons.push('PAYMENT_ID');
  return { ok: reasons.length === 0, reasons };
}

function parseDate(v: string | null | undefined): Date {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Marca como pago uma única vez (condicional em PENDING) e avisa a loja. */
async function markPaid(deps: CoreDeps, link: PaymentLink, payment: MpPayment): Promise<void> {
  const fees = paymentFees(payment);
  const updated = await deps.prisma.paymentLink.updateMany({
    where: { id: link.id, status: 'PENDING' },
    data: {
      status: 'PAID',
      paidAt: parseDate(payment.date_approved),
      providerStatus: payment.status ?? 'approved',
      feeCents: fees.feeCents,
      netAmountCents: fees.netAmountCents,
      nextPollAt: null,
      lastPolledAt: new Date(),
      lastError: null,
    },
  });
  if (updated.count !== 1) return;
  await writeAudit(deps.prisma, {
    tenantId: link.tenantId,
    actorType: 'WORKER',
    resourceType: 'payment_link',
    resourceId: link.id,
    action: 'payment_link.paid',
    after: { amountCents: link.amountCents, mpPaymentId: link.mpPaymentId },
  });
  await createNotification(deps.prisma, deps.events, {
    tenantId: link.tenantId,
    kind: 'payment_link.paid',
    title: `Link pago: ${link.customerName}`,
    body: `${link.customerName} pagou ${formatBRL(link.amountCents)}${link.description ? ` (${link.description})` : ''}.`,
    link: '/app/links',
  });
}

/**
 * Consulta o Pix do link e aplica o resultado. Idempotente; seguro para o worker e para
 * consultas sob demanda em paralelo (todas as transições são condicionais em PENDING).
 */
export async function pollPaymentLink(deps: CoreDeps, linkId: string): Promise<PaymentLink> {
  const link = await deps.prisma.paymentLink.findUniqueOrThrow({ where: { id: linkId } });
  if (link.status !== 'PENDING' || !link.mpPaymentId) return link;

  let payment: MpPayment;
  try {
    const { accessToken } = await deps.tokens.getAccessToken(link.mpConnectionId);
    payment = await deps.guard.run(link.mpConnectionId, () => getPayment(deps.mpApi, accessToken, link.mpPaymentId!));
  } catch (err) {
    return deps.prisma.paymentLink.update({
      where: { id: link.id },
      data: { lastError: (err as Error).message.slice(0, 300), lastPolledAt: new Date(), nextPollAt: new Date(Date.now() + 60_000) },
    });
  }

  const valid = isApprovedPaymentForLink(payment, link);
  if (valid.ok) {
    await markPaid(deps, link, payment);
    return deps.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
  }

  const now = Date.now();
  const providerClosed = ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(payment.status ?? '');
  const expired = now > link.expiresAt.getTime() + EXPIRY_GRACE_MS;
  if (providerClosed || expired) {
    await deps.prisma.paymentLink.updateMany({
      where: { id: link.id, status: 'PENDING' },
      data: { status: 'EXPIRED', providerStatus: payment.status ?? null, nextPollAt: null, lastPolledAt: new Date(), lastError: null },
    });
    return deps.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
  }

  const pastDue = now > link.expiresAt.getTime();
  return deps.prisma.paymentLink.update({
    where: { id: link.id },
    data: {
      providerStatus: payment.status ?? null,
      lastPolledAt: new Date(),
      lastError: payment.status === 'approved' ? `APPROVED_BUT_INVALID:${valid.reasons.join(',')}` : null,
      nextPollAt: new Date(now + (pastDue ? 30_000 : nextPaymentLinkPollMs(link.createdAt, now))),
    },
  });
}

/** Consulta sob demanda (página pública aberta, painel), no máximo a cada `minIntervalMs`. */
export async function refreshPaymentLinkIfStale(deps: CoreDeps, link: PaymentLink, minIntervalMs = 5_000): Promise<PaymentLink> {
  if (link.status !== 'PENDING') return link;
  if (link.lastPolledAt && Date.now() - link.lastPolledAt.getTime() < minIntervalMs) return link;
  return pollPaymentLink(deps, link.id);
}

/** Cancela no MP e no banco. Se o cliente pagou nesse meio-tempo, o link fica PAID e o cancelamento é recusado. */
export async function cancelPaymentLink(deps: CoreDeps, linkId: string): Promise<PaymentLink> {
  const link = await deps.prisma.paymentLink.findUniqueOrThrow({ where: { id: linkId } });
  if (link.status !== 'PENDING') throw new PaymentLinkError('NOT_PENDING', 'Este link não está mais em aberto');
  if (link.mpPaymentId) {
    const { accessToken } = await deps.tokens.getAccessToken(link.mpConnectionId);
    try {
      await deps.guard.run(link.mpConnectionId, () => cancelPayment(deps.mpApi, accessToken, link.mpPaymentId!));
    } catch (err) {
      // Já expirado/cancelado/aprovado no provedor responde 400/404; a consulta abaixo decide.
      if (!(err instanceof MpApiError && (err.status === 400 || err.status === 404))) throw err;
    }
    const remote = await deps.guard.run(link.mpConnectionId, () => getPayment(deps.mpApi, accessToken, link.mpPaymentId!));
    if (isApprovedPaymentForLink(remote, link).ok) {
      await markPaid(deps, link, remote);
      throw new PaymentLinkError('ALREADY_PAID', 'O cliente acabou de pagar este link');
    }
  }
  const updated = await deps.prisma.paymentLink.updateMany({
    where: { id: link.id, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: new Date(), nextPollAt: null },
  });
  if (updated.count !== 1) throw new PaymentLinkError('NOT_PENDING', 'Este link não está mais em aberto');
  return deps.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
}

/** Job do worker: consulta os links em aberto cujo próximo polling venceu. */
export async function runPaymentLinkPolls(deps: CoreDeps, limit = 100): Promise<number> {
  const due = await deps.prisma.paymentLink.findMany({
    where: { status: 'PENDING', nextPollAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { nextPollAt: 'asc' },
    take: limit,
  });
  for (const l of due) {
    await pollPaymentLink(deps, l.id).catch((err) => deps.logger.warn({ paymentLinkId: l.id, err: (err as Error).message }, 'poll de link de pagamento falhou'));
  }
  return due.length;
}
