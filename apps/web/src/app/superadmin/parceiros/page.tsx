'use client';

import { useState } from 'react';
import { formatBRL, formatBrWhatsApp, PIX_KEY_LABELS, type PixKeyType } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { CopyButton } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Partner {
  id: string;
  name: string;
  phone: string;
  pixKeyType: PixKeyType;
  pixKey: string;
  code: string;
  link: string;
  status: 'ACTIVE' | 'BLOCKED';
  createdAt: string;
  registered: number;
  paying: number;
  toReceiveCents: number;
  receivedCents: number;
}

/** Parceiros de indicação: quanto cada um tem a receber e registro do Pix feito a eles. */
export default function PartnersAdminPage() {
  const partners = useApi<Partner[]>('/admin/partners');
  const [pay, setPay] = useState<Partner | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const totalDue = (partners.data ?? []).reduce((s, p) => s + p.toReceiveCents, 0);

  const confirmPayout = async () => {
    if (!pay) return;
    setBusy(pay.id);
    setError(null);
    try {
      const r = await api<{ amountCents: number; count: number }>(`/admin/partners/${pay.id}/payout`, { method: 'POST', body: { note: note.trim() || undefined } });
      setMsg(`Pagamento de ${formatBRL(r.amountCents)} (${r.count} ${r.count === 1 ? 'indicação' : 'indicações'}) registrado para ${pay.name}.`);
      setPay(null);
      await partners.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (p: Partner) => {
    setBusy(p.id);
    setError(null);
    try {
      await api(`/admin/partners/${p.id}/status`, { method: 'POST', body: { status: p.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' } });
      await partners.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Parceiros de indicação"
        description={`Pessoas sem conta que divulgam pelo link de /indique. Total a pagar agora: ${formatBRL(totalDue)}.`}
      />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {!partners.data ? (
        partners.error ? <Alert tone="danger">{partners.error.message}</Alert> : <Spinner className="h-6 w-6 text-brand-600" />
      ) : partners.data.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500">Nenhum parceiro cadastrado ainda. Divulgue a página /indique.</Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr><Th>Parceiro</Th><Th>Chave Pix</Th><Th>Código</Th><Th className="text-right">Cadastros</Th><Th className="text-right">Pagaram</Th><Th className="text-right">A receber</Th><Th className="text-right">Recebido</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partners.data.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{formatBrWhatsApp(p.phone)} · desde {formatDateTime(p.createdAt)}</p>
                    {p.status === 'BLOCKED' && <Badge tone="danger" className="mt-1">Bloqueado</Badge>}
                  </Td>
                  <Td>
                    <p className="text-xs text-slate-500">{PIX_KEY_LABELS[p.pixKeyType]}</p>
                    <div className="flex items-center gap-2"><span className="font-mono text-xs">{p.pixKey}</span><CopyButton text={p.pixKey} label="Copiar" size="sm" /></div>
                  </Td>
                  <Td className="font-mono">{p.code}</Td>
                  <Td className="text-right tabular-nums">{p.registered}</Td>
                  <Td className="text-right tabular-nums">{p.paying}</Td>
                  <Td className="text-right tabular-nums font-semibold">{formatBRL(p.toReceiveCents)}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(p.receivedCents)}</Td>
                  <Td className="space-x-2 whitespace-nowrap text-right">
                    <Button size="sm" disabled={p.toReceiveCents === 0} onClick={() => { setPay(p); setNote(''); setError(null); }}>Registrar Pix</Button>
                    <Button size="sm" variant="ghost" loading={busy === p.id && !pay} onClick={() => void toggle(p)}>{p.status === 'ACTIVE' ? 'Bloquear' : 'Reativar'}</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)} title="Registrar Pix ao parceiro" description="Faça o Pix pelo banco da Adapter Co. e depois registre aqui. O parceiro vê o pagamento no painel dele.">
        {pay && (
          <div className="space-y-4">
            <div className="rounded-lg bg-paper p-3 text-sm">
              <p><strong>{pay.name}</strong></p>
              <p className="mt-1">Valor: <strong className="tabular-nums">{formatBRL(pay.toReceiveCents)}</strong></p>
              <p className="mt-1 flex items-center gap-2">Chave ({PIX_KEY_LABELS[pay.pixKeyType]}): <span className="font-mono">{pay.pixKey}</span><CopyButton text={pay.pixKey} label="Copiar" size="sm" /></p>
            </div>
            <Field label="Observação (opcional)" hint="Ex.: ID da transação no banco.">
              {(p) => <Input {...p} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPay(null)}>Cancelar</Button>
              <Button loading={busy === pay.id} onClick={() => void confirmPayout()}>Já fiz o Pix, registrar</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
