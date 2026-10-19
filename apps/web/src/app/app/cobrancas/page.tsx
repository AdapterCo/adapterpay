'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CHARGE_STATUSES } from '@adapterpay/shared';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { ChargeStatusBadge, Money } from '@/components/domain';
import { chargeLabel, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface ChargeRow {
  id: string;
  status: string;
  amountCents: number;
  description: string | null;
  externalReference: string;
  orderId: string | null;
  posName: string;
  storeName: string;
  sellerName: string;
  createdAt: string;
  paidAt: string | null;
  feeCents: number | null;
  netAmountCents: number | null;
}

export default function ChargesPage() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);
  const stores = useApi<Array<{ id: string; name: string }>>('/stores');

  const path = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (storeId) p.set('storeId', storeId);
    return `/charges?${p.toString()}`;
  }, [q, status, storeId, page]);
  const list = useApi<{ total: number; items: ChargeRow[] }>(path);

  useEffect(() => {
    const h = (e: Event) => {
      if (((e as CustomEvent).detail as { type?: string }).type === 'charge.updated') void list.reload();
    };
    window.addEventListener('adapterpay:event', h);
    return () => window.removeEventListener('adapterpay:event', h);
  }, [list.reload]);

  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));

  return (
    <>
      <PageHeader
        title="Cobranças"
        description="Histórico, status e detalhes de cada Order."
        actions={can('charges:create') && <Link href="/app/cobrancas/nova"><Button>Nova cobrança</Button></Link>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input
            aria-label="Buscar por referência, Order ID ou descrição"
            placeholder="Buscar referência, Order ID ou descrição"
            className="max-w-xs"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
          <Select aria-label="Status" className="max-w-44" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">Todos os status</option>
            {CHARGE_STATUSES.map((s) => <option key={s} value={s}>{chargeLabel(s)}</option>)}
          </Select>
          <Select aria-label="Loja" className="max-w-52" value={storeId} onChange={(e) => { setPage(1); setStoreId(e.target.value); }}>
            <option value="">Todas as lojas</option>
            {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        {list.error && <Alert tone="danger" className="m-4">{list.error.message}</Alert>}
        {list.loading && !list.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState title="Nenhuma cobrança encontrada" description="Ajuste os filtros ou gere uma nova cobrança." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Criada</Th><Th>Status</Th><Th className="text-right">Valor</Th><Th>Loja · POS</Th><Th>Vendedor</Th><Th>Referência</Th><Th className="text-right">Líquido</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td><Link href={`/app/cobrancas/${c.id}`} className="text-brand-700 hover:underline">{formatDateTime(c.createdAt)}</Link></Td>
                  <Td><ChargeStatusBadge status={c.status} /></Td>
                  <Td className="text-right font-medium"><Money cents={c.amountCents} /></Td>
                  <Td>{c.storeName} · {c.posName}</Td>
                  <Td>{c.sellerName}</Td>
                  <Td className="font-mono text-xs">{c.externalReference}</Td>
                  <Td className="text-right">{c.status === 'PAID' ? (c.netAmountCents === null ? <span className="text-xs text-slate-400">não informado</span> : <Money cents={c.netAmountCents} />) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">Página {page} de {pages} · {list.data?.total} cobranças</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
