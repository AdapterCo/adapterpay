'use client';

import { useState } from 'react';
import { Button, Card, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface AuditItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorType: string;
  actor: { name: string; email: string } | null;
  ip: string | null;
  createdAt: string;
  after: unknown;
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const data = useApi<{ total: number; items: AuditItem[] }>(`/audit?page=${page}${type ? `&resourceType=${type}` : ''}`);
  const pages = Math.max(1, Math.ceil((data.data?.total ?? 0) / 50));

  return (
    <>
      <PageHeader title="Auditoria" description="Alterações sensíveis registradas, com dados saneados e sem credenciais." />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select aria-label="Tipo de recurso" className="max-w-56" value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
            <option value="">Todos os recursos</option>
            {['charge', 'pos', 'store', 'mp_connection', 'user', 'subscription', 'invoice', 'tenant', 'report', 'session'].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        {!data.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : (
          <Table>
            <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>Recurso</Th><Th>Autor</Th><Th>IP</Th><Th>Detalhes</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td className="text-xs">{formatDateTime(a.createdAt)}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.resourceType}{a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}</Td>
                  <Td className="text-xs">{a.actor ? a.actor.name : a.actorType}</Td>
                  <Td className="text-xs">{a.ip ?? '—'}</Td>
                  <Td className="max-w-md whitespace-normal">
                    {a.after ? <code className="block max-h-24 overflow-auto break-all text-[11px] text-slate-500">{JSON.stringify(a.after)}</code> : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex justify-end gap-2 border-t border-slate-100 p-3">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        )}
      </Card>
    </>
  );
}
