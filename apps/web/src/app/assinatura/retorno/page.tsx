'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

/**
 * Retorno do checkout de cartão. Não confia em parâmetros da URL: consulta o backend,
 * que verifica a assinatura no Mercado Pago por polling.
 */
export default function SubscriptionReturnPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let stop = false;
    const tick = async (n: number) => {
      try {
        const r = await api<{ status: string; preapprovalStatus: string | null }>('/subscriptions/card/refresh', { method: 'POST' });
        if (stop) return;
        setStatus(r.status);
        setAttempts(n);
        if (r.status !== 'ACTIVE' && n < 20) setTimeout(() => void tick(n + 1), 6000);
      } catch (err) {
        if (!stop) setError(errorMessage(err));
      }
    };
    void tick(1);
    return () => {
      stop = true;
    };
  }, []);

  return (
    <AuthShell title="Confirmando sua assinatura">
      {error && <Alert tone="danger">{error}</Alert>}
      {status === 'ACTIVE' ? (
        <>
          <Alert tone="success" title="Assinatura ativa">O primeiro pagamento foi confirmado. Seu acesso está liberado.</Alert>
          <Link href="/app" className="mt-6 block">
            <Button className="w-full">Ir para o painel</Button>
          </Link>
        </>
      ) : (
        !error && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
              <Spinner className="h-4 w-4" /> Verificando o pagamento no Mercado Pago…
            </p>
            {attempts >= 20 && (
              <Alert tone="warning">
                A confirmação está demorando. Você pode acompanhar em <Link href="/app/assinatura" className="underline">Assinatura</Link>. O acesso é liberado assim que o pagamento for aprovado.
              </Alert>
            )}
          </div>
        )
      )}
    </AuthShell>
  );
}
