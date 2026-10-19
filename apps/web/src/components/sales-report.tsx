'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner, Stat, Table, Td, Th } from '@adapterpay/ui';
import { dayRangeToIso, formatDateTime, todayInput } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Group {
  id: string;
  name: string;
  paidCount: number;
  grossCents: number;
}

interface Sales {
  summary: { paidCount: number; grossCents: number; feeCents: number | null; netCents: number | null; feeUnknownCount: number };
  byStore: Group[];
  byPos: Group[];
  bySeller: Group[];
  divergences: Array<{ id: string; externalReference: string; amountCents: number; statusReason: string | null; createdAt: string }>;
  refunds: Array<{ mpPaymentId: string; amountCents: number; refundedAt: string; chargeId: string }>;
}

export function SalesReport({ showReconciliation }: { showReconciliation: boolean }) {
  const [from, setFrom] = useState(todayInput(-29));
  const [to, setTo] = useState(todayInput(0));
  const [storeId, setStoreId] = useState('');
  const stores = useApi<Array<{ id: string; name: string }>>('/stores');

  const query = useMemo(() => {
    const r = dayRangeToIso(from, to);
    const p = new URLSearchParams({ from: r.from, to: r.to });
    if (storeId) p.set('storeId', storeId);
    return p.toString();
  }, [from, to, storeId]);

  const sales = useApi<Sales>(`/reports/sales?${query}`);

  return (
    <>
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="De">{(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Até">{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label="Loja">
            {(p) => (
              <Select {...p} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Todas</option>
                {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="ml-auto flex gap-2">
            <a href={`/api/v1/reports/export?${query}&format=csv`}><Button variant="secondary">Exportar CSV</Button></a>
            <a href={`/api/v1/reports/export?${query}&format=xlsx`}><Button variant="secondary">Exportar XLSX</Button></a>
          </div>
        </div>
      </Card>

      {sales.error && <Alert tone="danger">{sales.error.message}</Alert>}
      {sales.loading && !sales.data && <Spinner className="h-5 w-5 text-brand-600" />}
      {sales.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Pagamentos" value={sales.data.summary.paidCount} />
            <Stat label="Bruto" value={formatBRL(sales.data.summary.grossCents)} />
            <Stat label="Tarifa efetiva" value={sales.data.summary.feeCents === null ? '—' : formatBRL(sales.data.summary.feeCents)} hint={sales.data.summary.feeUnknownCount ? `${sales.data.summary.feeUnknownCount} sem tarifa informada` : 'Conforme informado pelo Mercado Pago'} />
            <Stat label="Líquido" value={sales.data.summary.netCents === null ? '—' : formatBRL(sales.data.summary.netCents)} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {([['Por loja', sales.data.byStore], ['Por POS', sales.data.byPos], ['Por vendedor', sales.data.bySeller]] as const).map(([title, rows]) => (
              <Card key={title}>
                <CardHeader title={title} />
                {rows.length === 0 ? (
                  <EmptyState title="Sem dados no período" />
                ) : (
                  <Table>
                    <thead><tr><Th>Nome</Th><Th className="text-right">Qtde</Th><Th className="text-right">Bruto</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td className="text-right">{r.paidCount}</Td><Td className="text-right tabular-nums">{formatBRL(r.grossCents)}</Td></tr>)}
                    </tbody>
                  </Table>
                )}
              </Card>
            ))}
          </div>

          {showReconciliation && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Divergências e conciliação" description="Cobranças sem confirmação segura. O POS fica reservado até a resolução." />
                {sales.data.divergences.length === 0 ? (
                  <EmptyState title="Nenhuma divergência" />
                ) : (
                  <Table>
                    <thead><tr><Th>Criada</Th><Th>Referência</Th><Th className="text-right">Valor</Th><Th>Motivo</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {sales.data.divergences.map((d) => (
                        <tr key={d.id}>
                          <Td><Link href={`/app/cobrancas/${d.id}`} className="text-brand-700 hover:underline">{formatDateTime(d.createdAt)}</Link></Td>
                          <Td className="font-mono text-xs">{d.externalReference}</Td>
                          <Td className="text-right">{formatBRL(d.amountCents)}</Td>
                          <Td className="whitespace-normal text-xs">{d.statusReason}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
              <Card>
                <CardHeader title="Estornos no período" />
                {sales.data.refunds.length === 0 ? (
                  <EmptyState title="Nenhum estorno" />
                ) : (
                  <Table>
                    <thead><tr><Th>Data</Th><Th>Payment ID</Th><Th className="text-right">Valor</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {sales.data.refunds.map((r) => (
                        <tr key={r.mpPaymentId}>
                          <Td><Link href={`/app/cobrancas/${r.chargeId}`} className="text-brand-700 hover:underline">{formatDateTime(r.refundedAt)}</Link></Td>
                          <Td className="font-mono text-xs">{r.mpPaymentId}</Td>
                          <Td className="text-right">{formatBRL(r.amountCents)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
