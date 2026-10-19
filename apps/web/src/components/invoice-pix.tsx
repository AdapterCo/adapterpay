'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Button, Spinner } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { CopyButton, QrImage } from './domain';

export interface InvoiceView {
  id: string;
  kind: string;
  status: 'OPEN' | 'PAID' | 'VOID' | 'FAILED';
  method: string;
  amountCents: number;
  dueAt: string;
  paidAt: string | null;
  pix: { qrCode: string; qrBase64: string | null; expiresAt: string } | null;
}

/** Fatura Pix da assinatura (recebedor Adapter Co.). Confirmação por polling no backend. */
export function InvoicePix({ invoiceId, onPaid }: { invoiceId: string; onPaid?: () => void }) {
  const [inv, setInv] = useState<InvoiceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const v = await api<InvoiceView>(`/subscriptions/invoices/${invoiceId}/status`);
      setInv(v);
      if (v.status === 'PAID') onPaid?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [invoiceId, onPaid]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      setInv(await api<InvoiceView>(`/subscriptions/invoices/${invoiceId}/pix`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!inv || inv.status !== 'OPEN') return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [inv, refresh]);

  if (!inv) return <Spinner className="h-5 w-5 text-brand-600" />;
  if (inv.status === 'PAID') return <Alert tone="success" title="Pagamento confirmado">Fatura de {formatBRL(inv.amountCents)} paga em {formatDateTime(inv.paidAt)}.</Alert>;
  if (inv.status !== 'OPEN') return <Alert tone="warning">Esta fatura não está mais aberta.</Alert>;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {error && <Alert tone="danger" className="w-full">{error}</Alert>}
      <p className="text-3xl font-bold tabular-nums">{formatBRL(inv.amountCents)}</p>
      {inv.pix ? (
        <>
          <QrImage value={inv.pix.qrCode} size={220} label="QR Code Pix da fatura AdapterPay" />
          <CopyButton text={inv.pix.qrCode} label="Copiar código Pix" className="w-full max-w-xs" />
          <p className="text-xs text-slate-500">
            Código válido até {formatDateTime(inv.pix.expiresAt)}. Recebedor: Adapter Co. A confirmação aparece aqui automaticamente.
          </p>
          <p className="flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
            <Spinner className="h-4 w-4" /> Aguardando confirmação do pagamento…
          </p>
        </>
      ) : (
        <Button onClick={generate} loading={generating}>Gerar Pix da fatura</Button>
      )}
    </div>
  );
}
