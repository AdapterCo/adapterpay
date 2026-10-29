'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge, Button, Spinner, cn } from '@adapterpay/ui';
import { Logo } from '@/components/brand';
import { CriticalProvider } from '@/components/critical';
import { api } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

const NAV = [
  { href: '/superadmin', label: 'Operação' },
  { href: '/superadmin/tenants', label: 'Tenants' },
  { href: '/superadmin/assinaturas', label: 'Assinaturas e pagamentos' },
  { href: '/superadmin/planos', label: 'Planos e preços' },
  { href: '/superadmin/parceiros', label: 'Parceiros' },
  { href: '/superadmin/auditoria', label: 'Auditoria' },
];

function Shell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  if (loading || !me?.user.isSuperadmin) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  }
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="rounded bg-white px-2 py-1"><Logo href="/superadmin" /></div>
          <Badge tone="warning">Superadmin · Adapter Co.</Badge>
          <nav aria-label="Superadmin" className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname === n.href ? 'page' : undefined}
                className={cn('rounded-md px-3 py-1.5 text-sm', pathname === n.href || (n.href !== '/superadmin' && pathname.startsWith(n.href)) ? 'bg-white/15' : 'text-white/80 hover:bg-white/10')}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden sm:inline">{me.user.email}</span>
            <Button size="sm" variant="secondary" onClick={async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); router.replace('/login'); }}>Sair</Button>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

export default function SuperadminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider requireSuperadmin>
      <CriticalProvider>
        <Shell>{children}</Shell>
      </CriticalProvider>
    </SessionProvider>
  );
}
