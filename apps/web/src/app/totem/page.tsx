'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { cartTotalCents, formatBRL, normalizeBrWhatsApp } from '@adapterpay/shared';
import { Spinner } from '@adapterpay/ui';
import { CopyButton } from '@/components/domain';
import { PlateQr } from '@/components/plate';
import { ApiError, totemApi } from '@/lib/api';

interface Session {
  totemName: string;
  storeName: string;
  tradeName: string;
  logoUrl: string | null;
  brandColor: string | null;
  operational: boolean;
  loyalty: { mode: 'CASHBACK' | 'GIFT'; cashbackBps: number; giftEvery: number; giftName: string | null } | null;
}

interface Product {
  id: string;
  name: string;
  code: string | null;
  priceCents: number;
  category: string | null;
  imageUrl: string | null;
}

interface Order {
  id: string;
  status: string;
  amountCents: number;
  discountCents: number;
  orderNumber: number | null;
  expiresAt: string | null;
  serverTime: string;
  pixCopyPaste: string | null;
}

type Screen = 'loading' | 'pair' | 'unavailable' | 'catalog' | 'cart' | 'paying' | 'paid' | 'ended';

const IDLE_MS = 90_000;
const IDLE_CONFIRM_MS = 15_000;
const PAID_RESET_MS = 15_000;
const SCANNER_MAX_GAP_MS = 50;

/**
 * AdapterPay Totem: autoatendimento. O cliente escolhe os produtos, vê o total e paga por Pix;
 * a confirmação vem da plataforma (polling no servidor) e o pedido vai para a tela de Pedidos.
 */
