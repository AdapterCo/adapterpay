import type { Metadata, Viewport } from 'next';
import { Sora } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

// Sora: geométrica, terminais arredondados (conversa com o wordmark). Auto-hospedada pelo Next (CSP font-src self).
const sora = Sora({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sora', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'https://adapterpay.adapterco.com.br'),
  title: { default: 'AdapterPay — Seu negócio recebe. Você acompanha.', template: '%s · AdapterPay' },
  description:
    'Pagamentos presenciais via Pix com QR Code e NFC, direto na sua conta Mercado Pago. Uma plataforma da Adapter Co.',
  applicationName: 'AdapterPay',
  icons: { icon: '/brand/adapterpay-mark.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#005efe',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Leitura dos headers torna a renderização dinâmica: o Next aplica o nonce da CSP (middleware) aos scripts.
  await headers();
  return (
    <html lang="pt-BR" className={sora.variable}>
      <body className="min-h-dvh">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
