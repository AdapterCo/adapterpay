'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Order {
  id: string;
  orderNumber: number;
  status: 'PREPARING' | 'READY' | 'DELIVERED';
  paidAt: string;
  storeName: string;
  origin: string;
  items: Array<{ name: string; quantity: number }>;
  description: string | null;
}

const COLUMNS: Array<{ status: Order['status']; title: string; next: Order['status']; action: string }> = [
  { status: 'PREPARING', title: 'Em preparo', next: 'READY', action: 'Marcar pronto' },
  { status: 'READY', title: 'Prontos para retirar', next: 'DELIVERED', action: 'Entregue' },
];

function minutesSince(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'agora' : `há ${m} min`;
}

/** Fila da cozinha/balcão: pedidos pagos (totem e catálogo) por número. Atualiza sozinha. */
export default function OrdersPage() {
  const orders = useApi<Order[]>('/orders');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string };
      if (d.type === 'charge.updated') void orders.reload();
    };
    window.addEventListener('adapterpay:event', onEvent);
    const poll = setInterval(() => void orders.reload(), 15_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener('adapterpay:event', onEvent);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [orders.reload]);

  const move = async (o: Order, status: Order['status']) => {
    setError(null);
    try {
      await api(`/orders/${o.id}`, { method: 'PATCH', body: { status } });
      await orders.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title="Pedidos" description="Pedidos pagos aparecem aqui sozinhos, com o número que o cliente recebeu." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {orders.loading && !orders.data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {COLUMNS.map((col) => {
            const list = (orders.data ?? []).filter((o) => o.status === col.status);
            return (
              <section key={col.status} aria-label={col.title}>
                <h2 className="mb-3 flex items-baseline gap-2 text-sm font-medium text-slate-600">
                  {col.title} <span className="tabular-nums text-ink">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <Card><EmptyState title={col.status === 'PREPARING' ? 'Nenhum pedido em preparo' : 'Nenhum pedido aguardando retirada'} /></Card>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {list.map((o) => (
                      <li key={o.id} className={`rounded-xl bg-white p-4 ring-1 ${col.status === 'READY' ? 'ring-2 ring-paid' : 'ring-line'}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-3xl font-semibold tabular-nums text-ink">{String(o.orderNumber).padStart(3, '0')}</p>
                          <p className="text-xs text-slate-500">{minutesSince(o.paidAt, now)}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{o.origin} · {o.storeName}</p>
                        <ul className="mt-3 space-y-0.5 text-sm">
                          {o.items.length > 0
                            ? o.items.map((i, idx) => <li key={idx}><span className="tabular-nums font-medium">{i.quantity}×</span> {i.name}</li>)
                            : <li className="text-slate-600">{o.description ?? 'Sem itens'}</li>}
                        </ul>
                        <Button className="mt-4 w-full" variant={col.status === 'READY' ? 'primary' : 'secondary'} onClick={() => void move(o, col.next)}>
                          {col.action}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