export default function TotemPage() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idleAsk, setIdleAsk] = useState(false);
  const lastTouch = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const s = await totemApi<Session>('/session');
      setSession(s);
      if (!s.operational) return setScreen('unavailable');
      setCatalog(await totemApi<Product[]>('/catalog'));
      setScreen((cur) => (cur === 'loading' || cur === 'pair' || cur === 'unavailable' ? 'catalog' : cur));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setScreen('pair');
      else setScreen('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Catálogo e preços atualizados a cada 5 min enquanto ninguém está comprando.
  useEffect(() => {
    const t = setInterval(() => {
      if (screen === 'catalog' && Object.keys(cart).length === 0) void load();
    }, 300_000);
    return () => clearInterval(t);
  }, [screen, cart, load]);

  const reset = useCallback(() => {
    setCart({});
    setOrder(null);
    setQuery('');
    setCategory(null);
    setNotice(null);
    setIdleAsk(false);
    setScreen('catalog');
  }, []);

  const lines = useMemo(
    () => catalog.filter((p) => (cart[p.id] ?? 0) > 0).map((p) => ({ ...p, unitPriceCents: p.priceCents, quantity: cart[p.id]! })),
    [catalog, cart],
  );
  const total = cartTotalCents(lines);
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  const add = useCallback((id: string, delta = 1) => {
    setCart((c) => {
      const q = Math.max(0, Math.min(99, (c[id] ?? 0) + delta));
      const next = { ...c };
      if (q === 0) delete next[id];
      else next[id] = q;
      return next;
    });
  }, []);

  // Inatividade: pergunta "Ainda está aí?" e volta ao início sem deixar carrinho ou cobrança pendurados.
  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
      setIdleAsk(false);
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const t = setInterval(() => {
      const idle = Date.now() - lastTouch.current;
      const shopping = (screen === 'catalog' && count > 0) || screen === 'cart';
      if (shopping && idle > IDLE_MS + IDLE_CONFIRM_MS) reset();
      else if (shopping && idle > IDLE_MS) setIdleAsk(true);
    }, 1_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      clearInterval(t);
    };
  }, [screen, count, reset]);

  // Leitor de código de barras no catálogo (digitação rápida terminada em Enter).
  useEffect(() => {
    if (screen !== 'catalog') return;
    const byCode = new Map(catalog.filter((p) => p.code).map((p) => [p.code!.toLowerCase(), p]));
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();
      if (now - last > SCANNER_MAX_GAP_MS) buffer = '';
      last = now;
      if (e.key === 'Enter' && buffer.length >= 3) {
        const p = byCode.get(buffer.toLowerCase());
        if (p) {
          e.preventDefault();
          add(p.id);
          setNotice(`${p.name} adicionado`);
          setQuery('');
        }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, catalog, add]);

  // Acompanha o pagamento (o servidor consulta o Mercado Pago; aqui só lemos o estado).
  useEffect(() => {
    if (screen !== 'paying' || !order) return;
    const t = setInterval(async () => {
      try {
        const o = await totemApi<Order>(`/orders/${order.id}`);
        setOrder(o);
        if (o.status === 'PAID') setScreen('paid');
        else if (['EXPIRED', 'CANCELLED', 'FAILED'].includes(o.status)) setScreen('ended');
      } catch {
        /* rede instável: tenta de novo no próximo ciclo */
      }
    }, 2_000);
    return () => clearInterval(t);
  }, [screen, order]);

  useEffect(() => {
    if (screen !== 'paid' && screen !== 'ended') return;
    const t = setTimeout(reset, screen === 'paid' ? PAID_RESET_MS : 8_000);
    return () => clearTimeout(t);
  }, [screen, reset]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2_500);
    return () => clearTimeout(t);
  }, [notice]);

  const checkout = async (loyalty?: { phone: string; name?: string; whatsappOptIn?: boolean; rewardCode?: string }) => {
    setBusy(true);
    setNotice(null);
    try {
      const o = await totemApi<Order>('/orders', {
        method: 'POST',
        body: { items: lines.map((l) => ({ productId: l.id, quantity: l.quantity })), amountCents: total, ...(loyalty ? { loyalty } : {}) },
      });
      setOrder(o);
      setScreen(o.status === 'PAID' ? 'paid' : 'paying');
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POS_BUSY') setNotice('O caixa está finalizando outro pagamento. Tente de novo em alguns segundos.');
      else if (err instanceof ApiError && err.code === 'CONFLICT') {
        setNotice('Os preços foram atualizados. Confira o carrinho.');
        await load();
      } else if (err instanceof ApiError && err.code === 'LOYALTY_NAME_REQUIRED') throw err;
      else setNotice(err instanceof ApiError ? err.message : 'Não foi possível iniciar o pagamento.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!order) return reset();
    setBusy(true);
    try {
      await totemApi(`/orders/${order.id}/cancel`, { method: 'POST' });
    } catch {
      /* a cobrança expira sozinha em até 3 minutos */
    } finally {
      setBusy(false);
      reset();
    }
  };

  const brand = session?.brandColor ?? '#005efe';
  const style = { '--brand': brand } as CSSProperties;

  if (screen === 'loading') return <Centered style={style}><Spinner className="h-10 w-10 text-brand-600" /></Centered>;
  if (screen === 'pair') return <PairScreen onPaired={load} />;
  if (screen === 'unavailable') {
    return (
      <Centered style={style}>
        <p className="text-2xl font-semibold text-ink">Totem temporariamente indisponível</p>
        <p className="mt-2 text-lg text-slate-600">Por favor, faça seu pedido no caixa.</p>
        <button type="button" onClick={() => void load()} className="mt-8 rounded-xl bg-white px-6 py-4 text-lg ring-1 ring-line">Tentar de novo</button>
      </Centered>
    );
  }

  return (
    <div style={style} className="flex min-h-dvh select-none flex-col bg-paper text-ink">
      <header className="flex items-center gap-4 bg-white px-6 py-4 shadow-[0_1px_0_var(--color-line)]">
        {session?.logoUrl ? (
          <img src={session.logoUrl} alt={session.tradeName} className="h-12 w-auto max-w-40 object-contain" />
        ) : (
          <p className="text-2xl font-semibold">{session?.tradeName}</p>
        )}
        {screen === 'catalog' && (
          <label className="relative ml-auto w-full max-w-xl">
            <span className="sr-only">Buscar produto</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar produto ou ler código de barras"
              className="h-14 w-full rounded-2xl border border-line bg-paper pl-12 pr-4 text-lg outline-none focus:border-[var(--brand)]"
            />
          </label>
        )}
      </header>

      {screen === 'catalog' && (
        <CatalogScreen
          catalog={catalog}
          cart={cart}
          category={category}
          query={query}
          onCategory={setCategory}
          onAdd={add}
        />
      )}

      {screen === 'cart' && session && (
        <CartScreen
          lines={lines}
          total={total}
          loyalty={session.loyalty}
          busy={busy}
          onQty={add}
          onBack={() => setScreen('catalog')}
          onPay={checkout}
        />
      )}

      {screen === 'paying' && order && <PayingScreen order={order} busy={busy} onCancel={cancelOrder} />}
      {screen === 'paid' && order && <PaidScreen order={order} onDone={reset} />}
      {screen === 'ended' && (
        <Centered>
          <p className="text-3xl font-semibold">Pagamento não concluído</p>
          <p className="mt-3 text-lg text-slate-600">O tempo para pagar acabou. Nenhum valor foi cobrado.</p>
          <button type="button" onClick={reset} className="mt-10 h-16 rounded-2xl bg-[var(--brand)] px-10 text-xl font-semibold text-white">Começar de novo</button>
        </Centered>
      )}

      {screen === 'catalog' && count > 0 && (
        <div className="sticky bottom-0 bg-white/95 px-6 py-4 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
          <button
            type="button"
            onClick={() => setScreen('cart')}
            className="mx-auto flex h-18 w-full max-w-3xl items-center justify-between rounded-2xl bg-[var(--brand)] px-8 py-4 text-white"
          >
            <span className="text-lg">{count} {count === 1 ? 'item' : 'itens'}</span>
            <span className="text-2xl font-semibold tabular-nums">{formatBRL(total)}</span>
            <span className="text-lg font-semibold">Finalizar pedido</span>
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="fixed inset-x-0 top-24 z-40 mx-auto w-fit max-w-[90vw] rounded-2xl bg-ink px-6 py-3 text-lg text-white shadow-lg">
          {notice}
        </div>
      )}

      {idleAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6" role="dialog" aria-modal="true" aria-labelledby="idle-title">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
            <p id="idle-title" className="text-2xl font-semibold">Ainda está aí?</p>
            <p className="mt-2 text-lg text-slate-600">Seu pedido será descartado em instantes.</p>
            <button type="button" onClick={() => setIdleAsk(false)} className="mt-6 h-16 w-full rounded-2xl bg-[var(--brand)] text-xl font-semibold text-white">Continuar comprando</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={style} className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-paper p-8 text-center text-ink">
      {children}
    </div>
  );
}

function PairScreen({ onPaired }: { onPaired: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await totemApi('/pair', { method: 'POST', body: { code } });
      await onPaired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível parear.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <img src="/brand/adapterpay-mark.svg" alt="" className="h-14 w-14" />
      <h1 className="mt-6 text-3xl font-semibold">Parear este totem</h1>
      <p className="mt-2 max-w-md text-lg text-slate-600">No painel do AdapterPay, abra Totens, crie o totem e digite aqui o código de 8 caracteres.</p>
      <form onSubmit={submit} className="mt-8 flex w-full max-w-md flex-col gap-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
          aria-label="Código de pareamento"
          autoFocus
          autoComplete="off"
          className="h-20 rounded-2xl border border-line bg-white text-center font-mono text-4xl tracking-[0.3em] outline-none focus:border-brand-600"
        />
        {error && <p role="alert" className="text-lg text-red-700">{error}</p>}
        <button type="submit" disabled={code.length !== 8 || busy} className="h-16 rounded-2xl bg-brand-600 text-xl font-semibold text-white disabled:opacity-50">
          {busy ? 'Pareando…' : 'Parear'}
        </button>
      </form>
    </Centered>
  );
}

function CatalogScreen({
  catalog,
  cart,
  category,
  query,
  onCategory,
  onAdd,
}: {
  catalog: Product[];
  cart: Record<string, number>;
  category: string | null;
  query: string;
  onCategory: (c: string | null) => void;
  onAdd: (id: string, delta?: number) => void;
}) {
  const categories = useMemo(() => [...new Set(catalog.map((p) => p.category).filter((c): c is string => !!c))], [catalog]);
  const q = query.trim().toLowerCase();
  const visible = catalog.filter(
    (p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.code?.toLowerCase() === q),
  );

  return (
    <main id="conteudo" className="flex-1 px-6 py-5">
      {categories.length > 0 && (
        <div className="-mx-6 mb-5 flex gap-3 overflow-x-auto px-6 pb-1">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? 'todos'}
              type="button"
              aria-pressed={category === c}
              onClick={() => onCategory(c)}
              className={`h-12 shrink-0 rounded-full px-6 text-lg font-medium ${category === c ? 'bg-ink text-white' : 'bg-white text-slate-700 ring-1 ring-line'}`}
            >
              {c ?? 'Todos'}
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <p className="mt-16 text-center text-xl text-slate-500">Nenhum produto encontrado.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => {
            const qty = cart[p.id] ?? 0;
            return (
              <li key={p.id} className={`flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ${qty ? 'ring-2 ring-[var(--brand)]' : 'ring-line'}`}>
                <div className="relative aspect-square bg-paper">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center px-4 text-center text-xl font-semibold text-slate-400">{p.name}</span>
                  )}
                  {qty > 0 && (
                    <span className="absolute right-3 top-3 flex h-10 min-w-10 items-center justify-center rounded-full bg-[var(--brand)] px-2 text-lg font-bold text-white">{qty}</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <p className="line-clamp-2 text-lg leading-snug">{p.name}</p>
                  <p className="mt-auto text-2xl font-semibold tabular-nums">{formatBRL(p.priceCents)}</p>
                  {qty === 0 ? (
                    <button type="button" onClick={() => onAdd(p.id)} className="h-14 rounded-xl bg-[var(--brand)] text-lg font-semibold text-white">
                      Adicionar
                    </button>
                  ) : (
                    <div className="flex h-14 items-center justify-between rounded-xl ring-1 ring-line">
                      <button type="button" aria-label={`Tirar um ${p.name}`} onClick={() => onAdd(p.id, -1)} className="h-full w-16 text-3xl">−</button>
                      <span className="text-xl font-semibold tabular-nums" aria-live="polite">{qty}</span>
                      <button type="button" aria-label={`Adicionar mais um ${p.name}`} onClick={() => onAdd(p.id)} className="h-full w-16 text-3xl">+</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function CartScreen({
  lines,
  total,
  loyalty,
  busy,
  onQty,
  onBack,
  onPay,
}: {
  lines: Array<Product & { quantity: number }>;
  total: number;
  loyalty: Session['loyalty'];
  busy: boolean;
  onQty: (id: string, delta: number) => void;
  onBack: () => void;
  onPay: (loyalty?: { phone: string; name?: string; whatsappOptIn?: boolean; rewardCode?: string }) => Promise<boolean>;
}) {
  const [phone, setPhone] = useState('');
  const [needName, setNeedName] = useState(false);
  const [name, setName] = useState('');
  const [optIn, setOptIn] = useState(true);
  const [rewardCode, setRewardCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lines.length === 0) onBack();
  }, [lines.length, onBack]);

  const pay = async () => {
    setError(null);
    const wantsLoyalty = !!loyalty && phone.trim().length > 0;
    if (wantsLoyalty && !normalizeBrWhatsApp(phone)) return setError('Confira o WhatsApp com DDD.');
    if (wantsLoyalty && needName && name.trim().length < 2) return setError('Informe seu nome para entrar na fidelidade.');
    try {
      await onPay(
        wantsLoyalty
          ? {
              phone,
              ...(needName ? { name: name.trim(), whatsappOptIn: optIn } : {}),
              ...(rewardCode.length === 6 ? { rewardCode } : {}),
            }
          : undefined,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LOYALTY_NAME_REQUIRED') {
        setNeedName(true);
        setError('Primeira vez por aqui? Informe seu nome para ganhar a fidelidade.');
      }
    }
  };

  const loyaltyText = loyalty
    ? loyalty.mode === 'CASHBACK'
      ? `Ganhe ${(loyalty.cashbackBps / 100).toLocaleString('pt-BR')}% de cashback nesta compra`
      : `A cada ${loyalty.giftEvery} compras, ganhe ${loyalty.giftName ?? 'um brinde'}`
    : null;

  return (
    <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Seu pedido</h1>
        <button type="button" onClick={onBack} className="h-14 rounded-xl bg-white px-6 text-lg ring-1 ring-line">Adicionar mais</button>
      </div>

      <ul className="divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-4 p-4">
            {l.imageUrl ? <img src={l.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <span className="h-16 w-16 rounded-xl bg-paper" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg">{l.name}</p>
              <p className="text-lg font-semibold tabular-nums">{formatBRL(l.priceCents * l.quantity)}</p>
            </div>
            <div className="flex h-14 items-center rounded-xl ring-1 ring-line">
              <button type="button" aria-label={`Tirar um ${l.name}`} onClick={() => onQty(l.id, -1)} className="h-full w-14 text-3xl">−</button>
              <span className="w-8 text-center text-xl font-semibold tabular-nums">{l.quantity}</span>
              <button type="button" aria-label={`Adicionar mais um ${l.name}`} onClick={() => onQty(l.id, 1)} className="h-full w-14 text-3xl">+</button>
            </div>
          </li>
        ))}
      </ul>

      {loyalty && (
        <section aria-label="Fidelidade" className="rounded-2xl bg-white p-5 ring-1 ring-line">
          <p className="text-lg font-semibold">{loyaltyText}</p>
          <p className="text-base text-slate-600">Opcional: informe seu WhatsApp.</p>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 98765-4321"
            aria-label="Seu WhatsApp"
            className="mt-3 h-14 w-full rounded-xl border border-line px-4 text-xl outline-none focus:border-[var(--brand)]"
          />
          {needName && (
            <div className="mt-3 flex flex-col gap-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" aria-label="Seu nome" maxLength={80} className="h-14 rounded-xl border border-line px-4 text-xl outline-none focus:border-[var(--brand)]" />
              <label className="flex items-center gap-3 text-lg">
                <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="h-6 w-6" />
                Aceito receber meus códigos pelo WhatsApp
              </label>
            </div>
          )}
          {loyalty.mode === 'CASHBACK' && phone.trim() && (
            <input
              value={rewardCode}
              onChange={(e) => setRewardCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="Código de cashback (se tiver)"
              aria-label="Código de cashback"
              className="mt-3 h-14 w-full rounded-xl border border-line px-4 font-mono text-xl uppercase outline-none focus:border-[var(--brand)]"
            />
          )}
        </section>
      )}

      {error && <p role="alert" className="text-lg text-red-700">{error}</p>}

      <div className="mt-auto flex items-baseline justify-between">
        <span className="text-xl text-slate-600">Total</span>
        <span className="text-5xl font-semibold tabular-nums">{formatBRL(total)}</span>
      </div>
      {rewardCode.length === 6 && <p className="-mt-4 text-right text-base text-slate-600">O desconto do cashback é aplicado na tela de pagamento.</p>}
      <button type="button" disabled={busy || total <= 0} onClick={() => void pay()} className="h-20 rounded-2xl bg-[var(--brand)] text-2xl font-semibold text-white disabled:opacity-60">
        {busy ? 'Gerando o Pix…' : 'Pagar com Pix'}
      </button>
    </main>
  );
}

function PayingScreen({ order, busy, onCancel }: { order: Order; busy: boolean; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const offset = useMemo(() => new Date(order.serverTime).getTime() - Date.now(), [order.serverTime]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const remaining = order.expiresAt ? Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - (now + offset)) / 1000)) : null;

  return (
    <main id="conteudo" className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
      <p className="text-xl text-slate-600">Valor a pagar</p>
      <p className="-mt-4 text-6xl font-semibold tabular-nums">{formatBRL(order.amountCents)}</p>
      {order.discountCents > 0 && <p className="-mt-3 text-lg text-paid">Cashback aplicado: − {formatBRL(order.discountCents)}</p>}

      {order.pixCopyPaste ? (
        <div className="grid w-full items-center gap-8 md:grid-cols-[auto_1fr]">
          <div className="mx-auto rounded-3xl bg-white p-6 ring-1 ring-line">
            <PlateQr value={order.pixCopyPaste} size={280} label={`QR Code Pix de ${formatBRL(order.amountCents)}`} />
          </div>
          <ol className="space-y-4 text-left text-xl">
            <li><span className="font-semibold">1.</span> Abra o app do seu banco e escolha <strong>Pix</strong>.</li>
            <li><span className="font-semibold">2.</span> Leia o QR Code ou use o código copia e cola.</li>
            <li><span className="font-semibold">3.</span> Confira o valor e pague. A confirmação aparece aqui.</li>
            <li className="pt-2"><CopyButton text={order.pixCopyPaste} label="Copiar código Pix" copiedLabel="Código copiado" size="lg" /></li>
          </ol>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xl text-slate-600"><Spinner className="h-7 w-7" /> Preparando o Pix…</div>
      )}

      {remaining !== null && (
        <p className="text-lg text-slate-600">
          Tempo para pagar: <strong className="tabular-nums text-ink">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong>
        </p>
      )}
      <button type="button" disabled={busy} onClick={onCancel} className="h-14 rounded-xl bg-white px-8 text-lg ring-1 ring-line disabled:opacity-60">
        Cancelar pedido
      </button>
    </main>
  );
}

function PaidScreen({ order, onDone }: { order: Order; onDone: () => void }) {
  return (
    <main id="conteudo" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
      <span className="totem-pop flex h-24 w-24 items-center justify-center rounded-full bg-paid text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-14 w-14" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 className="text-4xl font-semibold">Pagamento aprovado</h1>
      {order.orderNumber !== null && (
        <div className="mt-2 rounded-3xl border-2 border-dashed border-line bg-white px-14 py-8">
          <p className="text-xl text-slate-600">Seu pedido</p>
          <p className="text-8xl font-bold tabular-nums text-ink">{String(order.orderNumber).padStart(3, '0')}</p>
          <p className="mt-2 text-lg text-slate-600">Retire quando o número for chamado.</p>
        </div>
      )}
      <button type="button" onClick={onDone} className="mt-4 h-16 rounded-2xl bg-[var(--brand)] px-10 text-xl font-semibold text-white">Novo pedido</button>
      <style>{`
        @keyframes totem-pop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        .totem-pop { animation: totem-pop .5s cubic-bezier(.2,.8,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .totem-pop { animation: none } }
      `}</style>
    </main>
  );
}
