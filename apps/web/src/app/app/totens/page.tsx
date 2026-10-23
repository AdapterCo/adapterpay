'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface TotemList {
  totemPriceCents: number | null;
  planName: string | null;
  totemQuantity: number;
  items: Array<{
    id: string;
    name: string;
    posId: string;
    posName: string;
    storeName: string;
    paired: boolean;
    pairingPending: boolean;
    lastSeenAt: string | null;
  }>;
}

interface PosItem {
  id: string;
  name: string;
  storeName: string | null;
  orderReady: boolean;
}

/** Totens de autoatendimento: criar, parear o tablet com um código e revogar. */
export default function TotemsPage() {
  const critical = useCritical();
  const totems = useApi<TotemList>('/totems');
  const [pos, setPos] = useState<PosItem[]>([]);
  const [name, setName] = useState('');
  const [posId, setPosId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ name: string; code: string; expiresAt: string } | null>(null);

  useEffect(() => {
    api<PosItem[]>('/pos').then(setPos).catch(() => undefined);
  }, []);

  const used = new Set((totems.data?.items ?? []).map((t) => t.posId));
  const freePos = pos.filter((p) => !used.has(p.id));
  const price = totems.data?.totemPriceCents ?? null;
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await critical(() =>
        api<{ id: string; pairingCode: string; pairingExpiresAt: string }>('/totems', { method: 'POST', body: { name, posId } }),
      );
      setPairing({ name, code: r.pairingCode, expiresAt: r.pairingExpiresAt });
      setName('');
      setPosId('');
      await totems.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const newCode = async (t: TotemList['items'][number]) => {
    setError(null);
    try {
      const r = await api<{ pairingCode: string; pairingExpiresAt: string }>(`/totems/${t.id}/pairing-code`, { method: 'POST' });
      setPairing({ name: t.name, code: r.pairingCode, expiresAt: r.pairingExpiresAt });
      await totems.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const revoke = async (t: TotemList['items'][number]) => {
    if (!window.confirm(`Revogar o totem "${t.name}"? O tablet perde o acesso na hora.`)) return;
    setError(null);
    try {
      await critical(() => api(`/totems/${t.id}`, { method: 'DELETE' }));
      await totems.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title="Totens" description="Autoatendimento em tablet: o cliente escolhe os produtos, vê o total e paga por Pix." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {totems.data && price === null && (
        <Alert tone="warning" className="mb-4" title="Seu plano não inclui totens">
          Fale com a Adapter Co. para liberar o adicional de totem no plano {totems.data.planName ?? 'atual'}.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          {totems.loading && !totems.data ? (
            <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
          ) : !totems.data?.items.length ? (
            <EmptyState title="Nenhum totem ainda" description="Crie um totem ao lado e digite o código de pareamento no tablet." />
          ) : (
            <Table>
              <thead><tr><Th>Totem</Th><Th>Caixa</Th><Th>Situação</Th><Th>Visto por último</Th><Th className="text-right">Ações</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {totems.data.items.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td className="text-slate-600">{t.storeName} · {t.posName}</Td>
                    <Td>
                      {t.paired ? <Badge tone="success">Pareado</Badge> : t.pairingPending ? <Badge tone="warning">Aguardando código</Badge> : <Badge>Não pareado</Badge>}
                    </Td>
                    <Td className="text-slate-600">{t.lastSeenAt ? formatDateTime(t.lastSeenAt) : '—'}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void newCode(t)}>Novo código</Button>
                        <Button size="sm" variant="ghost" onClick={() => void revoke(t)}>Revogar</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader
            title="Novo totem"
            description={price !== null ? `${formatBRL(price)} por mês por totem, cobrado a partir da próxima renovação.` : undefined}
          />
          <CardBody>
            <form onSubmit={create} className="flex flex-col gap-3">
              <Field label="Nome">{(p) => <Input {...p} required maxLength={60} placeholder="Totem da entrada" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Caixa (POS) do totem" hint="Use um POS só para o totem: o Mercado Pago aceita uma cobrança por vez em cada POS.">
                {(p) => (
                  <Select {...p} required value={posId} onChange={(e) => setPosId(e.target.value)}>
                    <option value="" disabled>Escolha o POS</option>
                    {freePos.map((x) => (
                      <option key={x.id} value={x.id} disabled={!x.orderReady}>
                        {x.storeName} · {x.name}{!x.orderReady ? ' (indisponível)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" loading={busy} disabled={price === null || !name.trim() || !posId}>Criar e gerar código</Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Dialog open={!!pairing} onOpenChange={(o) => !o && setPairing(null)} title={`Parear ${pairing?.name ?? 'totem'}`}>
        {pairing && (
          <div className="flex flex-col items-center gap-4 text-center">
            <ol className="w-full list-decimal space-y-1 pl-5 text-left text-sm text-slate-700">
              <li>No tablet, abra <strong>{appOrigin}/totem</strong>.</li>
              <li>Digite o código abaixo e toque em Parear.</li>
              <li>Deixe o navegador em tela cheia (modo quiosque).</li>
            </ol>
            <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-ink" aria-label={`Código ${pairing.code.split('').join(' ')}`}>{pairing.code}</p>
            <p className="text-xs text-slate-500">Válido até {formatDateTime(pairing.expiresAt)}. Uso único.</p>
            <Button onClick={() => setPairing(null)}>Pronto</Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
