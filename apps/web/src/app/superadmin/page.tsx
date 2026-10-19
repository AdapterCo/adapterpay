'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Spinner, Stat, Table, Td, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Health {
  status: 'ok' | 'degraded';
  alerts: string[];
  worker: { lastHeartbeatSecondsAgo: number | null; workerId: string | null };
  queue: Record<string, number> | null;
  polling: { stale: number };
  charges: { reconciling: number; pendingPastExpiry: number; creatingStuck: number };
  mpConnections: { needsReconnect: number };
  checkedAt: string;
}

const ALERT_LABELS: Record<string, string> = {
  WORKER_DOWN: 'Worker inoperante (sem heartbeat há mais de 60s)',
  POLLING_BACKLOG: 'Fila de polling atrasada',
  ORDERS_WITHOUT_RECONCILIATION: 'Orders pendentes após a expiração, sem conciliação',
  CHARGES_STUCK_CREATING: 'Cobranças presas em criação',
  CHARGES_RECONCILING: 'Cobranças em conciliação',
};

export default function SuperadminHome() {
  const critical = useCritical();
  const health = useApi<Health>('/admin/operations/health');
  const oauth = useApi<Array<{ id: string; tenantId: string; mpUserId: string; nickname: string | null; status: string; lastError: string | null; updatedAt: string }>>('/admin/operations/oauth-failures');
  const reconciling = useApi<Array<{ id: string; tenantId: string; externalReference: string; orderId: string | null; status: string; statusReason: string | null; createdAt: string; lastPolledAt: string | null }>>('/admin/operations/reconciling');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => void health.reload(), 15_000);
    return () => clearInterval(t);
  }, [health.reload]);

  const repoll = async (id: string) => {
    setError(null);
    try {
      await critical(() => api(`/admin/charges/${id}/repoll`, { method: 'POST' }));
      setMsg('Nova consulta agendada.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title="Operação" description="Saúde do worker, filas, conciliação e integrações." />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {health.error && <Alert tone="danger">{health.error.message}</Alert>}
      {!health.data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={health.data.status === 'ok' ? 'success' : 'danger'}>{health.data.status === 'ok' ? 'Operacional' : 'Degradado'}</Badge>
            <span className="text-xs text-slate-500">Verificado em {formatDateTime(health.data.checkedAt)}</span>
          </div>
          {health.data.alerts.length > 0 && (
            <Alert tone={health.data.status === 'ok' ? 'warning' : 'danger'} className="mb-4" title="Alertas">
              <ul className="list-disc pl-5">{health.data.alerts.map((a) => <li key={a}>{ALERT_LABELS[a] ?? a}</li>)}</ul>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Heartbeat do worker" value={health.data.worker.lastHeartbeatSecondsAgo === null ? '—' : `${health.data.worker.lastHeartbeatSecondsAgo}s`} tone={health.data.alerts.includes('WORKER_DOWN') ? 'danger' : 'default'} />
            <Stat label="Fila (espera/atraso)" value={health.data.queue ? `${health.data.queue.waiting ?? 0}/${health.data.queue.delayed ?? 0}` : '—'} hint={`ativos ${health.data.queue?.active ?? 0} · falhas ${health.data.queue?.failed ?? 0}`} />
            <Stat label="Polling atrasado" value={health.data.polling.stale} tone={health.data.polling.stale ? 'warning' : 'default'} />
            <Stat label="Em conciliação" value={health.data.charges.reconciling} hint={`pós-expiração ${health.data.charges.pendingPastExpiry} · criando ${health.data.charges.creatingStuck}`} />
            <Stat label="OAuth com falha" value={health.data.mpConnections.needsReconnect} tone={health.data.mpConnections.needsReconnect ? 'warning' : 'default'} />
          </div>
        </>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cobranças em conciliação / criação" />
          {reconciling.data?.length === 0 ? (
            <EmptyState title="Nada pendente" />
          ) : (
            <Table>
              <thead><tr><Th>Criada</Th><Th>Referência</Th><Th>Status</Th><Th>Motivo</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {reconciling.data?.map((c) => (
                  <tr key={c.id}>
                    <Td className="text-xs">{formatDateTime(c.createdAt)}</Td>
                    <Td className="font-mono text-xs">{c.externalReference}</Td>
                    <Td>{c.status}</Td>
                    <Td className="whitespace-normal text-xs">{c.statusReason}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => repoll(c.id)}>Reconsultar</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Falhas de OAuth" description="Contas que precisam ser reconectadas pelo lojista." />
          {oauth.data?.length === 0 ? (
            <EmptyState title="Nenhuma falha" />
          ) : (
            <Table>
              <thead><tr><Th>Conta</Th><Th>Status</Th><Th>Erro</Th><Th>Atualizado</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {oauth.data?.map((c) => (
                  <tr key={c.id}>
                    <Td className="text-xs">{c.nickname ?? c.mpUserId}</Td>
                    <Td>{c.status}</Td>
                    <Td className="whitespace-normal text-xs">{c.lastError}</Td>
                    <Td className="text-xs">{formatDateTime(c.updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
