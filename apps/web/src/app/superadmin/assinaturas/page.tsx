'use client';

import { formatBRL } from '@adapterpay/shared';
import { Card, CardHeader, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { formatDateTime, SUBSCRIPTION_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function SubscriptionsAdminPage() {
  const subs = useApi<Array<{ id: string; tenant: string; tenantStatus: string; plan: string; status: string; method: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; preapprovalStatus: string | null }>>('/admin/subscriptions');
  const invoices = useApi<Array<{ id: string; tenant: string; kind: string; method: string; amountCents: number; status: string; dueAt: string; paidAt: string | null; providerStatus: string | null; lastError: string | null }>>('/admin/invoices');

  return (
    <>
      <PageHeader title="Assinaturas e pagamentos da plataforma" description="Cobranças da conta Mercado Pago da Adapter Co., separadas das vendas dos lojistas." />
      <Card>
        <CardHeader title="Assinaturas" />
        {!subs.data ? <div className="p-6"><Spinner className="h-5 w-5" /></div> : (
          <Table>
            <thead><tr><Th>Empresa</Th><Th>Plano</Th><Th>Status</Th><Th>Método</Th><Th>Período até</Th><Th>Cartão (preapproval)</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {subs.data.map((s) => (
                <tr key={s.id}>
                  <Td>{s.tenant}</Td>
                  <Td>{s.plan}</Td>
                  <Td>{SUBSCRIPTION_LABELS[s.status] ?? s.status}{s.cancelAtPeriodEnd ? ' · cancelando' : ''}</Td>
                  <Td>{s.method ?? '—'}</Td>
                  <Td className="text-xs">{formatDateTime(s.currentPeriodEnd)}</Td>
                  <Td className="text-xs">{s.preapprovalStatus ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Faturas" />
        {!invoices.data ? <div className="p-6"><Spinner className="h-5 w-5" /></div> : (
          <Table>
            <thead><tr><Th>Empresa</Th><Th>Tipo</Th><Th>Método</Th><Th className="text-right">Valor</Th><Th>Status</Th><Th>Vencimento</Th><Th>Pago</Th><Th>Provedor</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.data.map((i) => (
                <tr key={i.id}>
                  <Td>{i.tenant}</Td>
                  <Td>{i.kind}</Td>
                  <Td>{i.method}</Td>
                  <Td className="text-right">{formatBRL(i.amountCents)}</Td>
                  <Td>{i.status}</Td>
                  <Td className="text-xs">{formatDateTime(i.dueAt)}</Td>
                  <Td className="text-xs">{formatDateTime(i.paidAt)}</Td>
                  <Td className="whitespace-normal text-xs">{i.providerStatus ?? '—'}{i.lastError ? ` · ${i.lastError}` : ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
