'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatBRL, MAX_CHARGE_CENTS } from '@adapterpay/shared';
import { Alert, Button, Card, CardBody, Field, Input, PageHeader, Select, Spinner } from '@adapterpay/ui';
import { ChargeStatusBadge, CopyButton, Countdown, MoneyInput, QrImage } from '@/components/domain';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useNow, useServerOffset } from '@/lib/hooks';

interface PosItem {
  id: string;
  name: string;
  storeId: string;
  storeName: string | null;
  status: string;
  orderReady: boolean;
  notReadyReason: string | null;
  activeChargeId: string | null;
  publicUrl: string;
}

interface ChargeDetail {
  id: string;
  status: string;
  statusReason: string | null;
  amountCents: number;
  externalReference: string;
  orderId: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  serverTime: string;
  publicChargeUrl: string;
  publicPosUrl: string;
  posName: string;
  storeName: string;
}

const LAST_POS_KEY = 'adapterpay:last-pos';

/** Cobrança rápida: o vendedor define o valor; o backend cria a Order e acompanha por polling. */
export default function NewChargePage() {
  const [posList, setPosList] = useState<PosItem[] | null>(null);
  const [posId, setPosId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ remainingSeconds: number | null; chargeId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => {
    api<PosItem[]>('/pos')
      .then((items) => {
        setPosList(items);
        const ready = items.filter((p) => p.orderReady);
        const last = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_POS_KEY) : null;
        setPosId((last && ready.some((p) => p.id === last) ? last : ready[0]?.id) ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      setCharge(await api<ChargeDetail>(`/charges/${id}`));
    } catch {
      /* mantém último estado */
    }
  }, []);

  // Atualização em tempo real (SSE do painel) + fallback de consulta ao NOSSO backend.
  useEffect(() => {
    if (!charge) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; chargeId?: string };
      if (d.type === 'charge.updated' && d.chargeId === charge.id) void refresh(charge.id);
    };
    window.addEventListener('adapterpay:event', h);
    const active = ['CREATING', 'PENDING', 'RECONCILING'].includes(charge.status);
    const t = active ? setInterval(() => void refresh(charge.id), 3000) : null;
    return () => {
      window.removeEventListener('adapterpay:event', h);
      if (t) clearInterval(t);
    };
  }, [charge, refresh]);

  const offset = useServerOffset(charge?.serverTime);
  const now = useNow(1000);
  const selected = useMemo(() => posList?.find((p) => p.id === posId) ?? null, [posList, posId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(null);
    if (!posId) return setError('Selecione um POS');
    if (!amount || amount <= 0 || amount > MAX_CHARGE_CENTS) return setError('Informe um valor válido');
    setSubmitting(true);
    try {
      const created = await api<ChargeDetail>('/charges', {
        method: 'POST',
        body: { posId, amountCents: amount, ...(description.trim() ? { description: description.trim() } : {}) },
        headers: { 'Idempotency-Key': idemKey.current },
      });
      window.localStorage.setItem(LAST_POS_KEY, posId);
      setCharge(created);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POS_BUSY') {
        const d = err.details as { remainingSeconds: number | null; chargeId: string };
        setBusy(d);
      } else {
        setError(errorMessage(err));
      }
      idemKey.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setCharge(null);
    setAmount(null);
    setDescription('');
    idemKey.current = newIdempotencyKey();
  };

  if (charge) {
    const live = charge.status === 'PENDING' && charge.expiresAt && new Date(charge.expiresAt).getTime() > now + offset;
    return (
      <>
        <PageHeader title="Cobrança gerada" description={`${charge.storeName} · ${charge.posName}`} />
        <Card className="mx-auto max-w-xl">
          <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
            <ChargeStatusBadge status={charge.status} />
            <p className="text-5xl font-bold tabular-nums">{formatBRL(charge.amountCents)}</p>
            {live && charge.expiresAt && (
              <p className="text-sm text-slate-600">
                Expira em <strong><Countdown expiresAt={charge.expiresAt} serverOffsetMs={offset} now={now} /></strong>
              </p>
            )}
            {charge.status === 'CREATING' && <p className="flex items-center gap-2 text-sm text-slate-600"><Spinner className="h-4 w-4" /> Criando a Order no Mercado Pago…</p>}
            {charge.status === 'PENDING' && (
              <Alert tone="info" className="w-full text-left">
                Peça ao cliente para aproximar o celular da placa NFC ou ler o QR do caixa. O valor e o Pix já estão na página pública do POS.
              </Alert>
            )}
            {charge.status === 'PAID' && <Alert tone="success" className="w-full" title="Pagamento confirmado">Confirmado em {formatDateTime(charge.paidAt)}.</Alert>}
            {charge.status === 'EXPIRED' && <Alert tone="warning" className="w-full">Cobrança expirada sem pagamento. O POS foi liberado.</Alert>}
            {charge.status === 'RECONCILING' && (
              <Alert tone="warning" className="w-full" title="Em conciliação">
                A confirmação ainda não é segura ({charge.statusReason}). O POS continua reservado e o sistema segue consultando o Mercado Pago.
              </Alert>
            )}
            {(charge.status === 'FAILED' || charge.status === 'CANCELLED') && <Alert tone="danger" className="w-full">Cobrança não concluída ({charge.statusReason}).</Alert>}

            {charge.status === 'PENDING' && (
              <div className="w-full rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-medium">Link individual desta cobrança</p>
                <p className="mt-1 text-xs text-slate-500">Válido só para esta Order, sem trocar para a próxima cobrança do POS.</p>
                <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row">
                  <QrImage value={charge.publicChargeUrl} size={120} label="QR do link individual da cobrança" />
                  <div className="flex w-full flex-col gap-2">
                    <Input readOnly value={charge.publicChargeUrl} aria-label="Link individual" onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton text={charge.publicChargeUrl} label="Copiar link" size="sm" />
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={reset} variant={charge.status === 'PENDING' ? 'secondary' : 'primary'}>Nova cobrança</Button>
              <Link href={`/app/cobrancas/${charge.id}`}><Button variant="ghost">Ver detalhes</Button></Link>
            </div>
            <p className="font-mono text-xs text-slate-400">{charge.externalReference}{charge.orderId ? ` · ${charge.orderId}` : ''}</p>
          </CardBody>
        </Card>
      </>
    );
  }

  const readyCount = posList?.filter((p) => p.orderReady).length ?? 0;

  return (
    <>
      <PageHeader title="Nova cobrança" description="O valor é definido por você e fixado no servidor. A cobrança vale por 3 minutos." />
      <Card className="mx-auto max-w-xl">
        <CardBody>
          {posList === null ? (
            <Spinner className="h-5 w-5 text-brand-600" />
          ) : readyCount === 0 ? (
            <Alert tone="warning" title="Nenhum POS pronto para cobrança">
              Ative um POS com conta Mercado Pago conectada. <Link href="/app/pos" className="underline">Ir para POS</Link>
            </Alert>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
              {error && <Alert tone="danger">{error}</Alert>}
              {busy && (
                <Alert tone="warning" title="POS ocupado">
                  Este POS já tem uma cobrança em andamento{busy.remainingSeconds !== null ? ` (cerca de ${busy.remainingSeconds}s restantes)` : ''}. Use outro POS ou aguarde.{' '}
                  <Link href={`/app/cobrancas/${busy.chargeId}`} className="underline">Ver cobrança ativa</Link>
                </Alert>
              )}
              <Field label="POS (caixa)">
                {(p) => (
                  <Select {...p} value={posId} onChange={(e) => setPosId(e.target.value)}>
                    {posList.map((pos) => (
                      <option key={pos.id} value={pos.id} disabled={!pos.orderReady}>
                        {pos.storeName} · {pos.name}
                        {!pos.orderReady ? ' (indisponível)' : pos.activeChargeId ? ' (ocupado)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Valor">
                {(p) => <MoneyInput {...p} autoFocus valueCents={amount} onChange={setAmount} />}
              </Field>
              <Field label="Descrição (opcional)" hint="Aparece para o cliente na página de pagamento.">
                {(p) => <Input {...p} maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} />}
              </Field>
              <Button type="submit" size="lg" loading={submitting} disabled={!amount || !selected?.orderReady}>
                Gerar cobrança {amount ? formatBRL(amount) : ''}
              </Button>
              {selected && (
                <p className="text-center text-xs text-slate-500">
                  Página pública deste POS: <a href={selected.publicUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">{selected.publicUrl}</a>
                </p>
              )}
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}
