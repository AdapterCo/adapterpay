'use client';

import { useState } from 'react';
import { formatBRL, formatBrWhatsApp, normalizeBrWhatsApp } from '@adapterpay/shared';
import { Alert, Button, Checkbox, Input } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';

export interface LoyaltyConfig {
  mode: 'OFF' | 'CASHBACK' | 'GIFT';
  cashbackBps: number;
  giftEvery: number;
  giftName: string | null;
  minPurchaseCents: number;
}

export interface LoyaltyReward {
  id: string;
  code: string;
  kind: 'CASHBACK' | 'GIFT';
  valueCents: number | null;
  description: string | null;
}

export interface LoyaltyCustomer {
  id: string;
  name: string;
  phone: string;
  giftProgress: number;
  rewards: LoyaltyReward[];
}

/**
 * Fidelidade no caixa: identifica o cliente pelo WhatsApp, cadastra se for novo (com consentimento
 * para mensagens) e aplica um código de cashback como desconto ou entrega um brinde.
 */
export function LoyaltyPanel({
  config,
  customer,
  appliedCode,
  onCustomer,
  onApply,
}: {
  config: LoyaltyConfig;
  customer: LoyaltyCustomer | null;
  appliedCode: string | null;
  onCustomer: (c: LoyaltyCustomer | null) => void;
  onApply: (reward: LoyaltyReward | null) => void;
}) {
  const [phone, setPhone] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [optIn, setOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const lookup = async () => {
    setError(null);
    setMsg(null);
    if (!normalizeBrWhatsApp(phone)) return setError('Informe o WhatsApp com DDD');
    setBusy(true);
    try {
      const r = await api<{ customer: LoyaltyCustomer | null }>(`/loyalty/customers/lookup?phone=${encodeURIComponent(phone)}`);
      if (r.customer) onCustomer(r.customer);
      setNotFound(!r.customer);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ customer: LoyaltyCustomer }>('/loyalty/customers', { method: 'POST', body: { name, phone, whatsappOptIn: optIn } });
      onCustomer(r.customer);
      setNotFound(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const redeemGift = async (r: LoyaltyReward) => {
    setError(null);
    try {
      await api('/loyalty/rewards/redeem', { method: 'POST', body: { code: r.code } });
      setMsg(`Brinde entregue: ${r.description ?? 'brinde'}.`);
      if (customer) onCustomer({ ...customer, rewards: customer.rewards.filter((x) => x.id !== r.id) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const clear = () => {
    onApply(null);
    onCustomer(null);
    setPhone('');
    setName('');
    setNotFound(false);
    setMsg(null);
    setError(null);
  };

  const rule =
    config.mode === 'CASHBACK'
      ? `${(config.cashbackBps / 100).toLocaleString('pt-BR')}% de cashback`
      : `brinde a cada ${config.giftEvery} compras`;

  return (
    <section aria-label="Fidelidade" className="rounded-xl border border-line bg-paper/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Fidelidade</p>
        <p className="text-xs text-slate-500">{rule}</p>
      </div>
      {error && <Alert tone="danger" className="mt-2">{error}</Alert>}
      {msg && <Alert tone="success" className="mt-2">{msg}</Alert>}

      {!customer ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              type="tel"
              inputMode="tel"
              aria-label="WhatsApp do cliente"
              placeholder="WhatsApp do cliente"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setNotFound(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(); } }}
            />
            <Button type="button" variant="secondary" loading={busy && !notFound} onClick={() => void lookup()}>Buscar</Button>
          </div>
          {notFound && (
            <div className="flex flex-col gap-2 rounded-lg bg-white p-2 ring-1 ring-line">
              <p className="text-xs text-slate-600">Cliente novo. Cadastre para começar a pontuar nesta compra.</p>
              <Input aria-label="Nome do cliente" placeholder="Nome" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              <Checkbox checked={optIn} onChange={(e) => setOptIn(e.target.checked)} label="O cliente aceita receber os códigos pelo WhatsApp" />
              <Button type="button" size="sm" loading={busy} disabled={name.trim().length < 2} onClick={() => void register()}>Cadastrar cliente</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{customer.name}</p>
              <p className="text-xs text-slate-500">
                {formatBrWhatsApp(customer.phone)}
                {config.mode === 'GIFT' ? ` · ${customer.giftProgress} de ${config.giftEvery} compras` : ''}
              </p>
            </div>
            <button type="button" onClick={clear} className="text-xs text-slate-500 underline-offset-2 hover:underline">Trocar</button>
          </div>
          {customer.rewards.map((r) =>
            r.kind === 'CASHBACK' ? (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-line">
                <span className="text-sm"><span className="font-mono">{r.code}</span> · {formatBRL(r.valueCents)}</span>
                <Button type="button" size="sm" variant={appliedCode === r.code ? 'primary' : 'secondary'} onClick={() => onApply(appliedCode === r.code ? null : r)}>
                  {appliedCode === r.code ? 'Aplicado' : 'Usar desconto'}
                </Button>
              </div>
            ) : (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-line">
                <span className="text-sm"><span className="font-mono">{r.code}</span> · {r.description}</span>
                <Button type="button" size="sm" variant="secondary" onClick={() => void redeemGift(r)}>Entregar brinde</Button>
              </div>
            ),
          )}
          {customer.rewards.length === 0 && <p className="text-xs text-slate-500">Sem códigos disponíveis. Esta compra conta para a fidelidade.</p>}
        </div>
      )}
    </section>
  );
}
