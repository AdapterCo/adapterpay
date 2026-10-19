'use client';

import { Card, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function AdminAuditPage() {
  const data = useApi<Array<{ id: string; tenantId: string | null; actorType: string; actorUserId: string | null; resourceType: string; resourceId: string | null; action: string; ip: string | null; createdAt: string }>>('/admin/audit');
  return (
    <>
      <PageHeader title="Auditoria global" description="Últimos 200 eventos de todos os tenants e ações de superadmin." />
      <Card>
        {!data.data ? <div className="p-6"><Spinner className="h-5 w-5" /></div> : (
          <Table>
            <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>Recurso</Th><Th>Tenant</Th><Th>Autor</Th><Th>IP</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((a) => (
                <tr key={a.id}>
                  <Td className="text-xs">{formatDateTime(a.createdAt)}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.resourceType}{a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}</Td>
                  <Td className="text-xs">{a.tenantId?.slice(0, 8) ?? '—'}</Td>
                  <Td className="text-xs">{a.actorType}{a.actorUserId ? ` · ${a.actorUserId.slice(0, 8)}` : ''}</Td>
                  <Td className="text-xs">{a.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
