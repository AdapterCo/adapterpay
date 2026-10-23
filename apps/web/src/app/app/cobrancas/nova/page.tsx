'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { cartDescription, cartTotalCents, formatBRL, MAX_CHARGE_CENTS } from '@adapterpay/shared';
import { Alert, Button, Card, CardBody, Field, Input, PageHeader, Select, Spinner } from '@adapterpay/ui';
import { ChargeStatusBadge, CopyButton, Countdown, MoneyInput, QrImage } from '@/components/domain';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { LoyaltyPanel, type LoyaltyConfig, type LoyaltyCustomer, type LoyaltyReward } from '@/components/loyalty-panel';
import { formatDateTime } from '@/lib/format';
import { useApi, useNow, useServerOffset } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface PosItem {
  id: string;
  name: string;
  storeId: string;
  storeName: string | null;
  status: string;
  orderReady: boolean;
  notReadyReason: string | null;
  activeChargeId: string | null;
  publicUrl: string;
}

interface ChargeDetail {
  id: string;
  status: string;
  statusReason: string | null;
  amountCents: number;
  externalReference: string;
  orderId: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  serverTime: string;
  publicChargeUrl: string;
  publicPosUrl: string;
  posName: string;
  storeName: string;
  items?: Array<{ name: string; unitPriceCents: number; quantity: number }>;
  orderNumber?: number | null;
}

interface Product {
  id: string;
  name: string;
  code: string | null;
  priceCents: number;
  category: string | null;
}

/** Leitores de código de barras "digitam" muito rápido: intervalos menores que isso indicam leitura. */
const SCANNER_MAX_GAP_MS = 50;

const LAST_POS_KEY = 'adapterpay:last-pos';
const LAST_AMOUNT_KEY = 'adapterpay:last-amount';
const QUICK_VALUES = [500, 1000, 2000, 5000, 10000];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* navegação privada: segue sem lembrar */
  }
}

/**
 * Cobrança rápida: por produtos do catálogo (total recalculado no servidor) ou por valor livre,
 * com atalhos de valores. O backend cria a Order e acompanha por polling.
 */
