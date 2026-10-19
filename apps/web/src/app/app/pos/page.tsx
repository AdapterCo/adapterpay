'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { CopyButton } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, POS_STATUS_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Pos {
  id: string;
  name: string;
  storeId: string;
  storeName: string | null;
  mpConnectionId: string;
  mpPosId: string;
  externalId: string | null;
  status: string;
  orderReady: boolean;
  notReadyReason: string | null;
  hasBrCode: boolean;
  publicUrl: string;
  activeChargeId: string | null;
  lastSyncAt: string | null;
  syncError: string | null;
  canReadBrCode: boolean;
}

interface Store {
  id: string;
  name: string;
  status: string;
  mpStoreId: string | null;
  mpConnection: { id: string; nickname: string | null; mpUserId: string } | null;
}

interface RemotePos {
  mpPosId: string;
  name: string;
  externalId: string | null;
  externalIdValid: boolean;
  suggestedStore: { id: string; name: string } | null;
  importedAs: { id: string } | null;
}

const READY_REASON: Record<string, string> = {
  POS_INACTIVE: 'POS inativo',
  EXTERNAL_ID_INVALID: 'external_id inválido para Orders',
  BRCODE_INVALID: 'BR Code ausente ou inválido',
};

export default function PosPage() {
  const pos = useApi<Pos[]>('/pos');
  const stores = useApi<Store[]>('/stores');
  const conns = useApi<Array<{ id: string; nickname: string | null; mpUserId: string; status: string }>>('/integrations/mercado-pago/connections');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ storeId: '', name: '', activate: true });
  const [importOpen, setImportOpen] = useState(false);
  const [importConn, setImportConn] = useState('');
  const [remote, setRemote] = useState<RemotePos[] | null>(null);
  const [sel, setSel] = useState<Record<string, { checked: boolean; storeId: string; activate: boolean }>>({});
  const [brcode, setBrcode] = useState<{ name: string; code: string | null } | null>(null);

  const eligibleStores = (stores.data ?? []).filter((s) => s.status === 'ACTIVE' && s.mpStoreId && s.mpConnection);
  const activeConns = (conns.data ?? []).filter((c) => c.status === 'ACTIVE');

  const run = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id);
    setError(null);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await pos.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    await run('create', async () => {
      await api('/pos', { method: 'POST', body: form });
      setCreateOpen(false);
      setForm({ storeId: '', name: '', activate: true });
      return 'POS criado no Mercado Pago e sincronizado.';
    });
  };

  const loadRemote = async (connId: string) => {
    setImportConn(connId);
    setRemote(null);
    if (!connId) return;
    try {
      const items = await api<RemotePos[]>('/pos/import/preview', { method: 'POST', body: { mpConnectionId: connId } });
      setRemote(items);
      const init: typeof sel = {};
      items.forEach((r) => {
        if (!r.importedAs) init[r.mpPosId] = { checked: false, storeId: r.suggestedStore?.id ?? '', activate: r.externalIdValid };
      });
      setSel(init);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmImport = async () => {
    const items = Object.entries(sel)
      .filter(([, v]) => v.checked && v.storeId)
      .map(([mpPosId, v]) => ({ mpPosId, storeId: v.storeId, activate: v.activate }));
    await run('import', async () => {
      const r = await api<{ results: Array<{ status: string; error?: string }> }>('/pos/import/confirm', { method: 'POST', body: { mpConnectionId: importConn, items } });
      setImportOpen(false);
      const errs = r.results.filter((x) => x.status === 'error');
      return `${r.results.length - errs.length} POS importado(s).${errs.length ? ` Erros: ${errs.map((x) => x.error).join('; ')}` : ''}`;
    });
  };

  return (
    <>
      <PageHeader
        title="POS"
        description="Cada POS é um caixa com QR estático no Mercado Pago. Ele atende uma cobrança por vez."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)} disabled={activeConns.length === 0}>Importar existentes</Button>
            <Button onClick={() => setCreateOpen(true)} disabled={eligibleStores.length === 0}>Criar POS no Mercado Pago</Button>
          </>
        }
      />
      {eligibleStores.length === 0 && stores.data && (
        <Alert tone="info" className="mb-4">Para criar um POS, tenha uma loja ativa vinculada a uma loja do Mercado Pago (crie ou importe em Lojas).</Alert>
      )}
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <Card>
        {pos.loading && !pos.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : pos.data?.length === 0 ? (
          <EmptyState title="Nenhum POS" description="Crie um POS no Mercado Pago ou importe os que você já usa." />
        ) : (
          <Table>
            <thead><tr><Th>POS</Th><Th>Status</Th><Th>Pronto p/ cobrar</Th><Th>IDs Mercado Pago</Th><Th>Página pública</Th><Th>Sincronização</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pos.data?.map((p) => (
                <tr key={p.id} className="align-top">
                  <Td>
                    <p className="font-medium text-ink">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.storeName}</p>
                  </Td>
                  <Td>
                    <Badge tone={p.status === 'ACTIVE' ? 'success' : p.status === 'NEEDS_REGULARIZATION' || p.status === 'REMOTE_MISSING' ? 'warning' : 'neutral'}>
                      {POS_STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                    {p.activeChargeId && <Link href={`/app/cobrancas/${p.activeChargeId}`} className="mt-1 block text-xs text-brand-700 underline">cobrança em andamento</Link>}
                  </Td>
                  <Td>{p.orderReady ? <Badge tone="success">Sim</Badge> : <span className="text-xs text-slate-500">{READY_REASON[p.notReadyReason ?? ''] ?? p.notReadyReason}</span>}</Td>
                  <Td className="text-xs">
                    <span className="block">POS {p.mpPosId}</span>
                    <span className="block font-mono text-slate-500">ext: {p.externalId ?? '—'}</span>
                  </Td>
                  <Td className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      <CopyButton text={p.publicUrl} label="Copiar URL" size="sm" />
                      <Link href={`/app/pos/${p.id}/placa`}><Button size="sm" variant="secondary">Placa / NFC</Button></Link>
                    </div>
                  </Td>
                  <Td className="whitespace-normal text-xs">
                    {formatDateTime(p.lastSyncAt)}
                    {p.syncError && <span className="block max-w-56 text-amber-700">{p.syncError}</span>}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <Button size="sm" variant="ghost" loading={busy === `s${p.id}`} onClick={() => run(`s${p.id}`, async () => {
                        const r = await api<{ divergences: string[] }>(`/pos/${p.id}/sync`, { method: 'POST' });
                        return r.divergences.length ? `Divergências: ${r.divergences.join(', ')}` : 'POS sincronizado.';
                      })}>Sincronizar</Button>
                      {p.status === 'NEEDS_REGULARIZATION' && (
                        <Button size="sm" variant="ghost" loading={busy === `r${p.id}`} onClick={() => run(`r${p.id}`, async () => {
                          const r = await api<{ externalId: string }>(`/pos/${p.id}/regularize`, { method: 'POST' });
                          return `external_id regularizado no Mercado Pago: ${r.externalId}`;
                        })}>Regularizar</Button>
                      )}
                      {p.status === 'ACTIVE' ? (
                        <Button size="sm" variant="ghost" loading={busy === `d${p.id}`} onClick={() => run(`d${p.id}`, async () => { await api(`/pos/${p.id}/deactivate`, { method: 'POST' }); })}>Desativar</Button>
                      ) : (
                        p.status !== 'NEEDS_REGULARIZATION' && (
                          <Button size="sm" variant="ghost" loading={busy === `a${p.id}`} onClick={() => run(`a${p.id}`, async () => { await api(`/pos/${p.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }); return 'POS ativado.'; })}>Ativar</Button>
                        )
                      )}
                      {p.canReadBrCode && p.hasBrCode && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try {
                            const r = await api<{ qrCode: string | null }>(`/pos/${p.id}/brcode`);
                            setBrcode({ name: p.name, code: r.qrCode });
                          } catch (err) {
                            setError(errorMessage(err));
                          }
                        }}>Ver BR Code</Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Criar POS no Mercado Pago" description="O POS é criado na conta vinculada à loja, com external_id único gerado pelo AdapterPay.">
        <form onSubmit={create} className="flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Loja">
            {(p) => (
              <Select {...p} required value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
                <option value="">Selecione</option>
                {eligibleStores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.mpConnection?.nickname ?? s.mpConnection?.mpUserId})</option>)}
              </Select>
            )}
          </Field>
          <Field label="Nome do caixa" hint="Ex.: Caixa 1">
            {(p) => <Input {...p} required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Checkbox checked={form.activate} onChange={(e) => setForm({ ...form, activate: e.target.checked })} label="Ativar agora (respeitando o limite do plano)" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={busy === 'create'} disabled={!form.storeId || !form.name}>Criar</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen} title="Importar POS existentes" description="Selecione a loja interna de cada POS. Sem limite disponível, o POS fica em revisão.">
        <div className="flex flex-col gap-3">
          <Field label="Conta Mercado Pago">
            {(p) => (
              <Select {...p} value={importConn} onChange={(e) => void loadRemote(e.target.value)}>
                <option value="">Selecione</option>
                {activeConns.map((c) => <option key={c.id} value={c.id}>{c.nickname ?? c.mpUserId}</option>)}
              </Select>
            )}
          </Field>
          {importConn && remote === null && <Spinner className="h-5 w-5 text-brand-600" />}
          {remote?.length === 0 && <p className="text-sm text-slate-500">Nenhum POS encontrado.</p>}
          {remote && remote.length > 0 && (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {remote.map((r) => (
                <li key={r.mpPosId} className="flex flex-col gap-2 px-3 py-2">
                  {r.importedAs ? (
                    <span className="text-sm text-slate-500">{r.name} · <Badge>Já importado</Badge></span>
                  ) : (
                    <>
                      <Checkbox checked={sel[r.mpPosId]?.checked ?? false} onChange={(e) => setSel({ ...sel, [r.mpPosId]: { ...sel[r.mpPosId]!, checked: e.target.checked } })} label={`${r.name} (POS ${r.mpPosId})`} />
                      {!r.externalIdValid && <p className="text-xs text-amber-700">external_id ausente/inválido: será importado para regularização.</p>}
                      <Select aria-label={`Loja interna para ${r.name}`} value={sel[r.mpPosId]?.storeId ?? ''} onChange={(e) => setSel({ ...sel, [r.mpPosId]: { ...sel[r.mpPosId]!, storeId: e.target.value } })}>
                        <option value="">Loja interna…</option>
                        {(stores.data ?? []).filter((s) => s.mpConnection?.id === importConn).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Fechar</Button>
            <Button loading={busy === 'import'} onClick={confirmImport} disabled={!Object.values(sel).some((v) => v.checked && v.storeId)}>Importar</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!brcode} onOpenChange={(o) => !o && setBrcode(null)} title={`BR Code — ${brcode?.name ?? ''}`} description="Código Pix estático do POS no Mercado Pago. Acesso registrado em auditoria.">
        <p className="break-all rounded bg-slate-100 p-3 font-mono text-xs">{brcode?.code}</p>
        {brcode?.code && <CopyButton text={brcode.code} label="Copiar" size="sm" className="mt-3" />}
      </Dialog>
    </>
  );
}
