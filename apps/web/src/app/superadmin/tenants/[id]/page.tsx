'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, PageHeader, Spinner, Table, Td, Textarea, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, TENANT_STATUS_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface TenantDetail {
  id: string;
  tradeName: string;
  legalName: string;
  status: string;
  suspendedReason: string | null;
  subscription: null | { status: string; method: string | null; currentPeriodEnd: string | null; plan: { name: string; maxPos: number; maxStores: number; maxUsers: number } };
  mpConnections: Array<{ id: string; mpUserId: string; nickname: string | null; status: string; lastError: string | null }>;
  usage: { pos: number; stores: number; users: number };
  invoices: Array<{ id: string; kind: string; amountCents: number; status: string; dueAt: string; paidAt: string | null; method: string }>;
  audit: Array<{ id: string; action: string; actorType: string; createdAt: string }>;
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const critical = useCritical();
  const t = useApi<TenantDetail>(`/admin/tenants/${id}`);
  const [action, setAction] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await critical(() => api(`/admin/tenants/${id}/${action}`, { method: 'POST', body: { reason } }));
      setAction(null);
      setReason('');
      await t.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (t.error) return <Alert tone="danger">{t.error.message}</Alert>;
  if (!t.data) return <Spinner className="h-6 w-6 text-brand-600" />;
  const d = t.data;

  return (
    <>
      <PageHeader
        title={d.tradeName}
        description={d.legalName}
        actions={
          d.status === 'SUSPENDED' ? (
            <Button onClick={() => setAction('reactivate')}>Reativar</Button>
          ) : (
            <Button variant="danger" onClick={() => setAction('suspend')}>Bloquear (justificado)</Button>
          )
        }
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Situação" actions={<Badge tone={d.status === 'ACTIVE' ? 'success' : 'danger'}>{TENANT_STATUS_LABELS[d.status] ?? d.status}</Badge>} />
          <CardBody className="space-y-1 text-sm">
            {d.suspendedReason && <p><span className="text-slate-500">Motivo:</span> {d.suspendedReason}</p>}
            <p><span className="text-slate-500">Plano:</span> {d.subscription?.plan.name ?? '—'} ({d.subscription?.status ?? '—'})</p>
            <p><span className="text-slate-500">Método:</span> {d.subscription?.method ?? '—'}</p>
            <p><span className="text-slate-500">Período até:</span> {formatDateTime(d.subscription?.currentPeriodEnd ?? null)}</p>
            <p><span className="text-slate-500">Uso:</span> POS {d.usage.pos}/{d.subscription?.plan.maxPos ?? '—'} · Lojas {d.usage.stores}/{d.subscription?.plan.maxStores ?? '—'} · Usuários {d.usage.users}/{d.subscription?.plan.maxUsers ?? '—'}</p>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Contas Mercado Pago" />
          <Table>
            <thead><tr><Th>Conta</Th><Th>Status</Th><Th>Último erro</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.mpConnections.map((c) => <tr key={c.id}><Td>{c.nickname ?? c.mpUserId}</Td><Td>{c.status}</Td><Td className="whitespace-normal text-xs">{c.lastError ?? '—'}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Faturas da plataforma" />
          <Table>
            <thead><tr><Th>Tipo</Th><Th>Valor</Th><Th>Status</Th><Th>Vencimento</Th><Th>Pago</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.invoices.map((i) => <tr key={i.id}><Td>{i.kind}</Td><Td>{formatBRL(i.amountCents)}</Td><Td>{i.status}</Td><Td className="text-xs">{formatDateTime(i.dueAt)}</Td><Td className="text-xs">{formatDateTime(i.paidAt)}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Auditoria recente" />
          <Table>
            <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>Autor</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.audit.map((a) => <tr key={a.id}><Td className="text-xs">{formatDateTime(a.createdAt)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="text-xs">{a.actorType}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
      </div>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)} title={action === 'suspend' ? 'Bloquear tenant' : 'Reativar tenant'} description="A justificativa é obrigatória e fica registrada na auditoria.">
        <div className="flex flex-col gap-3">
          <Field label="Justificativa">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>Cancelar</Button>
            <Button variant={action === 'suspend' ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 5} onClick={submit}>Confirmar</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
