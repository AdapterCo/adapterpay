import Link from 'next/link';
import { Logo } from '@/components/brand';

export default function NotFound() {
  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="max-w-md text-sm text-slate-600">O endereço pode estar incorreto, ter expirado ou ter sido substituído. Se você está pagando no caixa, peça ao vendedor uma nova cobrança.</p>
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">Voltar ao início</Link>
    </main>
  );
}
