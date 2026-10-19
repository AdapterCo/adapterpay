'use client';

import { useState } from 'react';
import { formatBRL, parseBrlInputToCents } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  maxPos: number;
  maxStores: number;
  maxUsers: number;
  active: boolean;
}

export default function PlansAdminPage() {
  const critical = useCritical();
  const plans = useApi<Plan[]>('/admin/plans');
  const [edit, setEdit] = useState<Plan | null>(null);
  const [price, setPrice] = useState('');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (p: Plan) => {
    setEdit(p);
    setPrice(formatBRL(p.priceCents).replace('R$ ', ''));
    setActive(p.active);
    setReason('');
    setError(null);
  };

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      const priceCents = parseBrlInputToCents(price);
      await critical(() => api(`/admin/plans/${edit.id}`, { method: 'PATCH', body: { priceCents, active, reason } }));
      setEdit(null);
      await plans.reload();
    } catch (err) {
      setError(err instanceof Error && err.name === 'MoneyFormatError' ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Planos e preços" description="Alterações de preço valem para novas faturas; faturas já emitidas não mudam. Limites seguem a política comercial." />
      <Card>
        {!plans.data ? <div className="p-6"><Spinner className="h-5 w-5" /></div> : (
          <Table>
            <thead><tr><Th>Plano</Th><Th className="text-right">Mensalidade</Th><Th>POS</Th><Th>Lojas</Th><Th>Usuários</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {plans.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(p.priceCents)}</Td>
                  <Td>{p.maxPos}</Td>
                  <Td>{p.maxStores}</Td>
                  <Td>{p.maxUsers}</Td>
                  <Td><Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Badge></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => open(p)}>Editar</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={`Editar ${edit?.name ?? ''}`}>
        <div className="flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Mensalidade (R$)">{(p) => <Input {...p} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} label="Plano disponível para contratação" />
          <Field label="Justificativa (auditoria)">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={save}>Salvar</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
