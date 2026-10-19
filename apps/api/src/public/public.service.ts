import { Inject, Injectable } from '@nestjs/common';
import type { CoreDeps } from '@adapterpay/core';
import type { Charge, PosTerminal, Store, Tenant } from '@adapterpay/database';
import { validateBrCode, type PublicActiveCharge, type PublicChargeView, type PublicPosView } from '@adapterpay/shared';
import { Errors } from '../common/errors';
import { CORE } from '../common/tokens';

/** Janela em que a página fixa ainda mostra o desfecho da última cobrança (pago/expirada). */
const RECENT_OUTCOME_MS = 60_000;

type PosWithRels = PosTerminal & { store: Store; tenant: Tenant };

/**
 * Visões PÚBLICAS — somente campos seguros: nome da loja/caixa, valor, prazo e BR Code do POS
 * enquanto a cobrança é a ativa. Sem IDs internos, dados do comprador, credenciais ou histórico.
 */
@Injectable()
export class PublicService {
  constructor(@Inject(CORE) private readonly deps: CoreDeps) {}

  private storeInfo(pos: PosWithRels) {
    return {
      storeName: pos.store.name,
      tradeName: pos.tenant.tradeName,
      logoUrl: pos.tenant.logoUrl,
      brandColor: pos.tenant.brandColor,
      posName: pos.name,
    };
  }

  private firstName(name: string | null | undefined): string | null {
    if (!name) return null;
    return name.trim().split(/\s+/)[0]!.slice(0, 40);
  }

  private chargeState(charge: (Charge & { seller: { name: string } }) | null, pos: PosTerminal, isCurrent: boolean): PublicActiveCharge {
    const now = new Date();
    const base: PublicActiveCharge = {
      state: 'WAITING',
      amountCents: null,
      description: null,
      sellerName: null,
      expiresAt: null,
      serverTime: now.toISOString(),
      pixCopyPaste: null,
      paidAt: null,
    };
    if (!charge) return base;
    const common = {
      ...base,
      amountCents: charge.amountCents,
      description: charge.description,
      sellerName: this.firstName(charge.seller.name),
    };
    switch (charge.status) {
      case 'PENDING': {
        const live = isCurrent && !!charge.expiresAt && charge.expiresAt.getTime() > now.getTime();
        const brOk = !!pos.qrCode && validateBrCode(pos.qrCode).valid;
        if (live && brOk) {
          return { ...common, state: 'PENDING', expiresAt: charge.expiresAt!.toISOString(), pixCopyPaste: pos.qrCode };
        }
        // Prazo informativo acabou: aguarda confirmação remota sem exibir o código.
        return { ...common, state: 'UNAVAILABLE' };
      }
      case 'PAID':
      case 'REFUNDED':
        return { ...common, state: 'PAID', paidAt: charge.paidAt?.toISOString() ?? null };
      case 'EXPIRED':
        return { ...common, state: 'EXPIRED' };
      case 'CANCELLED':
      case 'FAILED':
        return { ...common, state: 'CANCELLED' };
      case 'CREATING':
      case 'RECONCILING':
      default:
        return { ...common, state: 'UNAVAILABLE' };
    }
  }

  async posView(slug: string): Promise<{ view: PublicPosView; posId: string }> {
    if (!/^[a-z2-9]{20,40}$/.test(slug)) throw Errors.notFound('Página');
    const pos = await this.deps.prisma.posTerminal.findUnique({
      where: { publicSlug: slug },
      include: { store: true, tenant: true },
    });
    if (!pos || pos.status === 'INACTIVE' || pos.tenant.deletedAt) throw Errors.notFound('Página');

    let charge: (Charge & { seller: { name: string } }) | null = null;
    let isCurrent = false;
    if (pos.activeChargeId) {
      charge = await this.deps.prisma.charge.findUnique({ where: { id: pos.activeChargeId }, include: { seller: { select: { name: true } } } });
      isCurrent = true;
    } else {
      const recent = await this.deps.prisma.charge.findFirst({
        where: { posId: pos.id, terminalAt: { gte: new Date(Date.now() - RECENT_OUTCOME_MS) } },
        orderBy: { terminalAt: 'desc' },
        include: { seller: { select: { name: true } } },
      });
      charge = recent;
    }
    return { view: { ...this.storeInfo(pos), charge: this.chargeState(charge, pos, isCurrent) }, posId: pos.id };
  }

  /** Link individual: imutavelmente associado a UMA Order; nunca troca para a próxima cobrança do POS. */
  async chargeView(token: string): Promise<{ view: PublicChargeView; chargeId: string; posId: string }> {
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw Errors.notFound('Cobrança');
    const charge = await this.deps.prisma.charge.findUnique({
      where: { publicToken: token },
      include: { seller: { select: { name: true } }, pos: { include: { store: true, tenant: true } } },
    });
    if (!charge) throw Errors.notFound('Cobrança');
    const isCurrent = charge.pos.activeChargeId === charge.id;
    return {
      view: { ...this.storeInfo(charge.pos), charge: this.chargeState(charge, charge.pos, isCurrent) },
      chargeId: charge.id,
      posId: charge.posId,
    };
  }
}
