'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner } from '@adapterpay/ui';
import { MoneyInput } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface TableRow {
  id: string;
  name: string;
  publicSlug: string;
  storeName: string;
  posName: string;
  bill: null | {
    id: string;
    totalCents: number;
    paidCents: number;
    remainingCents: number;
    percent: number;
    mode: 'FULL' | 'SPLIT' | null;
    splitCount: number | null;
    paidShares: number;
    share: { number: number; of: number } | null;
    nextChargeCents: number;
  };
  paying: null | { amountCents: number; expiresAt: string | null };
}

interface StoreItem { id: string; name: string; mpStoreId: string | null; status: string }
interface PosItem { id: string; name: string; storeName: string | null; status: string }

function statusOf(t: TableRow): { label: string; tone: 'neutral' | 'warning' | 'success' | 'info' } {
  if (!t.bill) return { label: 'Livre', tone: 'neutral' };
  if (t.paying) return { label: t.bill.share ? `Pagando · pessoa ${t.bill.share.number} de ${t.bill.share.of}` : 'Pagando', tone: 'info' };
  if (!t.bill.mode) return { label: 'Conta aberta', tone: 'warning' };
  if (t.bill.mode === 'SPLIT') return { label: `Dividida · ${t.bill.paidShares} de ${t.bill.splitCount} pagas`, tone: 'warning' };
  return { label: 'Pagamento integral', tone: 'warning' };
}

/** Modo Restaurante: cada mesa com QR próprio; o garçom abre a conta e acompanha o pagamento até 100%. */
export default function TablesPage() {
  const { can } = useSession();
  const tables = useApi<TableRow[]>('/tables');
  const [error, setError] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<TableRow | null>(null);
  const [totalFor, setTotalFor] = useState<TableRow | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onEvent = (e: Event) => {
      if (((e as CustomEvent).detail as { type?: string }).type === 'charge.updated') void tables.reload();
    };
    window.addEventListener('adapterpay:event', onEvent);
    const t = setInterval(() => void tables.reload(), 5_000);
    return () => {
      window.removeEventListener('adapterpay:event', onEvent);
      clearInterval(t);
    };
  }, [tables.reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await tables.reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openBill = async (e: FormEvent) => {
    e.preventDefault();
    if (!openFor || !amount) return;
    if (await run(() => api(`/tables/${openFor.id}/bill`, { method: 'POST', body: { totalCents: amount } }))) setOpenFor(null);
  };

  const updateTotal = async (e: FormEvent) => {
    e.preventDefault();
    if (!totalFor || !amount) return;
    if (await run(() => api(`/tables/${totalFor.id}/bill/total`, { method: 'POST', body: { totalCents: amount } }))) setTotalFor(null);
  };

  const list = tables.data ?? [];
  const occupied = list.filter((t) => t.bill).length;

  return (
    <>
      <PageHeader
        title="Mesas"
        description={list.length ? `${occupied} de ${list.length} mesas com conta aberta. Atualiza sozinha.` : 'Cada mesa tem um QR próprio para o cliente pagar a conta, integral ou dividida.'}
        actions={can('tables:manage') && <Button onClick={() => setCreating(true)}>Nova mesa</Button>}
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {tables.loading && !tables.data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma mesa cadastrada"
            description="Crie as mesas do salão. Cada uma ganha um POS e uma placa com QR."
            action={can('tables:manage') ? <Button onClick={() => setCreating(true)}>Criar a primeira mesa</Button> : undefined}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const st = statusOf(t);
            return (
              <li key={t.id} className={`flex flex-col rounded-2xl bg-white p-5 ring-1 ${t.paying ? 'ring-2 ring-brand-600' : 'ring-line'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-semibold text-ink">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.storeName}</p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>

                {t.bill ? (
                  <>
                    <div className="mt-4 flex items-baseline justify-between">
                      <span className="text-sm text-slate-600">Conta</span>
                      <span className="text-xl font-semibold tabular-nums">{formatBRL(t.bill.totalCents)}</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={t.bill.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.bill.percent}% pago`}>
                      <div className="h-full rounded-full bg-paid transition-[width]" style={{ width: `${t.bill.percent}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-paid">Pago {formatBRL(t.bill.paidCents)} · {t.bill.percent}%</span>
                      <span className="tabular-nums text-slate-600">Falta {formatBRL(t.bill.remainingCents)}</span>
                    </div>
                    {t.paying && <p className="mt-3 text-sm text-brand-700">Pix de {formatBRL(t.paying.amountCents)} aguardando o cliente…</p>}
                    {!t.paying && t.bill.mode && t.bill.share && (
                      <p className="mt-3 text-sm text-slate-600">Próxima: pessoa {t.bill.share.number} de {t.bill.share.of} · {formatBRL(t.bill.nextChargeCents)}</p>
                    )}
                    {!t.bill.mode && <p className="mt-3 text-sm text-slate-600">Aguardando o cliente escolher integral ou dividido no QR da mesa.</p>}
                    <div className="mt-4 flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setAmount(t.bill!.totalCents); setTotalFor(t); }}>Corrigir valor</Button>
                      {t.bill.mode && !t.paying && (
                        <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/tables/${t.id}/bill/reset-split`, { method: 'POST' }))}>Refazer divisão</Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!t.paying}
                        onClick={() => {
                          if (window.confirm(`Cancelar a conta da ${t.name}? ${t.bill!.paidCents ? `Já foram pagos ${formatBRL(t.bill!.paidCents)}.` : ''}`)) {
                            void run(() => api(`/tables/${t.id}/bill/cancel`, { method: 'POST' }));
                          }
                        }}
                      >
                        Cancelar conta
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="mt-6 flex flex-1 items-end">
                    <Button className="w-full" onClick={() => { setAmount(null); setOpenFor(t); }}>Abrir conta</Button>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
                  <Link href={`/app/mesas/placa?slug=${t.publicSlug}&nome=${encodeURIComponent(t.name)}`} className="text-brand-700 hover:underline">Placa com QR da mesa</Link>
                  {can('tables:manage') && !t.bill && (
                    <button type="button" className="text-slate-500 hover:underline" onClick={() => { if (window.confirm(`Remover a ${t.name}?`)) void run(() => api(`/tables/${t.id}`, { method: 'DELETE' })); }}>
                      Remover
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!openFor} onOpenChange={(o) => !o && setOpenFor(null)} title={`Abrir conta · ${openFor?.name ?? ''}`}>
        <form onSubmit={openBill} className="flex flex-col gap-4">
          <Field label="Valor total da conta">{(p) => <MoneyInput {...p} autoFocus valueCents={amount} onChange={setAmount} />}</Field>
          <p className="text-sm text-slate-600">O cliente escaneia o QR da mesa e escolhe pagar integral ou dividido. Você acompanha aqui até 100%.</p>
          <Button type="submit" loading={busy} disabled={!amount}>Abrir conta {amount ? formatBRL(amount) : ''}</Button>
        </form>
      </Dialog>

      <Dialog open={!!totalFor} onOpenChange={(o) => !o && setTotalFor(null)} title={`Corrigir valor · ${totalFor?.name ?? ''}`}>
        <form onSubmit={updateTotal} className="flex flex-col gap-4">
          <Field label="Novo valor total">{(p) => <MoneyInput {...p} key={totalFor?.id} autoFocus valueCents={amount} onChange={setAmount} />}</Field>
          {totalFor?.bill?.paidCents ? <p className="text-sm text-slate-600">Já pago: {formatBRL(totalFor.bill.paidCents)}. O novo valor precisa ser maior.</p> : null}
          <Button type="submit" loading={busy} disabled={!amount}>Salvar valor</Button>
        </form>
      </Dialog>

      {creating && <CreateTableDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void tables.reload(); }} />}
    </>
  );
}

function CreateTableDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const stores = useApi<StoreItem[]>('/stores');
  const pos = useApi<PosItem[]>('/pos');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [storeId, setStoreId] = useState('');
  const [posId, setPosId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mpStores = (stores.data ?? []).filter((s) => s.mpStoreId && s.status === 'ACTIVE');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/tables', { method: 'POST', body: mode === 'new' ? { name, storeId } : { name, posId } });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Nova mesa">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nome da mesa">{(p) => <Input {...p} required maxLength={40} autoFocus placeholder="Mesa 7" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="flex gap-2" role="radiogroup" aria-label="POS da mesa">
          {([['new', 'Criar POS novo'], ['existing', 'Usar POS existente']] as const).map(([m, l]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm ring-1 ${mode === m ? 'bg-brand-50 font-medium text-brand-700 ring-brand-600' : 'ring-line'}`}>
              {l}
            </button>
          ))}
        </div>
        {mode === 'new' ? (
          <Field label="Loja" hint="O POS é criado no Mercado Pago com o nome da mesa e conta no limite de POS do plano.">
            {(p) => (
              <Select {...p} required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="" disabled>Escolha a loja</option>
                {mpStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="POS">
            {(p) => (
              <Select {...p} required value={posId} onChange={(e) => setPosId(e.target.value)}>
                <option value="" disabled>Escolha o POS</option>
                {(pos.data ?? []).filter((x) => x.status === 'ACTIVE').map((x) => <option key={x.id} value={x.id}>{x.storeName} · {x.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Button type="submit" loading={busy} disabled={!name.trim() || (mode === 'new' ? !storeId : !posId)}>Criar mesa</Button>
      </form>
    </Dialog>
  );
}
