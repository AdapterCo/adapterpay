'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createPaymentLinkSchema,
  formatBRL,
  formatBrWhatsApp,
  PAYMENT_LINK_STATUS_LABEL,
  paymentLinkMessage,
  whatsAppShareUrl,
  type PaymentLinkStatus,
} from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td, Th } from '@adapterpay/ui';
import { CopyButton, Money, MoneyInput } from '@/components/domain';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi, useNow } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface LinkRow {
  id: string;
  customerName: string;
  customerPhone: string | null;
  description: string | null;
  amountCents: number;
  status: PaymentLinkStatus;
  url: string;
  storeName: string;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  netAmountCents: number | null;
}

type Summary = Record<PaymentLinkStatus, { count: number; amountCents: number }>;

const TABS: Array<{ value: '' | PaymentLinkStatus; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'PENDING', label: 'Em aberto' },
  { value: 'PAID', label: 'Pagos' },
  { value: 'EXPIRED', label: 'Expirados' },
  { value: 'CANCELLED', label: 'Cancelados' },
];

const TONE: Record<PaymentLinkStatus, 'warning' | 'success' | 'neutral' | 'danger'> = {
  PENDING: 'warning',
  PAID: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
};

/** "vence em 5h", "vence em 40 min" */
function dueIn(expiresAt: string, now: number): string {
  const min = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  if (min <= 0) return 'verificando';
  if (min < 60) return `vence em ${min} min`;
  return `vence em ${Math.floor(min / 60)}h`;
}

