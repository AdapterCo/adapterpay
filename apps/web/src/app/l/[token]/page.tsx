import type { Metadata } from 'next';
import { PaymentLinkPublic } from '@/components/payment-link-public';

export const metadata: Metadata = { title: 'Pagamento via Pix', robots: { index: false, follow: false } };

/** Link de pagamento externo enviado pela loja ao cliente (válido por 24 horas). */
export default async function PaymentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PaymentLinkPublic token={token} />;
}
