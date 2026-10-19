import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'https://adapterpay.adapterco.com.br'),
  title: { default: 'AdapterPay — Seu negócio recebe. Você acompanha.', template: '%s · AdapterPay' },
  description:
    'Pagamentos presenciais via Pix com QR Code e NFC, direto na sua conta Mercado Pago. Uma plataforma da Adapter Co.',
  applicationName: 'AdapterPay',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e8468',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Leitura dos headers torna a renderização dinâmica: o Next aplica o nonce da CSP (middleware) aos scripts.
  await headers();
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