export default function NewChargePage() {
  const { can } = useSession();
  const [posList, setPosList] = useState<PosItem[] | null>(null);
  const [posId, setPosId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [amountKey, setAmountKey] = useState(0);
  const [lastAmount, setLastAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ remainingSeconds: number | null; chargeId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const idemKey = useRef(newIdempotencyKey());

  const products = useApi<Product[]>(can('products:read') ? '/products' : null);
  const catalog = useMemo(() => products.data ?? [], [products.data]);
  const [mode, setMode] = useState<'catalog' | 'amount' | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});

  const loyaltyConfig = useApi<LoyaltyConfig>(can('loyalty:use') ? '/loyalty/config' : null);
  const loyaltyOn = !!loyaltyConfig.data && loyaltyConfig.data.mode !== 'OFF';
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<LoyaltyCustomer | null>(null);
  const [appliedReward, setAppliedReward] = useState<LoyaltyReward | null>(null);

  useEffect(() => {
    api<PosItem[]>('/pos')
      .then((items) => {
        setPosList(items);
        const ready = items.filter((p) => p.orderReady);
        const last = readStorage(LAST_POS_KEY);
        setPosId((last && ready.some((p) => p.id === last) ? last : ready[0]?.id) ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
    const last = Number(readStorage(LAST_AMOUNT_KEY));
    if (Number.isSafeInteger(last) && last > 0 && last <= MAX_CHARGE_CENTS) setLastAmount(last);
  }, []);

  // Com catálogo cadastrado, a tela abre no modo Produtos; sem catálogo, no valor livre.
  useEffect(() => {
    if (mode === null && (products.data || !can('products:read'))) setMode(catalog.length ? 'catalog' : 'amount');
  }, [mode, products.data, catalog.length, can]);

  const refresh = useCallback(async (id: string) => {
    try {
      setCharge(await api<ChargeDetail>(`/charges/${id}`));
    } catch {
      /* mantém último estado */
    }
  }, []);

  // Atualização em tempo real (SSE do painel) + fallback de consulta ao NOSSO backend.
  useEffect(() => {
    if (!charge) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; chargeId?: string };
      if (d.type === 'charge.updated' && d.chargeId === charge.id) void refresh(charge.id);
    };
    window.addEventListener('adapterpay:event', h);
    const active = ['CREATING', 'PENDING', 'RECONCILING'].includes(charge.status);
    const t = active ? setInterval(() => void refresh(charge.id), 3000) : null;
    return () => {
      window.removeEventListener('adapterpay:event', h);
      if (t) clearInterval(t);
    };
  }, [charge, refresh]);

  const offset = useServerOffset(charge?.serverTime);
  const now = useNow(1000);
  const selected = useMemo(() => posList?.find((p) => p.id === posId) ?? null, [posList, posId]);

  const categories = useMemo(() => [...new Set(catalog.map((p) => p.category).filter((c): c is string => !!c))], [catalog]);
  const visible = category ? catalog.filter((p) => p.category === category) : catalog;
  const cartLines = useMemo(
    () =>
      catalog
        .filter((p) => (cart[p.id] ?? 0) > 0)
        .map((p) => ({ productId: p.id, name: p.name, unitPriceCents: p.priceCents, quantity: cart[p.id]! })),
    [catalog, cart],
  );
  const cartTotal = cartTotalCents(cartLines);
  const grossAmount = mode === 'catalog' ? cartTotal : amount;
  const discount = appliedReward?.valueCents ?? 0;
  const chargeAmount = grossAmount ? grossAmount - discount : grossAmount;

  const setQty = (id: string, qty: number) => setCart((c) => {
    const next = { ...c };
    if (qty <= 0) delete next[id];
    else next[id] = Math.min(qty, 999);
    return next;
  });

  // Leitor de código de barras: campo próprio + captura em qualquer ponto da tela (modo Produtos).
  const [scanCode, setScanCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byCode = useMemo(() => new Map(catalog.filter((p) => p.code).map((p) => [p.code!.toLowerCase(), p])), [catalog]);

  const addByCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const p = byCode.get(code.toLowerCase());
      if (p) {
        setCart((c) => ({ ...c, [p.id]: Math.min((c[p.id] ?? 0) + 1, 999) }));
        setScanMsg({ ok: true, text: `Adicionado: ${p.name}` });
      } else {
        setScanMsg({ ok: false, text: `Código ${code} não encontrado no catálogo` });
      }
    },
    [byCode],
  );

  useEffect(() => {
    if (mode !== 'catalog' || charge) return;
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Digitação normal em outros campos segue intacta; o campo do leitor trata o próprio Enter.
      if (t && t !== document.body && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const now = performance.now();
      if (now - last > SCANNER_MAX_GAP_MS) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          e.preventDefault();
          addByCode(buffer);
        }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, charge, addByCode]);

  const pickAmount = (cents: number) => {
    setAmount(cents);
    setAmountKey((k) => k + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(null);
    if (!posId) return setError('Selecione um POS');
    if (!grossAmount || grossAmount <= 0 || grossAmount > MAX_CHARGE_CENTS) {
      return setError(mode === 'catalog' ? 'Adicione produtos ao carrinho' : 'Informe um valor válido');
    }
    if (!chargeAmount || chargeAmount <= 0) return setError('O cashback vale mais que esta compra. Use o código numa compra maior.');
    setSubmitting(true);
    try {
      const loyalty = loyaltyCustomer
        ? { loyalty: { customerId: loyaltyCustomer.id, ...(appliedReward ? { rewardCode: appliedReward.code } : {}) } }
        : {};
      const body =
        mode === 'catalog'
          ? { posId, amountCents: chargeAmount, items: cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })), ...loyalty }
          : { posId, amountCents: chargeAmount, ...(description.trim() ? { description: description.trim() } : {}), ...loyalty };
      const created = await api<ChargeDetail>('/charges', { method: 'POST', body, headers: { 'Idempotency-Key': idemKey.current } });
      writeStorage(LAST_POS_KEY, posId);
      if (mode === 'amount') {
        writeStorage(LAST_AMOUNT_KEY, String(chargeAmount));
        setLastAmount(chargeAmount);
      }
      setCharge(created);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POS_BUSY') {
        setBusy(err.details as { remainingSeconds: number | null; chargeId: string });
      } else {
        if (err instanceof ApiError && err.code === 'CONFLICT') void products.reload();
        setError(errorMessage(err));
      }
      idemKey.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setCharge(null);
    setAmount(null);
    setAmountKey((k) => k + 1);
    setDescription('');
    setCart({});
    setLoyaltyCustomer(null);
    setAppliedReward(null);
    idemKey.current = newIdempotencyKey();
  };

  const loyaltyPanel = loyaltyOn && loyaltyConfig.data && (
    <LoyaltyPanel
      config={loyaltyConfig.data}
      customer={loyaltyCustomer}
      appliedCode={appliedReward?.code ?? null}
      onCustomer={setLoyaltyCustomer}
      onApply={setAppliedReward}
    />
  );

  if (charge) {
    const live = charge.status === 'PENDING' && charge.expiresAt && new Date(charge.expiresAt).getTime() > now + offset;
    return (
      <>
        <PageHeader title="Cobrança gerada" description={`${charge.storeName} · ${charge.posName}`} />
        <Card className="mx-auto max-w-xl">
          <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
            <ChargeStatusBadge status={charge.status} />
            {charge.orderNumber ? <p className="text-sm text-slate-600">Pedido <strong className="tabular-nums text-ink">{String(charge.orderNumber).padStart(3, '0')}</strong></p> : null}
            <p className="text-5xl font-bold tabular-nums">{formatBRL(charge.amountCents)}</p>
            {charge.items && charge.items.length > 0 && (
              <p className="max-w-sm text-sm text-slate-600">{cartDescription(charge.items, 300)}</p>
            )}
            {live && charge.expiresAt && (
              <p className="text-sm text-slate-600">
                Expira em <strong><Countdown expiresAt={charge.expiresAt} serverOffsetMs={offset} now={now} /></strong>
              </p>
            )}
            {charge.status === 'CREATING' && <p className="flex items-center gap-2 text-sm text-slate-600"><Spinner className="h-4 w-4" /> Criando a Order no Mercado Pago…</p>}
            {charge.status === 'PENDING' && (
              <Alert tone="info" className="w-full text-left">
                Peça ao cliente para aproximar o celular da placa NFC ou ler o QR do caixa. O valor e o Pix já estão na página pública do POS.
              </Alert>
            )}
            {charge.status === 'PAID' && <Alert tone="success" className="w-full" title="Pagamento confirmado">Confirmado em {formatDateTime(charge.paidAt)}.</Alert>}
            {charge.status === 'EXPIRED' && <Alert tone="warning" className="w-full">Cobrança expirada sem pagamento. O POS foi liberado.</Alert>}
            {charge.status === 'RECONCILING' && (
              <Alert tone="warning" className="w-full" title="Em conciliação">
                A confirmação ainda não é segura ({charge.statusReason}). O POS continua reservado e o sistema segue consultando o Mercado Pago.
              </Alert>
            )}
            {(charge.status === 'FAILED' || charge.status === 'CANCELLED') && <Alert tone="danger" className="w-full">Cobrança não concluída ({charge.statusReason}).</Alert>}

            {charge.status === 'PENDING' && (
              <div className="w-full rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-medium">Link individual desta cobrança</p>
                <p className="mt-1 text-xs text-slate-500">Válido só para esta Order, sem trocar para a próxima cobrança do POS.</p>
                <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row">
                  <QrImage value={charge.publicChargeUrl} size={120} label="QR do link individual da cobrança" />
                  <div className="flex w-full flex-col gap-2">
                    <Input readOnly value={charge.publicChargeUrl} aria-label="Link individual" onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton text={charge.publicChargeUrl} label="Copiar link" size="sm" />
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={reset} variant={charge.status === 'PENDING' ? 'secondary' : 'primary'}>Nova cobrança</Button>
              <Link href={`/app/cobrancas/${charge.id}`}><Button variant="ghost">Ver detalhes</Button></Link>
            </div>
            <p className="font-mono text-xs text-slate-400">{charge.externalReference}{charge.orderId ? ` · ${charge.orderId}` : ''}</p>
          </CardBody>
        </Card>
      </>
    );
  }

  const readyCount = posList?.filter((p) => p.orderReady).length ?? 0;
  const hasCatalog = catalog.length > 0;

  const posField = posList && (
    <Field label="POS (caixa)">
      {(p) => (
        <Select {...p} value={posId} onChange={(e) => setPosId(e.target.value)}>
          {posList.map((pos) => (
            <option key={pos.id} value={pos.id} disabled={!pos.orderReady}>
              {pos.storeName} · {pos.name}
              {!pos.orderReady ? ' (indisponível)' : pos.activeChargeId ? ' (ocupado)' : ''}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const alerts = (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {busy && (
        <Alert tone="warning" title="POS ocupado">
          Este POS já tem uma cobrança em andamento{busy.remainingSeconds !== null ? ` (cerca de ${busy.remainingSeconds}s restantes)` : ''}. Use outro POS ou aguarde.{' '}
          <Link href={`/app/cobrancas/${busy.chargeId}`} className="underline">Ver cobrança ativa</Link>
        </Alert>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Nova cobrança"
        description="O total é fixado no servidor. A cobrança vale por 3 minutos."
        actions={
          hasCatalog && (
            <div role="tablist" aria-label="Forma de cobrança" className="inline-flex rounded-lg bg-slate-100 p-1">
              {([['catalog', 'Produtos'], ['amount', 'Valor livre']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === m ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        }
      />

      {posList === null || mode === null ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : readyCount === 0 ? (
        <Alert tone="warning" title="Nenhum POS pronto para cobrança">
          Ative um POS com conta Mercado Pago conectada. <Link href="/app/pos" className="underline">Ir para POS</Link>
        </Alert>
      ) : mode === 'catalog' ? (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px]" noValidate>
          <section aria-label="Catálogo">
            {byCode.size > 0 && (
              <div className="mb-4">
                <label htmlFor="leitor" className="text-sm font-medium text-ink">Código do produto / leitor</label>
                <Input
                  id="leitor"
                  autoFocus
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="Leia o código de barras ou digite e tecle Enter"
                  className="mt-1 font-mono"
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addByCode(scanCode);
                    setScanCode('');
                  }}
                />
                {scanMsg && (
                  <p role="status" className={`mt-1 text-sm ${scanMsg.ok ? 'text-paid' : 'text-red-700'}`}>{scanMsg.text}</p>
                )}
              </div>
            )}
            {categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {[null, ...categories].map((c) => (
                  <button
                    key={c ?? 'todos'}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={`rounded-full px-3 py-1.5 text-sm ${category === c ? 'bg-ink text-white' : 'bg-white text-slate-700 ring-1 ring-line hover:ring-brand-600'}`}
                  >
                    {c ?? 'Todos'}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((p) => {
                const qty = cart[p.id] ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setQty(p.id, qty + 1)}
                    aria-label={`Adicionar ${p.name}, ${formatBRL(p.priceCents)}${qty ? `. No carrinho: ${qty}` : ''}`}
                    className={`relative flex min-h-24 flex-col justify-between rounded-xl bg-white p-3 text-left ring-1 transition-colors active:scale-[0.98] ${qty ? 'ring-2 ring-brand-600' : 'ring-line hover:ring-brand-600'}`}
                  >
                    <span className="text-sm font-medium leading-snug text-ink">{p.name}</span>
                    <span className="mt-2 text-base font-semibold tabular-nums text-brand-700">{formatBRL(p.priceCents)}</span>
                    {qty > 0 && (
                      <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">{qty}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <Card className="h-fit lg:sticky lg:top-6">
            <CardBody className="flex flex-col gap-4">
              {alerts}
              {posField}
              <div>
                <p className="text-sm font-medium text-ink">Carrinho</p>
                {cartLines.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">Toque nos produtos para adicionar.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {cartLines.map((l) => (
                      <li key={l.productId} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{l.name}</p>
                          <p className="text-xs tabular-nums text-slate-500">{formatBRL(l.unitPriceCents * l.quantity)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button type="button" size="sm" variant="secondary" aria-label={`Tirar um ${l.name}`} onClick={() => setQty(l.productId, l.quantity - 1)}>−</Button>
                          <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">{l.quantity}</span>
                          <Button type="button" size="sm" variant="secondary" aria-label={`Adicionar um ${l.name}`} onClick={() => setQty(l.productId, l.quantity + 1)}>+</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {loyaltyPanel}
              {discount > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Desconto cashback</span>
                  <span className="tabular-nums">− {formatBRL(discount)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <span className="text-sm text-slate-600">Total</span>
                <span className="text-3xl font-semibold tabular-nums">{formatBRL(cartTotal ? chargeAmount : 0)}</span>
              </div>
              <Button type="submit" size="lg" loading={submitting} disabled={!cartTotal || !selected?.orderReady}>
                Cobrar {cartTotal && chargeAmount ? formatBRL(chargeAmount) : ''}
              </Button>
              {cartLines.length > 0 && (
                <button type="button" onClick={() => setCart({})} className="text-sm text-slate-500 underline-offset-2 hover:underline">
                  Limpar carrinho
                </button>
              )}
            </CardBody>
          </Card>
        </form>
      ) : (
        <Card className="mx-auto max-w-xl">
          <CardBody>
            <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
              {alerts}
              {posField}
              <Field label="Valor">
                {(p) => <MoneyInput {...p} key={amountKey} autoFocus valueCents={amount} onChange={setAmount} />}
              </Field>
              <div className="flex flex-wrap gap-2" aria-label="Valores rápidos">
                {QUICK_VALUES.map((v) => (
                  <Button key={v} type="button" size="sm" variant={amount === v ? 'primary' : 'secondary'} onClick={() => pickAmount(v)}>
                    {formatBRL(v).replace(',00', '')}
                  </Button>
                ))}
                {lastAmount && !QUICK_VALUES.includes(lastAmount) && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => pickAmount(lastAmount)}>
                    Repetir {formatBRL(lastAmount)}
                  </Button>
                )}
              </div>
              <Field label="Descrição (opcional)" hint="Aparece para o cliente na página de pagamento.">
                {(p) => <Input {...p} maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} />}
              </Field>
              {loyaltyPanel}
              {discount > 0 && amount ? (
                <p className="text-sm text-slate-600">
                  {formatBRL(amount)} − cashback {formatBRL(discount)} = <strong className="tabular-nums">{formatBRL(Math.max(0, amount - discount))}</strong>
                </p>
              ) : null}
              <Button type="submit" size="lg" loading={submitting} disabled={!amount || !selected?.orderReady}>
                Gerar cobrança {chargeAmount && chargeAmount > 0 ? formatBRL(chargeAmount) : ''}
              </Button>
              {selected && (
                <p className="text-center text-xs text-slate-500">
                  Página pública deste POS: <a href={selected.publicUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">{selected.publicUrl}</a>
                </p>
              )}
              {!hasCatalog && can('products:manage') && (
                <p className="text-center text-xs text-slate-500">
                  Vende sempre os mesmos itens? <Link href="/app/produtos" className="text-brand-700 underline">Cadastre produtos</Link> para cobrar com poucos toques.
                </p>
              )}
            </form>
          </CardBody>
        </Card>
      )}
    </>
  );
}
