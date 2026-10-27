'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Spinner } from '@adapterpay/ui';
import { Logo, SIGNATURE } from '@/components/brand';
import { CopyButton } from '@/components/domain';
import { GoogleReviewButton } from '@/components/google-review';
import { PlateQr } from '@/components/plate';
import { ApiError } from '@/lib/api';

interface TableView {
  tableName: string;
  storeName: string;
  tradeName: string;
  logoUrl: string | null;
  brandColor: string | null;
  googleReviewUrl: string | null;
  serverTime: string;
  bill: null | {
    id: string;
    state: 'OPEN' | 'PAID';
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
  charge: null | { id: string; state: 'PENDING' | 'PREPARING'; amountCents: number; label: string | null; expiresAt: string | null; pixCopyPaste: string | null };
}

async function call<T>(slug: string, path = '', body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/public/tables/${encodeURIComponent(slug)}${path}`, {
    method: body === undefined && !path ? 'GET' : 'POST',
    headers: { Accept: 'application/json', 'X-AdapterPay-Table': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? 'Erro inesperado');
  return data as T;
}

const MY_CHARGE_KEY = 'adapterpay:mesa-charge';

/**
 * Página da mesa (QR da mesa): integral ou dividido. No dividido, cada pessoa paga a vez dela;
 * quando o Pix de uma pessoa é confirmado, a próxima já pode pagar. Atualiza sozinha.
 */
export default function TablePage() {
  const { slug } = useParams<{ slug: string }>();
  const [view, setView] = useState<TableView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(2);
  const [choosing, setChoosing] = useState<null | 'SPLIT'>(null);
  const [myCharge, setMyCharge] = useState<string | null>(null);
  const [myPaid, setMyPaid] = useState(false);
  const lastPaidShares = useRef<number | null>(null);
  const [turnNotice, setTurnNotice] = useState(false);

  useEffect(() => {
    try {
      setMyCharge(window.sessionStorage.getItem(`${MY_CHARGE_KEY}:${slug}`));
    } catch {
      /* navegação privada */
    }
  }, [slug]);

  const load = useCallback(async () => {
    try {
      const v = await call<TableView>(slug);
      setView((prev) => {
        // Minha parte foi paga: a cobrança que eu gerei saiu da tela e o total pago subiu.
        if (myCharge && prev?.charge?.id === myCharge && v.charge?.id !== myCharge && (v.bill?.paidCents ?? 0) > (prev.bill?.paidCents ?? 0)) {
          setMyPaid(true);
        }
        return v;
      });
      const shares = v.bill?.paidShares ?? 0;
      if (lastPaidShares.current !== null && shares > lastPaidShares.current && v.bill?.state === 'OPEN') setTurnNotice(true);
      lastPaidShares.current = shares;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    }
  }, [slug, myCharge]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2_500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!turnNotice) return;
    const t = setTimeout(() => setTurnNotice(false), 6_000);
    return () => clearTimeout(t);
  }, [turnNotice]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const v = await call<TableView & { chargeId?: string }>(slug, path, body ?? {});
      if (v.chargeId) {
        setMyCharge(v.chargeId);
        setMyPaid(false);
        try {
          window.sessionStorage.setItem(`${MY_CHARGE_KEY}:${slug}`, v.chargeId);
        } catch {
          /* navegação privada */
        }
      }
      setView(v);
      setChoosing(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'POS_BUSY' ? 'Alguém da mesa está pagando agora. Aguarde a confirmação e tente de novo.' : err instanceof ApiError ? err.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  };

  const style = { '--brand': view?.brandColor ?? '#005efe' } as CSSProperties;

  if (notFound) return <Shell style={style}><p className="text-xl font-semibold">Mesa não encontrada</p><p className="mt-2 text-sm text-slate-600">Peça ajuda ao garçom.</p></Shell>;
  if (!view) return <Shell style={style}><Spinner className="my-16 h-8 w-8 text-brand-600" /></Shell>;

  const b = view.bill;
  const c = view.charge;
  const mine = !!c && c.id === myCharge;

  return (
    <Shell style={style} after={<GoogleReviewButton url={view.googleReviewUrl} tradeName={view.tradeName} className="mt-4" />}>
      <div className="w-full text-left">
        <p className="text-sm text-slate-500">{view.tradeName}</p>
        <p className="text-3xl font-semibold leading-tight text-ink">{view.tableName}</p>
      </div>

      {!b && (
        <div className="mt-8 w-full">
          <p className="text-lg font-semibold">Nenhuma conta aberta nesta mesa</p>
          <p className="mt-1 text-sm text-slate-600">Peça a conta ao garçom. Esta página atualiza sozinha.</p>
        </div>
      )}

      {b && (
        <>
          <div className="mt-6 w-full rounded-2xl bg-paper p-4 text-left">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-600">Conta</span>
              <span className="text-2xl font-semibold tabular-nums">{formatBRL(b.totalCents)}</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuenow={b.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.percent}% pago`}>
              <div className="h-full rounded-full bg-paid transition-[width] duration-500" style={{ width: `${b.percent}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-paid">Pago {formatBRL(b.paidCents)}</span>
              <span className="tabular-nums text-slate-700">Falta {formatBRL(b.remainingCents)}</span>
            </div>
          </div>

          {turnNotice && b.share && !c && (
            <p role="status" className="mt-4 w-full rounded-xl bg-paid px-4 py-3 text-left font-semibold text-white">
              Pagamento confirmado! Pessoa {b.share.number}, agora é a sua vez.
            </p>
          )}

          {b.state === 'PAID' ? (
            <section className="mt-8 flex w-full flex-col items-center" aria-live="polite">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-paid" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <h1 className="mt-4 text-2xl font-semibold text-paid">Mesa paga. Obrigado!</h1>
            </section>
          ) : c ? (
            <section className="mt-6 flex w-full flex-col items-center" aria-live="polite">
              {mine ? (
                <>
                  <p className="text-sm text-slate-500">{c.label}</p>
                  <p className="text-5xl font-semibold tabular-nums">{formatBRL(c.amountCents)}</p>
                  {c.pixCopyPaste ? (
                    <>
                      <div className="mt-5"><PlateQr value={c.pixCopyPaste} size={200} label={`QR Code Pix de ${formatBRL(c.amountCents)}`} /></div>
                      <CopyButton text={c.pixCopyPaste} label="Copiar código Pix" copiedLabel="Código copiado" size="lg" className="mt-5 w-full" />
                      <ol className="mt-5 w-full space-y-1.5 text-left text-sm text-slate-600">
                        <li>1. No app do banco, escolha Pix e depois Copia e Cola.</li>
                        <li>2. Confira se o recebedor é {view.tradeName} e o valor é {formatBRL(c.amountCents)}.</li>
                        <li>3. Pague. A confirmação aparece aqui e libera a próxima pessoa.</li>
                      </ol>
                    </>
                  ) : (
                    <p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Spinner className="h-4 w-4" /> Preparando o Pix…</p>
                  )}
                  <button type="button" disabled={busy} onClick={() => void act('/cancel')} className="mt-5 text-sm text-slate-500 underline-offset-2 hover:underline">
                    Desistir deste Pix
                  </button>
                </>
              ) : (
                <>
                  <Spinner className="h-8 w-8 text-brand-600" />
                  <p className="mt-4 text-lg font-semibold">{c.label ?? 'Alguém da mesa'} está pagando</p>
                  <p className="mt-1 text-sm text-slate-600">Aguarde a confirmação. Quando terminar, aparece a sua vez aqui.</p>
                </>
              )}
            </section>
          ) : !b.mode || choosing ? (
            <section className="mt-6 w-full">
              {choosing === 'SPLIT' ? (
                <>
                  <p className="text-lg font-semibold">Dividir em quantas pessoas?</p>
                  <div className="mt-4 flex items-center justify-center gap-6">
                    <button type="button" aria-label="Menos uma pessoa" onClick={() => setPeople((p) => Math.max(2, p - 1))} className="h-14 w-14 rounded-full bg-paper text-3xl">−</button>
                    <span className="w-16 text-center text-5xl font-semibold tabular-nums" aria-live="polite">{people}</span>
                    <button type="button" aria-label="Mais uma pessoa" onClick={() => setPeople((p) => Math.min(20, p + 1))} className="h-14 w-14 rounded-full bg-paper text-3xl">+</button>
                  </div>
                  <p className="mt-3 text-center text-sm text-slate-600">Cerca de {formatBRL(Math.ceil(b.remainingCents / people))} por pessoa</p>
                  <button type="button" disabled={busy} onClick={() => void act('/choose', { mode: 'SPLIT', people })} className="mt-5 h-14 w-full rounded-xl bg-[var(--brand)] text-lg font-semibold text-white disabled:opacity-60">
                    Dividir em {people}
                  </button>
                  <button type="button" onClick={() => setChoosing(null)} className="mt-3 w-full text-sm text-slate-500">Voltar</button>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold">Como vocês vão pagar?</p>
                  <button type="button" disabled={busy} onClick={() => void act('/choose', { mode: 'FULL' })} className="mt-4 flex h-16 w-full items-center justify-between rounded-xl bg-[var(--brand)] px-5 text-white disabled:opacity-60">
                    <span className="text-lg font-semibold">Pagar integral</span>
                    <span className="tabular-nums">{formatBRL(b.remainingCents)}</span>
                  </button>
                  <button type="button" disabled={busy} onClick={() => setChoosing('SPLIT')} className="mt-3 flex h-16 w-full items-center justify-between rounded-xl bg-white px-5 ring-1 ring-line">
                    <span className="text-lg font-semibold text-ink">Pagar dividido</span>
                    <span className="text-sm text-slate-600">cada um paga a sua parte</span>
                  </button>
                </>
              )}
            </section>
          ) : (
            <section className="mt-6 w-full">
              {myPaid && (
                <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-left text-paid">
                  <p className="font-semibold">Sua parte foi paga. Obrigado!</p>
                </div>
              )}
              {b.share ? (
                <p className="text-lg font-semibold">Pessoa {b.share.number} de {b.share.of}, é a sua vez</p>
              ) : (
                <p className="text-lg font-semibold">Pagamento integral</p>
              )}
              <p className="mt-1 text-sm text-slate-600">Valor desta parte</p>
              <p className="text-5xl font-semibold tabular-nums">{formatBRL(b.nextChargeCents)}</p>
              <button type="button" disabled={busy} onClick={() => void act('/pay')} className="mt-5 h-16 w-full rounded-xl bg-[var(--brand)] text-lg font-semibold text-white disabled:opacity-60">
                {busy ? 'Gerando o Pix…' : b.share ? 'Pagar minha parte' : 'Pagar a conta'}
              </button>
              <button type="button" disabled={busy} onClick={() => setChoosing(b.mode === 'SPLIT' ? null : 'SPLIT')} className="mt-3 w-full text-sm text-slate-500 underline-offset-2 hover:underline">
                {b.mode === 'SPLIT' ? 'Mudar a forma de pagar' : 'Prefiro dividir'}
              </button>
            </section>
          )}

          {error && <p role="alert" className="mt-4 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">{error}</p>}
        </>
      )}
    </Shell>
  );
}

function Shell({ children, style, after }: { children: React.ReactNode; style?: CSSProperties; after?: React.ReactNode }) {
  return (
    <div style={style} className="flex min-h-dvh flex-col bg-paper">
      <main id="conteudo" className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <div className="flex flex-col items-center rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-line">{children}</div>
        {after}
        <p className="mt-4 text-center text-xs text-slate-500">Pagamento recebido pelo Mercado Pago na conta do estabelecimento. Comprovante sem valor fiscal.</p>
      </main>
      <footer className="flex flex-col items-center gap-1 pb-6 text-xs text-slate-400">
        <Logo />
        {SIGNATURE}
      </footer>
    </div>
  );
}
