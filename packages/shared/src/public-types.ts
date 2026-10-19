/**
 * Formatos das respostas PÚBLICAS (/api/v1/public/*). Contêm somente campos seguros:
 * sem IDs internos, sem dados do comprador, sem credenciais, sem histórico.
 */

export type PublicChargeState = 'WAITING' | 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'UNAVAILABLE';

export interface PublicStoreInfo {
  storeName: string;
  tradeName: string;
  logoUrl: string | null;
  brandColor: string | null;
}

export interface PublicActiveCharge {
  state: PublicChargeState;
  amountCents: number | null;
  description: string | null;
  sellerName: string | null;
  /** Instante de expiração calculado pelo backend (ISO). O cronômetro do cliente é apenas informativo. */
  expiresAt: string | null;
  serverTime: string;
  /** BR Code do POS (qr_response.qr_code) — presente somente enquanto a cobrança está PENDING. */
  pixCopyPaste: string | null;
  paidAt: string | null;
}

export interface PublicPosView extends PublicStoreInfo {
  posName: string;
  charge: PublicActiveCharge;
}

export interface PublicChargeView extends PublicStoreInfo {
  posName: string;
  charge: PublicActiveCharge;
}
