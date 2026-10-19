'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Button, Card } from '@adapterpay/ui';
import { BrandSignature, Logo, SLOGAN } from './brand';

export function MarketingHeader() {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-3">
          <Link href="/planos" className="hidden rounded-md px-3 py-2 text-sm text-slate-600 hover:text-ink sm:inline">
            Planos
          </Link>
          <Link href="/#como-funciona" className="hidden rounded-md px-3 py-2 text-sm text-slate-600 hover:text-ink md:inline">
            Como funciona
          </Link>
          <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:text-ink">
            Entrar
          </Link>
          <Link href="/planos">
            <Button size="sm">Contratar</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-2 text-sm text-slate-600">{SLOGAN}</p>
          <BrandSignature className="mt-1" />
        </div>
        <nav aria-label="Rodapé" className="flex flex-wrap gap-4 text-sm text-slate-600">
          <Link href="/planos" className="hover:text-ink">Planos</Link>
          <Link href="/termos" className="hover:text-ink">Termos de uso</Link>
          <Link href="/privacidade" className="hover:text-ink">Política de privacidade</Link>
          <Link href="/login" className="hover:text-ink">Entrar</Link>
        </nav>
      </div>
    </footer>
  );
}

interface PublicPlan {
  id: string;
  name: string;
  priceCents: number;
  maxPos: number;
  maxStores: number;
  maxUsers: number;
}

/** Planos carregados da API (fonte de verdade: tabela plans). */
export function PlansGrid() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/v1/plans', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fail'))))
      .then((p: PublicPlan[]) => setPlans(p))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-center text-sm text-slate-500">Não foi possível carregar os planos agora. Tente novamente em instantes.</p>;
  if (!plans) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p, i) => (
        <Card key={p.id} className={`flex flex-col p-5 ${i === 1 ? 'ring-2 ring-brand-600' : ''}`}>
          <h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="mt-2">
            <span className="text-3xl font-bold tabular-nums">{formatBRL(p.priceCents)}</span>
            <span className="text-sm text-slate-500">/mês</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            <li>{p.maxPos} {p.maxPos === 1 ? 'POS ativo' : 'POS ativos'}</li>
            <li>{p.maxStores} {p.maxStores === 1 ? 'loja ativa' : 'lojas ativas'}</li>
            <li>{p.maxUsers} usuários ativos</li>
            <li>Sem comissão do AdapterPay por venda</li>
          </ul>
          <div className="mt-auto pt-5">
            <Link href={`/cadastro?plano=${p.id}`}>
              <Button className="w-full" variant={i === 1 ? 'primary' : 'secondary'}>
                Contratar {p.name}
              </Button>
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
