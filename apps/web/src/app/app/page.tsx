'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { formatBps, formatBRL } from '@adapterpay/shared';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, Stat, Table, Td, Th } from '@adapterpay/ui';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Dashboard {
  timezone: string;
  today: {
    paidCount: number;
    grossCents: number;
    feeCents: number | null;
    netCents: number | null;
    feeUnknownCount: number;
    activeCharges: number;
    expiredToday: number;
    reconciling: number;
  };
  savingsMonth: {
    grossCents: number;
    paidFeeCents: number;
    posFeeCents: number;
    linkFeeCents: number;
    savedVsPosCents: number;
    savedVsLinkCents: number;
    paidCount: number;
    feeUnknownCount: number;
    posRateBps: number;
    linkRateBps: number;
  };
  last30Days: {
    byStore: Array<{ id: string; name: string; paidCount: number; grossCents: number }>;
    byPos: Array<{ id: string; name: string; paidCount: number; grossCents: number }>;
    bySeller: Array<{ id: string; name: string; paidCount: number; grossCents: number }>;
    series: Array<{ day: string; grossCents: number; paidCount: number }>;
  };
}

interface Onboarding {
  subscriptionActive: boolean;
  steps: Array<{ key: string; done: boolean; href: string }>;
}

const STEP_LABELS: Record<string, string> = {
  subscription: 'Ativar a assinatura',
  mercado_pago: 'Conectar a conta Mercado Pago',
  stores: 'Cadastrar ou importar uma loja',
  pos: 'Criar ou importar um POS',
  public_qr: 'Gerar o QR público (placa/NFC)',
  first_charge: 'Fazer a primeira cobrança',
};

