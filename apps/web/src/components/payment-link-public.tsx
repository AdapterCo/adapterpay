'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, type PublicPaymentLinkView } from '@adapterpay/shared';
import { Spinner } from '@adapterpay/ui';
import { useNow, useServerOffset } from '@/lib/hooks';
import { Logo, SIGNATURE } from './brand';
import { CopyButton } from './domain';
import { PlateQr } from './plate';

/** "23h 59min", "45 min", "menos de 1 min" */
function remainingLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`;
}

/**
 * Página que o cliente da loja abre pelo link enviado (WhatsApp, e-mail…). Mostra o Pix enquanto
 * o link está em aberto e confirma o pagamento sozinha: consulta a cada 4 s com a aba visível.
 */
export function PaymentLinkPublic({ token }: { token: string }) {
  const [view, setView] = useState<PublicPaymentLinkView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/public/payment-links/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as PublicPaymentLinkView);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = view?.state === 'PENDING';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 4_000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pending, load]);

  const offset = useServerOffset(view?.serverTime);
  const now = useNow(15_000);

  if (notFound) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Link não encontrado</h1>
        <p className="mt-2 text-sm text-slate-600">Confira o endereço ou peça um novo link para a loja.</p>
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

  const remaining = new Date(view.expiresAt).getTime() - (now + offset);
  const state = view.state === 'PENDING' && remaining <= 0 ? 'CHECKING' : view.state;

  return (
    <Shell>
      <div className="w-full">
        <p className="text-lg font-semibold leading-tight">{view.tradeName}</p>
        {view.storeName !== view.tradeName && <p className="mt-0.5 text-sm text-slate-500">{view.storeName}</p>}
      </div>

      {offline && (
        <p role="status" className="mt-4 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Conexão instável. Tentando atualizar…
        </p>
      )}

      <section className="mt-6 flex w-full flex-col items-center" aria-live="polite">
        {state === 'PENDING' && view.pixCopyPaste && (
          <>
            {view.customerFirstName && <p className="text-sm text-slate-500">Olá, {view.customerFirstName}. Valor a pagar</p>}
            <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatBRL(view.amountCents)}</p>
            {view.description && <p className="mt-1 text-sm text-slate-600">{view.description}</p>}
            <p className="mt-3 rounded-full bg-paper px-3 py-1 text-sm text-slate-700">
              Vale por mais <strong className="tabular-nums">{remainingLabel(remaining)}</strong>
            </p>
            <CopyButton text={view.pixCopyPaste} label="Copiar código Pix" copiedLabel="Código copiado" size="lg" className="mt-5 w-full" />
            <ol className="mt-4 w-full space-y-1.5 text-left text-sm text-slate-600">
              <li>1. Toque em Copiar código Pix.</li>
              <li>2. No app do banco, escolha Pix e depois Copia e Cola.</li>
              <li>3. Confira se o recebedor é {view.tradeName} e o valor é {formatBRL(view.amountCents)}, e pague.</li>
            </ol>
            <details className="mt-5 w-full rounded-lg bg-paper px-3 py-2 text-left text-sm text-slate-700">
              <summary className="cursor-pointer font-medium">Pagar com QR Code (em outro aparelho)</summary>
              <div className="mt-3 flex justify-center">
                <PlateQr value={view.pixCopyPaste} size={200} label={`QR Code Pix para pagar ${formatBRL(view.amountCents)} a ${view.tradeName}`} />
              </div>
            </details>
            <p className="mt-4 text-xs text-slate-500">Depois de pagar, a confirmação aparece nesta tela.</p>
          </>
        )}

        {state === 'PAID' && (
          <>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-paid" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-paid">Pagamento confirmado</h1>
            <p className="mt-1 text-lg tabular-nums">{formatBRL(view.amountCents)}</p>
            {view.description && <p className="mt-1 text-sm text-slate-600">{view.description}</p>}
            <p className="mt-2 text-sm text-slate-600">Obrigado{view.customerFirstName ? `, ${view.customerFirstName}` : ''}. A loja já foi avisada. Não é preciso pagar de novo.</p>
          </>
        )}

        {state === 'CHECKING' && (
          <>
            <Spinner className="h-8 w-8 text-brand-600" />
            <h1 className="mt-4 text-xl font-semibold">Verificando o pagamento</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">O prazo deste link terminou. Se você já pagou, a confirmação aparece aqui em instantes.</p>
          </>
        )}

        {state === 'EXPIRED' && (
          <>
            <h1 className="text-2xl font-semibold">Link expirado</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">Este link valia por 24 horas. Não use o código antigo: peça um novo link para {view.tradeName}.</p>
          </>
        )}

        {state === 'CANCELLED' && (
          <>
            <h1 className="text-2xl font-semibold">Link cancelado</h1>
            <p className="mt-2 max-w-xs text-sm text-slate-600">A loja cancelou esta cobrança. Se ainda precisar pagar, peça um novo link para {view.tradeName}.</p>
          </>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <main id="conteudo" className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <div className="flex flex-col items-center rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-line">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-500">Pagamento recebido pelo Mercado Pago na conta da loja. Comprovante sem valor fiscal.</p>
      </main>
      <footer className="flex flex-col items-center gap-1 pb-6 text-xs text-slate-400">
        <Logo />
        {SIGNATURE}
      </footer>
    </div>
  );
}
