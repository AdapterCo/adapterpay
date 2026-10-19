'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { formatDateTime, SUBSCRIPTION_LABELS, TENANT_STATUS_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface TenantRow {
  id: string;
  tradeName: string;
  legalName: string;
  status: string;
  suspendedReason: string | null;
  createdAt: string;
  subscription: { status: string; plan: string; method: string | null; currentPeriodEnd: string | null } | null;
  counts: { posTerminals: number; stores: number; memberships: number };
}

export default function TenantsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useApi<{ total: number; items: TenantRow[] }>(`/admin/tenants?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString()}`);

  return (
    <>
      <PageHeader title="Tenants" description={list.data ? `${list.data.total} empresas` : undefined} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input aria-label="Buscar" placeholder="Buscar empresa" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Status" className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TENANT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {!list.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : (
          <Table>
            <thead><tr><Th>Empresa</Th><Th>Status</Th><Th>Assinatura</Th><Th>Uso (POS/lojas/usuários)</Th><Th>Criada</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.items.map((t) => (
                <tr key={t.id}>
                  <Td><Link href={`/superadmin/tenants/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.tradeName}</Link><p className="text-xs text-slate-500">{t.legalName}</p></Td>
                  <Td><Badge tone={t.status === 'ACTIVE' ? 'success' : t.status === 'SUSPENDED' ? 'danger' : 'neutral'}>{TENANT_STATUS_LABELS[t.status] ?? t.status}</Badge></Td>
                  <Td className="text-xs">{t.subscription ? `${t.subscription.plan} · ${SUBSCRIPTION_LABELS[t.subscription.status] ?? t.subscription.status} · ${t.subscription.method ?? '—'}` : '—'}</Td>
                  <Td className="text-xs">{t.counts.posTerminals} / {t.counts.stores} / {t.counts.memberships}</Td>
                  <Td className="text-xs">{formatDateTime(t.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