export default function DashboardPage() {
  const { me, can } = useSession();
  const dash = useApi<Dashboard>('/reports/dashboard');
  const onboarding = useApi<Onboarding>(me?.role === 'ADMIN' ? '/onboarding' : null);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string };
      if (d.type === 'charge.updated') void dash.reload();
    };
    window.addEventListener('adapterpay:event', h);
    return () => window.removeEventListener('adapterpay:event', h);
  }, [dash.reload]);

  const steps = onboarding.data?.steps ?? [];
  const pending = steps.filter((s) => !s.done);
  const max = Math.max(1, ...(dash.data?.last30Days.series.map((s) => s.grossCents) ?? [1]));

  return (
    <>
      <PageHeader
        title={`Olá, ${me?.user.name.split(' ')[0] ?? ''}`}
        description={me?.tenant?.tradeName}
        actions={can('charges:create') && <Link href="/app/cobrancas/nova"><Button>Nova cobrança</Button></Link>}
      />

      {pending.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Primeiros passos" description="Siga as etapas para começar a receber." />
          <CardBody>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.key}>
                  <Link href={s.href} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${s.done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 hover:border-brand-600'}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {s.done ? '✓' : i + 1}
                    </span>
                    {STEP_LABELS[s.key] ?? s.key}
                  </Link>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      {dash.loading && !dash.data && <Spinner className="h-6 w-6 text-brand-600" />}
      {dash.error && <Alert tone="danger">{dash.error.message}</Alert>}
      {dash.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Recebido hoje" value={formatBRL(dash.data.today.grossCents)} hint={`${dash.data.today.paidCount} pagamentos confirmados`} />
            <Stat
              label="Líquido hoje"
              value={dash.data.today.netCents === null ? '—' : formatBRL(dash.data.today.netCents)}
              hint={
                dash.data.today.feeCents === null
                  ? 'Tarifa ainda não informada pelo Mercado Pago'
                  : `Tarifa ${formatBRL(dash.data.today.feeCents)}${dash.data.today.feeUnknownCount ? ` · ${dash.data.today.feeUnknownCount} sem tarifa informada` : ''}`
              }
            />
            <Stat label="Cobranças ativas" value={dash.data.today.activeCharges} hint={`${dash.data.today.expiredToday} expiradas hoje`} />
            <Stat label="Em conciliação" value={dash.data.today.reconciling} tone={dash.data.today.reconciling > 0 ? 'warning' : 'default'} hint="Aguardando confirmação segura" />
          </div>

          {me?.role !== 'VENDEDOR' && dash.data.savingsMonth.paidCount > 0 && <SavingsCard s={dash.data.savingsMonth} />}

          <Card className="mt-6">
            <CardHeader title="Recebimentos — últimos 30 dias" />
            <CardBody>
              {dash.data.last30Days.series.length === 0 ? (
                <EmptyState title="Nenhum pagamento confirmado no período" />
              ) : (
                <div className="flex h-40 items-end gap-1" role="img" aria-label="Gráfico de recebimentos diários">
                  {dash.data.last30Days.series.map((s) => (
                    <div key={s.day} className="group relative flex-1">
                      <div className="rounded-t bg-brand-500 hover:bg-brand-600" style={{ height: `${Math.max(4, (s.grossCents / max) * 150)}px` }} />
                      <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-0.5 text-[11px] text-white group-hover:block">
                        {s.day.slice(8, 10)}/{s.day.slice(5, 7)} · {formatBRL(s.grossCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {([
              ['Por loja', dash.data.last30Days.byStore],
              ['Por POS', dash.data.last30Days.byPos],
              ['Por vendedor', dash.data.last30Days.bySeller],
            ] as const).map(([title, rows]) => (
              <Card key={title}>
                <CardHeader title={title} description="Últimos 30 dias" />
                {rows.length === 0 ? (
                  <EmptyState title="Sem dados" />
                ) : (
                  <Table>
                    <thead><tr><Th>Nome</Th><Th className="text-right">Qtde</Th><Th className="text-right">Bruto</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r) => (
                        <tr key={r.id}><Td>{r.name}</Td><Td className="text-right tabular-nums">{r.paidCount}</Td><Td className="text-right tabular-nums">{formatBRL(r.grossCents)}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Economia do mês: tarifa real paga nos Pix do AdapterPay contra Pix na maquininha e por link. */
function SavingsCard({ s }: { s: Dashboard['savingsMonth'] }) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-ink text-white" aria-labelledby="economia-titulo">
      <div className="grid gap-6 p-6 sm:grid-cols-[1.2fr_1fr] sm:items-center">
        <div>
          <h2 id="economia-titulo" className="text-sm text-white/70">Quanto você economizou este mês</h2>
          <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-emerald-300">{formatBRL(s.savedVsPosCents)}</p>
          <p className="mt-2 max-w-md text-sm text-white/75">
            Comparado ao Pix na maquininha ({formatBps(s.posRateBps)}), em {formatBRL(s.grossCents)} recebidos em {s.paidCount} vendas.
          </p>
        </div>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4 rounded-lg bg-white/5 px-3 py-2">
            <dt className="text-white/70">Tarifa paga no AdapterPay</dt>
            <dd className="tabular-nums">{formatBRL(s.paidFeeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 rounded-lg bg-white/5 px-3 py-2">
            <dt className="text-white/70">Pix na maquininha ({formatBps(s.posRateBps)})</dt>
            <dd className="tabular-nums">{formatBRL(s.posFeeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 rounded-lg bg-white/5 px-3 py-2">
            <dt className="text-white/70">Pix por link ({formatBps(s.linkRateBps)})</dt>
            <dd className="tabular-nums">{formatBRL(s.linkFeeCents)} · economia {formatBRL(s.savedVsLinkCents)}</dd>
          </div>
          {s.feeUnknownCount > 0 && (
            <p className="text-xs text-white/60">{s.feeUnknownCount} pagamento(s) ainda sem tarifa informada pelo Mercado Pago.</p>
          )}
        </dl>
      </div>
    </section>
  );
}
