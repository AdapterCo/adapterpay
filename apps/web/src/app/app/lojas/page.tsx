'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Store {
  id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  mpStoreId: string | null;
  mpConnection: { id: string; nickname: string | null; mpUserId: string; status: string } | null;
  posCount: number;
  lastSyncAt: string | null;
  syncError: string | null;
}

interface Connection {
  id: string;
  nickname: string | null;
  mpUserId: string;
  status: string;
}

interface RemoteStore {
  mpStoreId: string;
  name: string;
  externalId: string | null;
  importedAs: { id: string; name: string } | null;
}

const emptyForm = {
  name: '',
  timezone: 'America/Sao_Paulo',
  mpConnectionId: '',
  createRemote: false,
  activate: true,
  streetName: '',
  streetNumber: '',
  cityName: '',
  stateName: '',
  zipCode: '',
  reference: '',
  coords: '',
};

/** Aceita "-23.5505, -46.6333" (formato copiado do Google Maps). */
function parseCoords(v: string): { latitude: number; longitude: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(v.replace(/−/g, '-'));
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export default function StoresPage() {
  const stores = useApi<Store[]>('/stores');
  const conns = useApi<Connection[]>('/integrations/mercado-pago/connections');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importConn, setImportConn] = useState('');
  const [remote, setRemote] = useState<RemoteStore[] | null>(null);
  const [selected, setSelected] = useState<Record<string, { checked: boolean; activate: boolean }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeConns = (conns.data ?? []).filter((c) => c.status === 'ACTIVE');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const hasAddress = form.streetName && form.streetNumber && form.cityName && form.stateName;
      const coords = parseCoords(form.coords);
      if (form.createRemote && !coords) {
        setError('Informe as coordenadas da loja no formato -23.5505, -46.6333 (copie do Google Maps).');
        setSaving(false);
        return;
      }
      await api('/stores', {
        method: 'POST',
        body: {
          name: form.name,
          timezone: form.timezone,
          mpConnectionId: form.mpConnectionId || undefined,
          createRemote: form.createRemote,
          activate: form.activate,
          address: hasAddress
            ? {
                streetName: form.streetName,
                streetNumber: form.streetNumber,
                cityName: form.cityName,
                stateName: form.stateName,
                zipCode: form.zipCode || undefined,
                reference: form.reference || undefined,
                ...(coords ?? {}),
              }
            : undefined,
        },
      });
      setCreateOpen(false);
      setForm(emptyForm);
      setMsg('Loja cadastrada.');
      await stores.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const loadRemote = async (connId: string) => {
    setImportConn(connId);
    setRemote(null);
    setError(null);
    if (!connId) return;
    try {
      setRemote(await api<RemoteStore[]>('/stores/import/preview', { method: 'POST', body: { mpConnectionId: connId } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmImport = async () => {
    const items = Object.entries(selected)
      .filter(([, v]) => v.checked)
      .map(([mpStoreId, v]) => ({ mpStoreId, activate: v.activate }));
    if (items.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ results: Array<{ status: string; error?: string }> }>('/stores/import/confirm', {
        method: 'POST',
        body: { mpConnectionId: importConn, items },
      });
      const errors = r.results.filter((x) => x.status === 'error');
      setMsg(`${r.results.length - errors.length} loja(s) importada(s).${errors.length ? ` ${errors.length} com erro: ${errors.map((x) => x.error).join('; ')}` : ''}`);
      setImportOpen(false);
      setSelected({});
      await stores.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Store) => {
    setBusyId(s.id);
    setError(null);
    try {
      await api(`/stores/${s.id}`, { method: 'PATCH', body: { status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } });
      await stores.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const sync = async (s: Store) => {
    setBusyId(s.id);
    setError(null);
    try {
      const r = await api<{ divergences: string[] }>(`/stores/${s.id}/sync`, { method: 'POST' });
      setMsg(r.divergences.length ? `Sincronizada com divergências: ${r.divergences.join(', ')}` : 'Loja e POS sincronizados.');
      await stores.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Lojas"
        description="Cadastre lojas, vincule à conta Mercado Pago recebedora ou importe lojas que já existem."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)} disabled={activeConns.length === 0}>Importar do Mercado Pago</Button>
            <Button onClick={() => setCreateOpen(true)}>Nova loja</Button>
          </>
        }
      />
      {activeConns.length === 0 && conns.data && (
        <Alert tone="info" className="mb-4">Conecte uma conta Mercado Pago para criar ou importar lojas e POS no provedor.</Alert>
      )}
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <Card>
        {stores.loading && !stores.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : stores.data?.length === 0 ? (
          <EmptyState title="Nenhuma loja cadastrada" description="Crie a primeira loja ou importe do Mercado Pago." />
        ) : (
          <Table>
            <thead><tr><Th>Loja</Th><Th>Status</Th><Th>Mercado Pago</Th><Th>POS</Th><Th>Fuso</Th><Th>Sincronização</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {stores.data?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-ink">{s.name}</Td>
                  <Td><Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{s.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</Badge></Td>
                  <Td>
                    {s.mpConnection ? (
                      <span className="text-xs">{s.mpConnection.nickname ?? s.mpConnection.mpUserId}{s.mpStoreId ? ` · loja ${s.mpStoreId}` : ' · sem loja remota'}</span>
                    ) : (
                      <span className="text-xs text-slate-400">não vinculada</span>
                    )}
                  </Td>
                  <Td>{s.posCount}</Td>
                  <Td className="text-xs">{s.timezone}</Td>
                  <Td className="text-xs">
                    {formatDateTime(s.lastSyncAt)}
                    {s.syncError && <span className="block text-amber-700">{s.syncError}</span>}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {s.mpStoreId && <Button size="sm" variant="ghost" loading={busyId === s.id} onClick={() => sync(s)}>Sincronizar</Button>}
                      <Button size="sm" variant="ghost" loading={busyId === s.id} onClick={() => toggle(s)}>{s.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Nova loja" description="A loja conta no limite do plano quando ativa.">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
          <Field label="Nome da loja" className="sm:col-span-2">
            {(p) => <Input {...p} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Conta Mercado Pago recebedora" className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={form.mpConnectionId} onChange={(e) => setForm({ ...form, mpConnectionId: e.target.value })}>
                <option value="">Vincular depois</option>
                {activeConns.map((c) => <option key={c.id} value={c.id}>{c.nickname ?? c.mpUserId}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Fuso horário" className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'].map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox className="sm:col-span-2" checked={form.createRemote} disabled={!form.mpConnectionId} onChange={(e) => setForm({ ...form, createRemote: e.target.checked })} label="Criar também a loja no Mercado Pago (obrigatório para criar POS pelo AdapterPay)" />
          {form.createRemote && (
            <>
              <Field label="Rua">{(p) => <Input {...p} required value={form.streetName} onChange={(e) => setForm({ ...form, streetName: e.target.value })} />}</Field>
              <Field label="Número">{(p) => <Input {...p} required value={form.streetNumber} onChange={(e) => setForm({ ...form, streetNumber: e.target.value })} />}</Field>
              <Field label="Cidade">{(p) => <Input {...p} required value={form.cityName} onChange={(e) => setForm({ ...form, cityName: e.target.value })} />}</Field>
              <Field label="Estado">{(p) => <Input {...p} required value={form.stateName} onChange={(e) => setForm({ ...form, stateName: e.target.value })} />}</Field>
              <Field label="CEP">{(p) => <Input {...p} value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />}</Field>
              <Field label="Referência">{(p) => <Input {...p} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
              <Field label="Coordenadas (latitude, longitude)" className="sm:col-span-2" hint="No Google Maps, clique com o botão direito no local da loja e clique nos números para copiar. Ex.: -23.5505, -46.6333">
                {(p) => <Input {...p} required inputMode="decimal" placeholder="-23.5505, -46.6333" value={form.coords} onChange={(e) => setForm({ ...form, coords: e.target.value })} />}
              </Field>
              <p className="text-xs text-slate-500 sm:col-span-2">Escreva estado e cidade por extenso e com acento, como no Mercado Pago (ex.: São Paulo / São Paulo).</p>
            </>
          )}
          <Checkbox className="sm:col-span-2" checked={form.activate} onChange={(e) => setForm({ ...form, activate: e.target.checked })} label="Ativar agora (respeitando o limite do plano)" />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Salvar</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen} title="Importar lojas do Mercado Pago" description="Lojas já importadas aparecem marcadas. Sem limite disponível, a loja é importada inativa para revisão.">
        <div className="flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Conta Mercado Pago">
            {(p) => (
              <Select {...p} value={importConn} onChange={(e) => void loadRemote(e.target.value)}>
                <option value="">Selecione</option>
                {activeConns.map((c) => <option key={c.id} value={c.id}>{c.nickname ?? c.mpUserId}</option>)}
              </Select>
            )}
          </Field>
          {importConn && remote === null && <Spinner className="h-5 w-5 text-brand-600" />}
          {remote?.length === 0 && <p className="text-sm text-slate-500">Nenhuma loja encontrada nesta conta.</p>}
          {remote && remote.length > 0 && (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {remote.map((r) => (
                <li key={r.mpStoreId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  {r.importedAs ? (
                    <span className="text-sm text-slate-500">{r.name} · <Badge>Já importada</Badge></span>
                  ) : (
                    <>
                      <Checkbox
                        checked={selected[r.mpStoreId]?.checked ?? false}
                        onChange={(e) => setSelected({ ...selected, [r.mpStoreId]: { checked: e.target.checked, activate: selected[r.mpStoreId]?.activate ?? true } })}
                        label={`${r.name} (${r.mpStoreId})`}
                      />
                      <Checkbox
                        checked={selected[r.mpStoreId]?.activate ?? true}
                        onChange={(e) => setSelected({ ...selected, [r.mpStoreId]: { checked: selected[r.mpStoreId]?.checked ?? false, activate: e.target.checked } })}
                        label="ativar"
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Fechar</Button>
            <Button loading={saving} onClick={confirmImport} disabled={!Object.values(selected).some((v) => v.checked)}>Importar selecionadas</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