export default function PaymentLinksPage() {
  const { can, me } = useSession();
  const tradeName = me?.tenant?.tradeName ?? 'a loja';
  const [tab, setTab] = useState<'' | PaymentLinkStatus>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<LinkRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useNow(30_000);
  const stores = useApi<Array<{ id: string; name: string }>>('/stores');

  // Busca enquanto digita, sem uma requisição por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQ(search.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const path = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (tab) p.set('status', tab);
    if (storeId) p.set('storeId', storeId);
    return `/payment-links?${p.toString()}`;
  }, [q, tab, storeId, page]);
  const list = useApi<{ total: number; items: LinkRow[]; summary: Summary }>(path);

  // Atualiza quando chega a notificação "Link pago" e, com links em aberto na tela, a cada 20 s.
  const hasPending = !!list.data?.items.some((l) => l.status === 'PENDING');
  useEffect(() => {
    const h = (e: Event) => {
      if (((e as CustomEvent).detail as { type?: string }).type === 'notification.created') void list.reload();
    };
    window.addEventListener('adapterpay:event', h);
    const t = hasPending ? setInterval(() => document.visibilityState === 'visible' && void list.reload(), 20_000) : null;
    return () => {
      window.removeEventListener('adapterpay:event', h);
      if (t) clearInterval(t);
    };
  }, [list.reload, hasPending]);

  const check = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const l = await api<LinkRow>(`/payment-links/${id}`);
      if (l.status === 'PENDING') setActionError(`Ainda não consta pagamento de ${l.customerName}.`);
      await list.reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (l: LinkRow) => {
    if (!window.confirm(`Cancelar o link de ${l.customerName} (${formatBRL(l.amountCents)})? O cliente não vai mais conseguir pagar por ele.`)) return;
    setBusyId(l.id);
    setActionError(null);
    try {
      await api(`/payment-links/${l.id}/cancel`, { method: 'POST' });
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
      await list.reload();
    }
  };

  const s = list.data?.summary;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  const multiStore = (stores.data?.length ?? 0) > 1;

  return (
    <>
      <PageHeader
        title="Links de pagamento"
        description="Envie um link Pix para o cliente pagar de onde estiver. Cada link vale por 24 horas e mostra aqui quando é pago."
        actions={can('charges:create') && <Button onClick={() => setCreating(true)}>Novo link</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Em aberto" value={s ? formatBRL(s.PENDING.amountCents) : '—'} hint={s ? `${s.PENDING.count} ${s.PENDING.count === 1 ? 'link' : 'links'}` : undefined} />
        <Stat label="Pagos" value={s ? formatBRL(s.PAID.amountCents) : '—'} hint={s ? `${s.PAID.count} ${s.PAID.count === 1 ? 'link' : 'links'}` : undefined} />
        <Stat label="Expirados sem pagamento" value={s ? String(s.EXPIRED.count) : '—'} hint={s ? formatBRL(s.EXPIRED.amountCents) : undefined} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-4 pt-3" role="tablist" aria-label="Situação do link">
          {TABS.map((t) => {
            const count = !s ? null : t.value ? s[t.value].count : Object.values(s).reduce((a, x) => a + x.count, 0);
            const active = tab === t.value;
            return (
              <button
                key={t.value || 'all'}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPage(1);
                  setTab(t.value);
                }}
                className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {t.label}
                {count !== null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input
            type="search"
            aria-label="Buscar pelo nome do cliente"
            placeholder="Buscar pelo nome do cliente"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {multiStore && (
            <Select aria-label="Loja" className="max-w-52" value={storeId} onChange={(e) => { setPage(1); setStoreId(e.target.value); }}>
              <option value="">Todas as lojas</option>
              {stores.data?.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </Select>
          )}
        </div>

        {(list.error || actionError) && <Alert tone={list.error ? 'danger' : 'warning'} className="m-4">{list.error?.message ?? actionError}</Alert>}

        {list.loading && !list.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState
            title={q || tab ? 'Nenhum link encontrado' : 'Nenhum link enviado ainda'}
            description={q || tab ? 'Confira o nome digitado ou mude a aba.' : 'Crie um link, envie pelo WhatsApp e acompanhe aqui quem pagou.'}
            action={!q && !tab && can('charges:create') ? <Button onClick={() => setCreating(true)}>Criar primeiro link</Button> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
                <Th>Criado</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data?.items.map((l) => {
                const message = paymentLinkMessage({ customerName: l.customerName, tradeName, amount: formatBRL(l.amountCents), description: l.description, url: l.url });
                return (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <Td className="whitespace-normal">
                      <p className="font-medium text-ink">{l.customerName}</p>
                      <p className="text-xs text-slate-500">
                        {[l.description, l.customerPhone ? formatBrWhatsApp(l.customerPhone) : null, multiStore ? l.storeName : null].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </Td>
                    <Td className="text-right font-medium"><Money cents={l.amountCents} /></Td>
                    <Td>
                      <Badge tone={TONE[l.status]}>{PAYMENT_LINK_STATUS_LABEL[l.status]}</Badge>
                      <p className="mt-1 text-xs text-slate-500">
                        {l.status === 'PENDING' && dueIn(l.expiresAt, now)}
                        {l.status === 'PAID' && l.paidAt && `em ${formatDateTime(l.paidAt)}`}
                        {l.status === 'EXPIRED' && `venceu em ${formatDateTime(l.expiresAt)}`}
                        {l.status === 'CANCELLED' && l.cancelledAt && `em ${formatDateTime(l.cancelledAt)}`}
                      </p>
                    </Td>
                    <Td>
                      <p>{formatDateTime(l.createdAt)}</p>
                      <p className="text-xs text-slate-500">por {l.createdByName}</p>
                    </Td>
                    <Td className="text-right">
                      {l.status === 'PENDING' ? (
                        <div className="flex justify-end gap-1.5">
                          <CopyButton text={l.url} label="Copiar link" copiedLabel="Copiado" size="sm" />
                          <a href={whatsAppShareUrl(l.customerPhone, message)} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="secondary">WhatsApp</Button>
                          </a>
                          <Button size="sm" variant="ghost" disabled={busyId === l.id} onClick={() => void check(l.id)}>Verificar</Button>
                          {can('charges:cancel') && (
                            <Button size="sm" variant="ghost" className="text-red-600" disabled={busyId === l.id} onClick={() => void cancel(l)}>Cancelar</Button>
                          )}
                        </div>
                      ) : l.status === 'PAID' && l.netAmountCents !== null ? (
                        <span className="text-xs text-slate-500">Líquido <Money cents={l.netAmountCents} /></span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">Página {page} de {pages} · {list.data?.total} links</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>

      <NewLinkDialog
        open={creating}
        stores={stores.data ?? []}
        tradeName={tradeName}
        created={created}
        onClose={() => {
          setCreating(false);
          setCreated(null);
        }}
        onAnother={() => setCreated(null)}
        onCreated={(l) => {
          setCreated(l);
          setTab('');
          setSearch('');
          void list.reload();
        }}
      />
    </>
  );
}

function NewLinkDialog({
  open,
  stores,
  tradeName,
  created,
  onClose,
  onAnother,
  onCreated,
}: {
  open: boolean;
  stores: Array<{ id: string; name: string }>;
  tradeName: string;
  created: LinkRow | null;
  onClose: () => void;
  onAnother: () => void;
  onCreated: (l: LinkRow) => void;
}) {
  const [storeId, setStoreId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [description, setDescription] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!storeId && stores.length > 0) setStoreId(stores[0]!.id);
  }, [stores, storeId]);

  const reset = () => {
    setCustomerName('');
    setCustomerPhone('');
    setDescription('');
    setAmountCents(null);
    setErrors({});
    setSubmitError(null);
    setFormKey((k) => k + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const parsed = createPaymentLinkSchema.safeParse({
      storeId,
      customerName,
      customerPhone: customerPhone || undefined,
      description: description || undefined,
      amountCents: amountCents ?? 0,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.path[0] === 'amountCents' && !amountCents ? 'Informe o valor' : i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const l = await api<LinkRow>('/payment-links', { method: 'POST', body: parsed.data });
      reset();
      onCreated(l);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Não foi possível criar o link. Tente de novo.');
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  if (created) {
    const message = paymentLinkMessage({ customerName: created.customerName, tradeName, amount: formatBRL(created.amountCents), description: created.description, url: created.url });
    return (
      <Dialog open={open} onOpenChange={(o) => !o && close()} title="Link criado" description={`Envie para ${created.customerName}. Ele vale por 24 horas.`}>
        <div className="rounded-lg bg-paper p-3">
          <p className="text-sm text-slate-500">{created.customerName}{created.description ? ` · ${created.description}` : ''}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatBRL(created.amountCents)}</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-600">{created.url}</p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a href={whatsAppShareUrl(created.customerPhone, message)} target="_blank" rel="noopener noreferrer">
            <Button className="w-full">Enviar no WhatsApp</Button>
          </a>
          <CopyButton text={created.url} label="Copiar link" copiedLabel="Link copiado" className="w-full" />
        </div>
        <CopyButton text={message} label="Copiar mensagem completa" copiedLabel="Mensagem copiada" size="sm" className="mt-2 w-full" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onAnother}>Criar outro link</Button>
          <Button variant="ghost" onClick={close}>Concluir</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="Novo link de pagamento" description="O cliente paga por Pix na conta Mercado Pago da loja. O link vale por 24 horas.">
      <form key={formKey} onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        {stores.length > 1 && (
          <Field label="Loja">
            {(p) => (
              <Select {...p} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Nome do cliente" error={errors.customerName} hint="Usado para buscar e identificar quem pagou.">
          {(p) => <Input {...p} value={customerName} onChange={(e) => setCustomerName(e.target.value)} autoComplete="off" maxLength={120} />}
        </Field>
        <Field label="Valor" error={errors.amountCents}>
          {(p) => <MoneyInput {...p} valueCents={amountCents} onChange={setAmountCents} />}
        </Field>
        <Field label="Descrição (opcional)" error={errors.description} hint="Aparece para o cliente. Ex.: Pedido 123, Mensalidade de novembro.">
          {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} />}
        </Field>
        <Field label="WhatsApp do cliente (opcional)" error={errors.customerPhone} hint="Para abrir a conversa já com a mensagem pronta.">
          {(p) => <Input {...p} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} inputMode="tel" placeholder="(11) 98765-4321" />}
        </Field>
        {errors.storeId && <Alert tone="danger">Escolha a loja.</Alert>}
        {submitError && <Alert tone="danger">{submitError}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>{submitting ? 'Gerando Pix…' : 'Criar link'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
