import type { Metadata } from 'next';
import { PublicPayment } from '@/components/public-payment';

export const metadata: Metadata = { title: 'Cobrança Pix', robots: { index: false, follow: false } };

/** Link individual: representa somente a Order original; nunca troca para a próxima cobrança do POS. */
export default async function ChargePublicPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  return <PublicPayment kind="charge" id={publicToken} />;
}
