'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { formatBRL, formatBrWhatsApp } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Reward {
  id: string;
  code: string;
  kind: 'CASHBACK' | 'GIFT';
  valueCents: number | null;
  description: string | null;
  status: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  whatsappOptIn: boolean;
  purchaseCount: number;
  giftProgress: number;
  totalSpentCents: number;
  rewards: Reward[];
}

interface LoyaltyConfig {
  mode: 'OFF' | 'CASHBACK' | 'GIFT';
  giftEvery: number;
}

/** Clientes da fidelidade: compras, códigos em aberto, consentimento e exclusão (LGPD). */
export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const customers = useApi<Customer[]>(`/loyalty/customers${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const config = useApi<LoyaltyConfig>('/loyalty/config');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
  };

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      const r = await api<{ customerName: string; description: string | null }>('/loyalty/rewards/redeem', { method: 'POST', body: { code } });
      setMsg(`Brinde resgatado: ${r.description ?? 'brinde'} para ${r.customerName}.`);
      setCode('');
      await customers.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggleOptIn = async (c: Customer) => {
    setError(null);
    try {
      await api(`/loyalty/customers/${c.id}`, { method: 'PATCH', body: { whatsappOptIn: !c.whatsappOptIn } });
      await customers.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (c: Customer) => {
    if (!window.confirm(`Excluir ${c.name} da fidelidade? Os códigos em aberto deixam de valer. As vendas continuam no histórico.`)) return;
    setError(null);
    try {
      await api(`/loyalty/customers/${c.id}`, { method: 'DELETE' });
      setMsg(`${c.name} foi excluído da fidelidade.`);
      await customers.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const mode = config.data?.mode;

  return (
    <>
      <PageHeader title="Clientes" description="Quem participa da fidelidade, quanto comprou e os códigos em aberto." />
      {mode === 'OFF' && (
        <Alert tone="info" className="mb-4">
          A fidelidade está desligada. Escolha cashback ou brinde em <Link href="/app/configuracoes" className="underline">Configurações</Link>.
        </Alert>
      )}
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <form onSubmit={search} className="flex items-end gap-2">
              <Field label="Buscar por nome ou WhatsApp" className="flex-1">
                {(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ana ou 98765" />}
              </Field>
              <Button type="submit" variant="secondary">Buscar</Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <form onSubmit={redeem} className="flex items-end gap-2">
              <Field label="Resgatar brinde pelo código" className="flex-1">
                {(p) => <Input {...p} value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7M2QX" className="font-mono uppercase" />}
              </Field>
              <Button type="submit" disabled={code.replace(/[^A-Z0-9]/g, '').length !== 6}>Resgatar</Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        {customers.loading && !customers.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : !customers.data?.length ? (
          <EmptyState
            title={query ? 'Nenhum cliente encontrado' : 'Nenhum cliente na fidelidade ainda'}
            description="O vendedor cadastra o cliente pelo WhatsApp na tela Nova cobrança, no momento da venda."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th className="text-right">Compras</Th>
                <Th className="text-right">Total</Th>
                {mode === 'GIFT' && <Th>Próximo brinde</Th>}
                <Th>Códigos em aberto</Th>
                <Th>WhatsApp</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{formatBrWhatsApp(c.phone)}</p>
                  </Td>
                  <Td className="text-right tabular-nums">{c.purchaseCount}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(c.totalSpentCents)}</Td>
                  {mode === 'GIFT' && <Td className="tabular-nums">{c.giftProgress} de {config.data?.giftEvery}</Td>}
                  <Td>
                    {c.rewards.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.rewards.map((r) => (
                          <Badge key={r.id} tone={r.status === 'RESERVED' ? 'warning' : 'success'}>
                            <span className="font-mono">{r.code}</span>
                            &nbsp;{r.kind === 'CASHBACK' ? formatBRL(r.valueCents) : r.description}
                            {r.status === 'RESERVED' ? ' · em uso' : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>{c.whatsappOptIn ? <Badge tone="success">Aceita mensagens</Badge> : <Badge>Sem consentimento</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void toggleOptIn(c)}>{c.whatsappOptIn ? 'Parar mensagens' : 'Aceitou mensagens'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(c)}>Excluir</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
