'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, type PublicChargeView, type PublicPosView } from '@adapterpay/shared';
import { Spinner } from '@adapterpay/ui';
import { useEventStream, useNow, useServerOffset } from '@/lib/hooks';
import { Logo, SIGNATURE } from './brand';
import { CopyButton, Countdown } from './domain';
import { PlateQr } from './plate';

type View = PublicPosView | PublicChargeView;

/**
 * Página pública de pagamento no formato da placa do caixa: quem aproxima o celular vê na tela
 * o mesmo objeto que está no balcão. Mostra apenas dados seguros. O QR e o botão de copiar usam
 * o BR Code do POS (qr_response.qr_code), somente enquanto a cobrança está ativa.
 * Atualização por SSE do nosso backend, com fallback de polling a cada 3s.
 */
export function PublicPayment({ kind, id }: { kind: 'pos' | 'charge'; id: string }) {
  const base = kind === 'pos' ? `/api/v1/public/pos/${encodeURIComponent(id)}` : `/api/v1/public/charges/${encodeURIComponent(id)}`;
  const [view, setView] = useState<View | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as View);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEventStream(notFound ? null : `${base}/events`, { state: (d) => setView(d as View) }, () => void load());

  const offset = useServerOffset(view?.charge.serverTime);
  const now = useNow(1000);

  if (notFound) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Este caixa não está disponível</h1>
        <p className="mt-2 text-sm text-slate-600">Peça ao vendedor uma nova cobrança.</p>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <Spinner className="my-16 h-8 w-8 text-brand-600" />
      </Shell>
    );
  }

  const c = view.charge;
  const locallyExpired = c.state === 'PENDING' && !!c.expiresAt && new Date(c.expiresAt).getTime() <= now + offset;
  const state = locallyExpired ? 'UNAVAILABLE' : c.state;

  return (
    <Shell>
      <div className="w-full">
        <p className="text-lg font-semibold leading-tight">{view.storeName}</p>
        <p className="mt-0.5 text-sm text-slate-500">
          {view.posName}
          {c.sellerName && state === 'PENDING' ? `, atendimento de ${c.sellerName}` : ''}
        </p>
      </div>

      {offline && (
        <p role="status" className="mt-4 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Conexão instável. Tentando atualizar…
        </p>
      )}

      <section className="mt-6 flex w-full flex-col items-center" aria-live="polite">
        {state === 'WAITING' && (
          <>
            <span className="relative flex h-3 w-3" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-600" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold">Aguardando cobrança</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Quando o vendedor gerar a cobrança, o valor e o Pix aparecem aqui sozinhos.</p>
          </>
        )}

        {state === 'PENDING' && c.pixCopyPaste && c.expiresAt && (
          <>
            <p className="text-sm text-slate-500">Valor a pagar</p>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatBRL(c.amountCents)}</p>
            {c.description && <p className="mt-1 text-sm text-slate-600">{c.description}</p>}
            <p className="mt-3 rounded-full bg-paper px-3 py-1 text-sm text-slate-700">
              Expira em <strong className="tabular-nums"><Countdown expiresAt={c.expiresAt} serverOffsetMs={offset} now={now} /></strong>
            </p>
            <div className="mt-5">
              <PlateQr value={c.pixCopyPaste} size={200} label={`QR Code Pix para pagar ${formatBRL(c.amountCents)} a ${view.storeName}`} />
            </div>
            <CopyButton text={c.pixCopyPaste} label="Copiar código Pix" copiedLabel="Código copiado" size="lg" className="mt-5 w-full" />
            <ol className="mt-5 w-full space-y-1.5 text-left text-sm text-slate-600">
              <li>1. No app do banco, escolha Pix e depois Copia e Cola.</li>
              <li>2. Confira se o recebedor é {view.tradeName} e o valor é {formatBRL(c.amountCents)}.</li>
              <li>3. Pague. A confirmação aparece nesta tela.</li>
            </ol>
          </>
        )}

        {state === 'PAID' && (
          <>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-paid" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-paid">Pagamento confirmado</h1>
            {c.amountCents !== null && <p className="mt-1 text-lg tabular-nums">{formatBRL(c.amountCents)}</p>}
            <p className="mt-2 text-sm text-slate-600">Obrigado. Não é preciso pagar de novo.</p>
          </>
        )}

        {state === 'EXPIRED' && (
          <>
            <h1 className="text-2xl font-semibold">Cobrança expirada</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Não use códigos antigos. Peça ao vendedor uma nova cobrança.</p>
          </>
        )}

        {state === 'CANCELLED' && (
          <>
            <h1 className="text-2xl font-semibold">Cobrança encerrada</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Esta cobrança foi cancelada. Peça ao vendedor uma nova cobrança.</p>
          </>
        )}

        {state === 'UNAVAILABLE' && (
          <>
            <Spinner className="h-8 w-8 text-brand-600" />
            <h1 className="mt-4 text-xl font-semibold">Verificando a cobrança</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Se você já pagou, a confirmação aparece aqui. Se ainda não pagou, peça ao vendedor uma nova cobrança.</p>
          </>
        )}
      </section>

      {kind === 'pos' && state === 'PENDING' && (
        <p className="mt-5 w-full rounded-lg bg-paper px-3 py-2 text-xs text-slate-600">
          Mais de uma pessoa no caixa? Confirme com o vendedor que esta cobrança é a sua.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <main id="conteudo" className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <div className="flex flex-col items-center rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-line">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-500">
          Pagamento recebido pelo Mercado Pago na conta da loja. Comprovante sem valor fiscal.
        </p>
      </main>
      <footer className="flex flex-col items-center gap-1 pb-6 text-xs text-slate-400">
        <Logo />
        {SIGNATURE}
      </footer>
    </div>
  );
}
