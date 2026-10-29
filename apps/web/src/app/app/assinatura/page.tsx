'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatBRL, subscriptionMonthlyCents } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { InvoicePix } from '@/components/invoice-pix';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, SUBSCRIPTION_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  maxPos: number;
  maxStores: number;
  maxUsers: number;
  totemPriceCents?: number | null;
}

interface Current {
  tenantStatus: string;
  suspendedReason: string | null;
  subscription: null | {
    status: string;
    method: 'PIX' | 'CARD' | null;
    plan: Plan;
    scheduledPlan: Plan | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    preapprovalStatus: string | null;
    totemQuantity: number;
  };
  usage: { pos: number; stores: number; users: number };
  limits: { pos: number; stores: number; users: number } | null;
  openInvoices: Array<{ id: string; kind: string; amountCents: number; creditAppliedCents: number; dueAt: string; method: string }>;
  billingTimezone: string;
  creditCents: number;
}

const KIND: Record<string, string> = { INITIAL: 'Contratação', RENEWAL: 'Renovação', UPGRADE: 'Upgrade (pró-rata)' };

export default function SubscriptionPage() {
  const { can, reload: reloadSession } = useSession();
  const critical = useCritical();
  const cur = useApi<Current>('/subscriptions/current');
  const plans = useApi<Plan[]>('/plans');
  const invoices = useApi<Array<{ id: string; kind: string; status: string; method: string; amountCents: number; creditAppliedCents: number; dueAt: string; paidAt: string | null; planName: string }>>('/subscriptions/invoices');
  const [payInvoice, setPayInvoice] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadAll = async () => {
    await Promise.all([cur.reload(), invoices.reload(), reloadSession()]);
  };

  const changePlan = async (planId: string) => {
    setBusy(planId);
    setError(null);
    setMsg(null);
    try {
      const r = await critical(() => api<{ kind: string; invoice?: { id: string }; effectiveAt?: string }>('/subscriptions/change-plan', { method: 'POST', body: { planId } }));
      if (r.kind === 'upgrade' && r.invoice) {
        setPayInvoice(r.invoice.id);
        setMsg('Pague a cobrança complementar para liberar o novo plano imediatamente.');
      } else if (r.kind === 'downgrade') {
        setMsg(`Downgrade agendado para ${formatDateTime(r.effectiveAt ?? null)}.`);
      } else {
        setMsg('Alteração agendada removida.');
      }
      await reloadAll();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PLAN_DOWNGRADE_EXCESS') {
        const ex = (err.details as Array<{ resource: string; used: number; limit: number }>) ?? [];
        setError(`${err.message}: ${ex.map((e) => `${e.resource} ${e.used}/${e.limit}`).join(', ')}`);
      } else setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!confirm('Cancelar a assinatura? Não haverá renovação. O acesso continua até o fim do período pago.')) return;
    setBusy('cancel');
    setError(null);
    try {
      await critical(() => api('/subscriptions/cancel', { method: 'POST' }));
      setMsg('Assinatura cancelada. O acesso permanece até o fim do período pago.');
      await reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (cur.error) return <Alert tone="danger">{cur.error.message}</Alert>;
  if (!cur.data) return <Spinner className="h-6 w-6 text-brand-600" />;
  const sub = cur.data.subscription;
  const active = sub?.status === 'ACTIVE';
  const needsCheckout = !sub || sub.status === 'PENDING' || sub.status === 'CANCELED' || (sub.status === 'PAST_DUE' && cur.data.openInvoices.length === 0);

  return (
    <>
      <PageHeader title="Assinatura" description={`Vencimentos exibidos no fuso ${cur.data.billingTimezone}.`} />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={sub ? `Plano ${sub.plan.name}` : 'Sem plano'}
            description={
              sub
                ? `${formatBRL(subscriptionMonthlyCents({ priceCents: sub.plan.priceCents, totemPriceCents: sub.plan.totemPriceCents ?? null }, sub.totemQuantity))}/mês${
                    sub.totemQuantity > 0 && sub.plan.totemPriceCents
                      ? ` (plano ${formatBRL(sub.plan.priceCents)} + ${sub.totemQuantity} ${sub.totemQuantity === 1 ? 'totem' : 'totens'} × ${formatBRL(sub.plan.totemPriceCents)})`
                      : ''
                  } · ${sub.method === 'CARD' ? 'Cartão recorrente' : sub.method === 'PIX' ? 'Pix manual mensal' : 'forma de pagamento a definir'}`
                : undefined
            }
            actions={sub && <Badge tone={active ? 'success' : sub.status === 'PENDING' ? 'info' : 'danger'}>{SUBSCRIPTION_LABELS[sub.status] ?? sub.status}</Badge>}
          />
          <CardBody className="space-y-4">
            {sub?.currentPeriodEnd && (
              <p className="text-sm">
                Período atual: {formatDateTime(sub.currentPeriodStart, cur.data.billingTimezone)} até <strong>{formatDateTime(sub.currentPeriodEnd, cur.data.billingTimezone)}</strong>
                {sub.cancelAtPeriodEnd ? ' (sem renovação)' : ' (vencimento)'}
              </p>
            )}
            {sub?.scheduledPlan && <Alert tone="info">Downgrade para {sub.scheduledPlan.name} agendado para a próxima renovação.</Alert>}
            {cur.data.tenantStatus === 'SUSPENDED' && (
              <Alert tone="danger" title="Empresa suspensa">
                {cur.data.suspendedReason === 'INVOICE_OVERDUE' || cur.data.suspendedReason === 'PERIOD_ENDED_UNPAID'
                  ? 'Fatura vencida sem pagamento. Pague para reativar imediatamente.'
                  : cur.data.suspendedReason}
              </Alert>
            )}
            {cur.data.limits && (
              <div className="grid grid-cols-3 gap-3">
                {(['pos', 'stores', 'users'] as const).map((k) => {
                  const used = cur.data!.usage[k];
                  const limit = cur.data!.limits![k];
                  const pct = Math.min(100, Math.round((used / limit) * 100));
                  return (
                    <div key={k}>
                      <p className="text-xs text-slate-500">{k === 'pos' ? 'POS ativos' : k === 'stores' ? 'Lojas ativas' : 'Usuários'}</p>
                      <p className="text-lg font-semibold tabular-nums">{used}/{limit}</p>
                      <div className="mt-1 h-1.5 rounded bg-slate-100" role="progressbar" aria-valuenow={used} aria-valuemax={limit} aria-label={k}>
                        <div className={`h-1.5 rounded ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
                      </div>
                      {pct >= 80 && <p className="mt-1 text-xs text-amber-700">{pct >= 100 ? 'Limite atingido' : 'Próximo do limite'}</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {can('subscription:manage') && needsCheckout && (
              <div className="flex flex-wrap gap-2">
                {(plans.data ?? []).map((p) => (
                  <Link key={p.id} href={`/assinar/${p.id}`}><Button variant={p.id === sub?.plan.id ? 'primary' : 'secondary'}>Contratar {p.name} — {formatBRL(p.priceCents)}</Button></Link>
                ))}
              </div>
            )}
            {can('subscription:manage') && active && !sub?.cancelAtPeriodEnd && (
              <Button variant="ghost" className="text-red-600" loading={busy === 'cancel'} onClick={cancel}>Cancelar assinatura</Button>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Faturas em aberto" />
          <CardBody className="space-y-3">
            {cur.data.creditCents > 0 && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-paid">
                Você tem <strong className="tabular-nums">{formatBRL(cur.data.creditCents)}</strong> de crédito de indicação, descontado nas próximas mensalidades.{' '}
                <Link href="/app/indicacoes" className="underline">Ver indicações</Link>
              </p>
            )}
            {cur.data.openInvoices.length === 0 && <p className="text-sm text-slate-500">Nenhuma fatura em aberto.</p>}
            {cur.data.openInvoices.map((i) => (
              <div key={i.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">{KIND[i.kind] ?? i.kind} · {formatBRL(i.amountCents)}</p>
                {i.creditAppliedCents > 0 && <p className="text-xs text-paid">Crédito de indicação: −{formatBRL(i.creditAppliedCents)}</p>}
                <p className="text-xs text-slate-500">Vence em {formatDateTime(i.dueAt, cur.data!.billingTimezone)}</p>
                {i.method === 'PIX' && can('subscription:manage') && <Button size="sm" className="mt-2" onClick={() => setPayInvoice(i.id)}>Pagar com Pix</Button>}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {active && can('subscription:manage') && (
        <Card className="mt-6">
          <CardHeader title="Trocar de plano" description="Upgrade: cobrança pró-rata do período restante, com liberação após o pagamento. Downgrade: vale na próxima renovação e exige uso dentro dos novos limites." />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(plans.data ?? []).map((p) => (
              <div key={p.id} className={`rounded-lg border p-4 ${p.id === sub?.plan.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm tabular-nums">{formatBRL(p.priceCents)}/mês</p>
                <p className="mt-1 text-xs text-slate-500">{p.maxPos} POS · {p.maxStores} lojas · {p.maxUsers} usuários</p>
                {p.id !== sub?.plan.id && (
                  <Button size="sm" variant="secondary" className="mt-3" loading={busy === p.id} onClick={() => changePlan(p.id)}>
                    {sub && p.priceCents > sub.plan.priceCents ? 'Fazer upgrade' : 'Agendar downgrade'}
                  </Button>
                )}
                {p.id === sub?.plan.id && sub?.scheduledPlan && (
                  <Button size="sm" variant="ghost" className="mt-3" loading={busy === p.id} onClick={() => changePlan(p.id)}>Manter este plano</Button>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Histórico de faturas" />
        <Table>
          <thead><tr><Th>Tipo</Th><Th>Plano</Th><Th>Método</Th><Th className="text-right">Valor</Th><Th>Vencimento</Th><Th>Pagamento</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.data?.map((i) => (
              <tr key={i.id}>
                <Td>{KIND[i.kind] ?? i.kind}</Td>
                <Td>{i.planName}</Td>
                <Td>{i.method === 'PIX' ? 'Pix' : 'Cartão'}</Td>
                <Td className="text-right tabular-nums">
                  {formatBRL(i.amountCents)}
                  {i.creditAppliedCents > 0 && <span className="block text-xs text-paid">crédito −{formatBRL(i.creditAppliedCents)}</span>}
                </Td>
                <Td>{formatDateTime(i.dueAt)}</Td>
                <Td>{formatDateTime(i.paidAt)}</Td>
                <Td><Badge tone={i.status === 'PAID' ? 'success' : i.status === 'OPEN' ? 'info' : 'neutral'}>{i.status === 'PAID' ? 'Paga' : i.status === 'OPEN' ? 'Aberta' : i.status === 'VOID' ? 'Anulada' : 'Falhou'}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Dialog open={!!payInvoice} onOpenChange={(o) => !o && setPayInvoice(null)} title="Pagar fatura com Pix" description="Recebedor: Adapter Co. A confirmação é automática.">
        {payInvoice && <InvoicePix invoiceId={payInvoice} onPaid={() => { void reloadAll(); }} />}
      </Dialog>
    </>
  );
}
