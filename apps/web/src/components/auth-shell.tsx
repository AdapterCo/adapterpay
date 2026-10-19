import type { ReactNode } from 'react';
import { BrandSignature, Logo, SLOGAN } from './brand';

export function AuthShell({ title, subtitle, children, wide = false }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="px-4 py-5">
        <div className="mx-auto max-w-6xl">
          <Logo />
        </div>
      </header>
      <main id="conteudo" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8`}>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <footer className="px-4 pb-6 text-center">
        <p className="text-xs text-slate-500">{SLOGAN}</p>
        <BrandSignature />
      </footer>
    </div>
  );
}
