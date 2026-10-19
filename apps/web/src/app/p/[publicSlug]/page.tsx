import type { Metadata } from 'next';
import { PublicPayment } from '@/components/public-payment';

export const metadata: Metadata = { title: 'Pagamento Pix', robots: { index: false, follow: false } };

/** Página fixa do POS — destino do QR impresso na placa e da tag NFC. */
export default async function PosPublicPage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  return <PublicPayment kind="pos" id={publicSlug} />;
}
