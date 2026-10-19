'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, type PublicChargeView, type PublicPosView } from '@adapterpay/shared';
import { Spinner } from '@adapterpay/ui';
import { useEventStream, useNow, useServerOffset } from '@/lib/hooks';
import { LogoMark, SIGNATURE } from './brand';
import { CopyButton, Countdown, QrImage } from './domain';

type View = PublicPosView | PublicChargeView;

/**
 * Página pública de pagamento. Mostra apenas dados seguros. O QR Pix exibido é a representação
 * do BR Code do POS Mercado Pago (qr_response.qr_code), somente enquanto a cobrança está ativa.
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
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">Página indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">Este endereço não está ativo. Peça ao vendedor uma nova cobrança.</p>
        </div>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      </Shell>
    );
  }

  const c = view.charge;
  const locallyExpired = c.state === 'PENDING' && !!c.expiresAt && new Date(c.expiresAt).getTime() <= now + offset;
  const state = locallyExpired ? 'UNAVAILABLE' : c.state;
  const accent = view.brandColor ?? '#0e8468';

  return (
    <Shell>
      <header className="flex items-center gap-3 border-b border-slate-100 pb-4">
        {view.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.logoUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold text-white" style={{ backgroundColor: accent }} aria-hidden="true">
            {view.storeName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{view.storeName}</p>
          <p className="truncate text-sm text-slate-500">
            {view.posName}
            {c.sellerName && state === 'PENDING' ? ` · Atendimento: ${c.sellerName}` : ''}
          </p>
        </div>
      </header>

      {offline && (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Conexão instável. Tentando atualizar…
        </p>
      )}

      <section className="py-6 text-center" aria-live="polite">
        {state === 'WAITING' && (
          <div className="py-10">
            <span className="mx-auto block h-3 w-3 animate-ping rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
            <h1 className="mt-6 text-2xl font-semibold">Aguardando cobrança</h1>
            <p className="mt-2 text-sm text-slate-600">Quando o vendedor gerar a cobrança, o valor e o Pix aparecem aqui automaticamente.</p>
          </div>
        )}

        {state === 'PENDING' && c.pixCopyPaste && c.expiresAt && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-slate-500">Valor a pagar</p>
            <p className="text-5xl font-bold tabular-nums tracking-tight">{formatBRL(c.amountCents)}</p>
            {c.description && <p className="text-sm text-slate-600">{c.description}</p>}
            <p className="text-sm text-slate-600">
              Expira em <strong><Countdown expiresAt={c.expiresAt} serverOffsetMs={offset} now={now} /></strong>
            </p>
            <QrImage value={c.pixCopyPaste} size={240} label={`QR Code Pix para pagar ${formatBRL(c.amountCents)} a ${view.storeName}`} />
            <CopyButton text={c.pixCopyPaste} label="Copiar código Pix" copiedLabel="Código copiado!" size="lg" className="w-full max-w-xs" />
            <ol className="mt-2 space-y-1 text-left text-sm text-slate-600">
              <li>1. Abra o app do seu banco e escolha <strong>Pix › Copia e Cola</strong> ou <strong>ler QR Code</strong>.</li>
              <li>2. Confira se o recebedor é <strong>{view.tradeName}</strong> e o valor é <strong>{formatBRL(c.amountCents)}</strong>.</li>
              <li>3. Confirme o pagamento. Esta página mostra a confirmação.</li>
            </ol>
          </div>
        )}

        {state === 'PAID' && (
          <div className="py-8">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-emerald-700">Pagamento confirmado</h1>
            {c.amountCents !== null && <p className="mt-1 text-lg tabular-nums">{formatBRL(c.amountCents)}</p>}
            <p className="mt-2 text-sm text-slate-600">Obrigado! Não é necessário pagar novamente.</p>
          </div>
        )}

        {state === 'EXPIRED' && (
          <div className="py-8">
            <h1 className="text-2xl font-semibold">Cobrança expirada</h1>
            <p className="mt-2 text-sm text-slate-600">Não pague com códigos antigos. Peça ao vendedor uma nova cobrança.</p>
          </div>
        )}

        {state === 'CANCELLED' && (
          <div className="py-8">
            <h1 className="text-2xl font-semibold">Cobrança encerrada</h1>
            <p className="mt-2 text-sm text-slate-600">Esta cobrança foi cancelada. Peça ao vendedor uma nova cobrança.</p>
          </div>
        )}

        {state === 'UNAVAILABLE' && (
          <div className="py-8">
            <Spinner className="mx-auto h-8 w-8 text-brand-600" />
            <h1 className="mt-4 text-xl font-semibold">Verificando a cobrança</h1>
            <p className="mt-2 text-sm text-slate-600">Aguarde um instante. Se você já pagou, a confirmação aparece aqui. Se ainda não pagou, peça ao vendedor uma nova cobrança.</p>
          </div>
        )}
      </section>

      {kind === 'pos' && state === 'PENDING' && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
          Mais de uma pessoa no mesmo caixa? Confirme com o vendedor que esta cobrança é a sua.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <main id="conteudo" className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-500">
          Pagamento processado pelo Mercado Pago na conta da loja. Este comprovante não tem valor fiscal.
        </p>
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-slate-500">
        <LogoMark className="h-4 w-4" /> AdapterPay · {SIGNATURE}
      </footer>
    </div>
  );
}
