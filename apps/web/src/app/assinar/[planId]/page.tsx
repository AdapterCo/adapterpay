'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Button, Card } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { InvoicePix } from '@/components/invoice-pix';
import { api, errorMessage } from '@/lib/api';

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  maxPos: number;
  maxStores: number;
  maxUsers: number;
}

/** Checkout da assinatura: Pix manual (recebedor Adapter Co.) ou cartão recorrente (checkout Mercado Pago). */
export default function CheckoutPage() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState<'PIX' | 'CARD' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Plan[]>('/plans')
      .then((ps) => setPlan(ps.find((p) => p.id === planId) ?? null))
      .catch(() => setPlan(null));
  }, [planId]);

  const start = async (method: 'PIX' | 'CARD') => {
    setLoading(method);
    setError(null);
    try {
      const res = await api<{ invoiceId?: string; redirectUrl?: string }>('/subscriptions/checkout', {
        method: 'POST',
        body: { planId, method },
      });
      if (res.redirectUrl) {
        const url = new URL(res.redirectUrl);
        // Redireciona somente para o checkout oficial do Mercado Pago.
        if (!/(^|\.)mercadopago\.com(\.br)?$/.test(url.hostname)) throw new Error('Destino de checkout inesperado');
        window.location.assign(url.toString());
        return;
      }
      if (res.invoiceId) setInvoiceId(res.invoiceId);
    } catch (err) {
      setError(err instanceof Error && !(err as { code?: string }).code ? err.message : errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  return (
    <AuthShell title="Contratar plano" subtitle="O acesso é liberado assim que o pagamento é confirmado.">
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {plan ? (
        <Card className="mb-5 p-4">
          <p className="font-semibold">Plano {plan.name}</p>
          <p className="text-2xl font-bold tabular-nums">
            {formatBRL(plan.priceCents)}
            <span className="text-sm font-normal text-slate-500">/mês</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {plan.maxPos} POS · {plan.maxStores} lojas · {plan.maxUsers} usuários
          </p>
        </Card>
      ) : (
        <Alert tone="warning" className="mb-4">Plano não encontrado. <Link href="/planos" className="underline">Ver planos</Link></Alert>
      )}

      {invoiceId ? (
        <InvoicePix invoiceId={invoiceId} onPaid={() => setTimeout(() => router.replace('/app?ativado=1'), 1500)} />
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={() => start('PIX')} loading={loading === 'PIX'} disabled={!plan || !!loading}>
            Pagar com Pix
          </Button>
          <p className="-mt-1 text-xs text-slate-500">O Pix é pago manualmente a cada mês. Uma nova fatura fica disponível antes de cada vencimento.</p>
          <Button size="lg" variant="secondary" onClick={() => start('CARD')} loading={loading === 'CARD'} disabled={!plan || !!loading}>
            Assinar com cartão de crédito
          </Button>
          <p className="-mt-1 text-xs text-slate-500">Você será levado ao checkout seguro do Mercado Pago. O AdapterPay não recebe os dados do cartão.</p>
        </div>
      )}
    </AuthShell>
  );
}
