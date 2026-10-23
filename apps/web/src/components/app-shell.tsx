'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Permission } from '@adapterpay/shared';
import { Alert, Badge, Button, Select, Spinner, cn } from '@adapterpay/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useEventStream } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { BrandSignature, Logo } from './brand';

interface NavItem {
  href: string;
  label: string;
  perm?: Permission;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/app', label: 'Painel' },
  { href: '/app/cobrancas/nova', label: 'Nova cobrança', perm: 'charges:create' },
  { href: '/app/cobrancas', label: 'Cobranças', perm: 'charges:read' },
  { href: '/app/produtos', label: 'Produtos', perm: 'products:manage' },
  { href: '/app/clientes', label: 'Clientes', perm: 'loyalty:manage' },
  { href: '/app/lojas', label: 'Lojas', perm: 'stores:manage' },
  { href: '/app/pos', label: 'POS', perm: 'pos:manage' },
  { href: '/app/financeiro', label: 'Financeiro', perm: 'reports:read', adminOnly: true },
  { href: '/app/relatorios', label: 'Relatórios', perm: 'reports:read' },
  { href: '/app/usuarios', label: 'Usuários', perm: 'users:manage' },
  { href: '/app/integracoes/mercado-pago', label: 'Mercado Pago', perm: 'mp:manage' },
  { href: '/app/assinatura', label: 'Assinatura', perm: 'subscription:read' },
  { href: '/app/configuracoes', label: 'Configurações', perm: 'settings:manage' },
  { href: '/app/auditoria', label: 'Auditoria', perm: 'audit:read' },
];

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, can, reload } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ items: Notification[]; unread: number }>({ items: [], unread: 0 });

  const loadNotifs = useCallback(async () => {
    try {
      setNotifs(await api('/notifications'));
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    if (me?.tenant) void loadNotifs();
  }, [me?.tenant, loadNotifs]);

  useEventStream(me?.tenant ? '/api/v1/events/stream' : null, {
    message: (d) => {
      const ev = d as { type?: string };
      if (ev.type === 'notification.created') void loadNotifs();
      if (ev.type === 'subscription.updated') void reload();
      window.dispatchEvent(new CustomEvent('adapterpay:event', { detail: d }));
    },
  });

  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !me) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const items = NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.adminOnly || me.role === 'ADMIN'));
  const tenant = me.tenant;
  const sub = tenant?.subscription;
  const isActive = tenant?.status === 'ACTIVE' && sub?.status === 'ACTIVE';

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  };

  const switchTenant = async (tenantId: string) => {
    await api('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
    await reload();
    router.replace('/app');
  };

  const nav = (
    <nav aria-label="Painel" className="flex flex-col gap-0.5">
      {items.map((n) => {
        const active = n.href === '/app' ? pathname === '/app' : pathname === n.href || pathname.startsWith(`${n.href}/`);
        const exact = n.href === '/app/cobrancas' && pathname.startsWith('/app/cobrancas/nova');
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active && !exact ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium',
              active && !exact ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-ink',
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <Logo href="/app" />
        <div className="mt-6 flex-1 overflow-y-auto">{nav}</div>
        <BrandSignature className="mt-4" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
          <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Abrir menu">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M3 5h14v2H3V5Zm0 4h14v2H3V9Zm0 4h14v2H3v-2Z" /></svg>
          </button>
          <div className="lg:hidden"><Logo href="/app" /></div>
          <div className="ml-auto flex items-center gap-2">
            {me.memberships.length > 1 && tenant && (
              <Select aria-label="Empresa" className="hidden h-9 max-w-48 sm:block" value={tenant.id} onChange={(e) => void switchTenant(e.target.value)}>
                {me.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>{m.tradeName}</option>
                ))}
              </Select>
            )}
            {me.user.isSuperadmin && (
              <Link href="/superadmin"><Button size="sm" variant="ghost">Superadmin</Button></Link>
            )}
            <div className="relative">
              <button
                className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label={`Notificações${notifs.unread ? `, ${notifs.unread} não lidas` : ''}`}
                aria-expanded={notifOpen}
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M10 2a6 6 0 0 0-6 6v3.6l-1.7 2.6A1 1 0 0 0 3.1 16h13.8a1 1 0 0 0 .8-1.8L16 11.6V8a6 6 0 0 0-6-6Zm0 18a3 3 0 0 0 2.8-2H7.2A3 3 0 0 0 10 20Z" /></svg>
                {notifs.unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <p className="text-sm font-semibold">Notificações</p>
                    {notifs.unread > 0 && (
                      <button className="text-xs text-brand-700 hover:underline" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); void loadNotifs(); }}>
                        Marcar todas como lidas
                      </button>
                    )}
                  </div>
                  <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {notifs.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nenhuma notificação.</li>}
                    {notifs.items.map((n) => (
                      <li key={n.id} className={cn('px-4 py-3', !n.readAt && 'bg-brand-50/50')}>
                        <button
                          className="w-full text-left"
                          onClick={async () => {
                            if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
                            setNotifOpen(false);
                            void loadNotifs();
                            if (n.link) router.push(n.link);
                          }}
                        >
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                          <p className="mt-0.5 text-xs text-slate-600">{n.body}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{me.user.name}</p>
              <p className="text-xs leading-tight text-slate-500">{tenant?.tradeName}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={logout}>Sair</Button>
          </div>
        </header>

        {menuOpen && (
          <div className="no-print border-b border-slate-200 bg-white p-4 lg:hidden">
            {me.memberships.length > 1 && tenant && (
              <Select aria-label="Empresa" className="mb-3" value={tenant.id} onChange={(e) => void switchTenant(e.target.value)}>
                {me.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>{m.tradeName}</option>
                ))}
              </Select>
            )}
            {nav}
          </div>
        )}

        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {!tenant && <Alert tone="warning">Nenhuma empresa ativa vinculada ao seu usuário.</Alert>}
          {tenant && !isActive && (
            <Alert tone={tenant.status === 'PENDING_ACTIVATION' ? 'info' : 'danger'} className="no-print mb-6" title={tenant.status === 'PENDING_ACTIVATION' ? 'Conclua a contratação' : 'Assinatura inativa'}>
              {tenant.status === 'PENDING_ACTIVATION'
                ? 'O uso operacional é liberado após a confirmação do pagamento do plano.'
                : 'Novas cobranças e a ativação de POS estão bloqueadas. O histórico, as faturas e a conciliação continuam disponíveis.'}{' '}
              {can('subscription:manage') && (
                <Link href="/app/assinatura" className="font-semibold underline">Ir para Assinatura</Link>
              )}
            </Alert>
          )}
          {sub?.cancelAtPeriodEnd && isActive && (
            <Alert tone="warning" className="no-print mb-6">
              Assinatura cancelada: o acesso continua até {formatDateTime(sub.currentPeriodEnd)}.{' '}
              <Badge tone="warning">Sem renovação</Badge>
            </Alert>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
