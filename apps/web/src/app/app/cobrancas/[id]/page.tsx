'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { ChargeStatusBadge, CopyButton, Money } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { chargeLabel, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Detail {
  id: string;
  status: string;
  statusReason: string | null;
  amountCents: number;
  currency: string;
  description: string | null;
  externalReference: string;
  orderId: string | null;
  mpPaymentId: string | null;
  posName: string;
  storeName: string;
  seller: { id: string; name: string };
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  terminalAt: string | null;
  lastPolledAt: string | null;
  publicChargeUrl: string;
  publicPosUrl: string;
  payments: Array<{
    mpPaymentId: string;
    mpReferenceId: string | null;
    amountCents: number;
    paidAmountCents: number;
    feeCents: number | null;
    netAmountCents: number | null;
    method: string;
    status: string;
    statusDetail: string;
    confirmedAt: string;
    refundedAt: string | null;
  }>;
  events: Array<{ previousState: string | null; newState: string; reason: string | null; occurredAt: string }>;
  items: Array<{ name: string; unitPriceCents: number; quantity: number }>;
  discountCents: number;
  loyaltyCustomerName: string | null;
}

export default function ChargeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useSession();
  const critical = useCritical();
  const { data, error, reload } = useApi<Detail>(`/charges/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; chargeId?: string };
      if (d.type === 'charge.updated' && d.chargeId === id) void reload();
    };
    window.addEventListener('adapterpay:event', h);
    return () => window.removeEventListener('adapterpay:event', h);
  }, [id, reload]);

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner className="h-6 w-6 text-brand-600" />;

  const payment = data.payments[0];
  const canCancel =
    can('charges:cancel') && data.status === 'PENDING' && !!data.orderId && (me?.role === 'ADMIN' || data.seller.id === me?.user.id);

  const cancel = async () => {
    if (!confirm('Cancelar esta cobrança no Mercado Pago? O POS só é liberado após a confirmação do cancelamento.')) return;
    setCancelling(true);
    setActionError(null);
    try {
      await critical(() => api(`/charges/${id}/cancel`, { method: 'POST' }));
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Detalhes da cobrança"
        description={`${data.storeName} · ${data.posName}`}
        actions={
          <div className="no-print flex gap-2">
            {canCancel && <Button variant="danger" loading={cancelling} onClick={cancel}>Cancelar cobrança</Button>}
            <Button variant="secondary" onClick={() => window.print()}>Imprimir comprovante</Button>
          </div>
        }
      />
      {actionError && <Alert tone="danger" className="mb-4">{actionError}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2">Comprovante interno <ChargeStatusBadge status={data.status} /></span>} description="Documento sem valor fiscal. O AdapterPay não emite NF-e/NFC-e." />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Valor</dt><dd className="text-2xl font-semibold"><Money cents={data.amountCents} /></dd></div>
              <div><dt className="text-slate-500">Empresa</dt><dd>{me?.tenant?.tradeName}</dd></div>
              <div><dt className="text-slate-500">Criada em</dt><dd>{formatDateTime(data.createdAt)}</dd></div>
              <div><dt className="text-slate-500">Pago em</dt><dd>{formatDateTime(data.paidAt)}</dd></div>
              <div><dt className="text-slate-500">Vendedor</dt><dd>{data.seller.name}</dd></div>
              <div><dt className="text-slate-500">Descrição</dt><dd>{data.description ?? '—'}</dd></div>
              {data.loyaltyCustomerName && <div><dt className="text-slate-500">Cliente (fidelidade)</dt><dd>{data.loyaltyCustomerName}</dd></div>}
              {data.discountCents > 0 && <div><dt className="text-slate-500">Desconto de cashback</dt><dd><Money cents={data.discountCents} /></dd></div>}
              <div><dt className="text-slate-500">Referência</dt><dd className="font-mono text-xs">{data.externalReference}</dd></div>
              <div><dt className="text-slate-500">Order ID (Mercado Pago)</dt><dd className="font-mono text-xs">{data.orderId ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Payment ID</dt><dd className="font-mono text-xs">{payment?.mpPaymentId ?? data.mpPaymentId ?? '—'}</dd></div>
              <div><dt className="text-slate-500">ID da transação (reference_id)</dt><dd className="font-mono text-xs">{payment?.mpReferenceId ?? '—'}</dd></div>
              {payment && (
                <>
                  <div><dt className="text-slate-500">Valor pago</dt><dd><Money cents={payment.paidAmountCents} /></dd></div>
                  <div><dt className="text-slate-500">Método</dt><dd className="uppercase">{payment.method}</dd></div>
                  <div><dt className="text-slate-500">Tarifa efetiva</dt><dd>{payment.feeCents === null ? <span className="text-slate-400">não informada pelo Mercado Pago</span> : <Money cents={payment.feeCents} />}</dd></div>
                  <div><dt className="text-slate-500">Líquido</dt><dd>{payment.netAmountCents === null ? <span className="text-slate-400">não informado</span> : <Money cents={payment.netAmountCents} />}</dd></div>
                  {payment.refundedAt && <div><dt className="text-slate-500">Estornado em</dt><dd>{formatDateTime(payment.refundedAt)}</dd></div>}
                </>
              )}
            </dl>
            {data.items.length > 0 && (
              <table className="mt-5 w-full text-sm">
                <caption className="mb-2 text-left font-medium text-ink">Itens vendidos</caption>
                <thead className="text-slate-500">
                  <tr><th className="py-1 text-left font-normal">Produto</th><th className="py-1 text-right font-normal">Qtde</th><th className="py-1 text-right font-normal">Unitário</th><th className="py-1 text-right font-normal">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((i, idx) => (
                    <tr key={idx}>
                      <td className="py-1.5">{i.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{i.quantity}</td>
                      <td className="py-1.5 text-right"><Money cents={i.unitPriceCents} /></td>
                      <td className="py-1.5 text-right"><Money cents={i.unitPriceCents * i.quantity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.status === 'RECONCILING' && (
              <Alert tone="warning" className="mt-4" title="Em conciliação">
                Motivo: {data.statusReason}. A cobrança só será marcada como paga após validação completa da Order no Mercado Pago.
              </Alert>
            )}
          </CardBody>
        </Card>

        <Card className="no-print">
          <CardHeader title="Links" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <div>
              <p className="font-medium">Link individual</p>
              <p className="break-all text-xs text-slate-500">{data.publicChargeUrl}</p>
              <CopyButton text={data.publicChargeUrl} label="Copiar link" size="sm" className="mt-2" />
            </div>
            <div>
              <p className="font-medium">Página fixa do POS</p>
              <p className="break-all text-xs text-slate-500">{data.publicPosUrl}</p>
            </div>
            <p className="text-xs text-slate-500">Última consulta ao Mercado Pago: {formatDateTime(data.lastPolledAt)}</p>
          </CardBody>
        </Card>
      </div>

      <Card className="no-print mt-6">
        <CardHeader title="Histórico de estados" />
        <Table>
          <thead><tr><Th>Quando</Th><Th>De</Th><Th>Para</Th><Th>Motivo</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.events.map((e, i) => (
              <tr key={i}>
                <Td>{formatDateTime(e.occurredAt)}</Td>
                <Td>{e.previousState ? chargeLabel(e.previousState) : '—'}</Td>
                <Td>{chargeLabel(e.newState)}</Td>
                <Td className="whitespace-normal text-xs text-slate-500">{e.reason ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
