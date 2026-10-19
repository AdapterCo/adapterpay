'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Connection {
  id: string;
  mpUserId: string;
  nickname: string | null;
  email: string | null;
  scopes: string[];
  liveMode: boolean | null;
  status: 'ACTIVE' | 'NEEDS_RECONNECT' | 'REVOKED' | 'DISCONNECTED';
  tokenExpiresAt: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  storeCount: number;
  posCount: number;
}

const CALLBACK_ERRORS: Record<string, string> = {
  account_in_use: 'Esta conta Mercado Pago já está vinculada a outra empresa no AdapterPay.',
  account_mismatch: 'A conta autorizada é diferente da conta que estava sendo reconectada.',
  state_invalid: 'A autorização expirou ou já foi usada. Tente conectar novamente.',
  state_reused: 'A autorização já foi usada. Tente conectar novamente.',
  session_mismatch: 'A autorização foi iniciada em outra sessão. Faça login e tente novamente.',
  token_exchange_failed: 'Não foi possível concluir a autorização com o Mercado Pago.',
  identity_mismatch: 'A identidade retornada pelo Mercado Pago não confere.',
};

const STATUS: Record<Connection['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ACTIVE: { label: 'Conectada', tone: 'success' },
  NEEDS_RECONNECT: { label: 'Reconexão necessária', tone: 'warning' },
  REVOKED: { label: 'Revogada', tone: 'danger' },
  DISCONNECTED: { label: 'Desconectada', tone: 'neutral' },
};

function MercadoPagoInner() {
  const params = useSearchParams();
  const critical = useCritical();
  const list = useApi<Connection[]>('/integrations/mercado-pago/connections');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(params.get('connected') ? 'Conta Mercado Pago conectada com sucesso.' : null);
  const cbError = params.get('error');

  const go = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    try {
      const url = await critical(fn);
      const u = new URL(url);
      if (!/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname) && !/(^|\.)mercadolibre\.com$/.test(u.hostname)) throw new Error('Destino inesperado');
      window.location.assign(u.toString());
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : (err as Error).message);
      setBusy(null);
    }
  };

  const connect = () => go('connect', async () => (await api<{ authorizationUrl: string }>('/integrations/mercado-pago/connect')).authorizationUrl);
  const reconnect = (id: string) =>
    go(`r${id}`, async () => (await api<{ authorizationUrl: string }>(`/integrations/mercado-pago/connections/${id}/reconnect`, { method: 'POST' })).authorizationUrl);

  const test = async (id: string) => {
    setBusy(`t${id}`);
    setError(null);
    try {
      const r = await api<{ nickname: string | null }>(`/integrations/mercado-pago/connections/${id}/test`, { method: 'POST' });
      setMsg(`Conexão válida${r.nickname ? ` (${r.nickname})` : ''}.`);
      await list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: Connection) => {
    if (!confirm(`Desconectar ${c.nickname ?? c.mpUserId}? Novas cobranças nesta conta ficarão bloqueadas.`)) return;
    setBusy(`d${c.id}`);
    setError(null);
    try {
      await critical(() => api(`/integrations/mercado-pago/connections/${c.id}`, { method: 'DELETE' }));
      setMsg('Conta desconectada.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && (err.details as { activePos?: number })?.activePos) {
        if (confirm(`${err.message}`)) {
          await critical(() => api(`/integrations/mercado-pago/connections/${c.id}?confirm=true`, { method: 'DELETE' }));
          setMsg('Conta desconectada e POS desativados.');
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
      await list.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Mercado Pago"
        description="Conecte contas recebedoras por OAuth. Tokens ficam cifrados no servidor e nunca aparecem no navegador."
        actions={<Button onClick={connect} loading={busy === 'connect'}>Conectar conta</Button>}
      />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {cbError && <Alert tone="danger" className="mb-4">{CALLBACK_ERRORS[cbError] ?? `Falha na conexão (${cbError}).`}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {list.loading && !list.data ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : list.data?.length === 0 ? (
        <Card><EmptyState title="Nenhuma conta conectada" description="Conecte a conta Mercado Pago que vai receber os pagamentos das suas lojas." action={<Button onClick={connect}>Conectar conta</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.map((c) => (
            <Card key={c.id}>
              <CardHeader
                title={c.nickname ?? `Conta ${c.mpUserId}`}
                description={c.email ?? `user_id ${c.mpUserId}`}
                actions={<Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
              />
              <CardBody className="space-y-2 text-sm">
                <p><span className="text-slate-500">ID da conta:</span> {c.mpUserId}</p>
                <p><span className="text-slate-500">Ambiente:</span> {c.liveMode === false ? 'Teste (sandbox)' : c.liveMode ? 'Produção' : '—'}</p>
                <p><span className="text-slate-500">Escopos:</span> {c.scopes.length ? c.scopes.join(', ') : '—'}</p>
                <p><span className="text-slate-500">Lojas / POS vinculados:</span> {c.storeCount} / {c.posCount}</p>
                <p><span className="text-slate-500">Token renova até:</span> {formatDateTime(c.tokenExpiresAt)}</p>
                <p><span className="text-slate-500">Último teste:</span> {formatDateTime(c.lastTestedAt)}</p>
                {c.lastError && <Alert tone="warning">{c.lastError}</Alert>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="secondary" loading={busy === `t${c.id}`} onClick={() => test(c.id)} disabled={c.status !== 'ACTIVE'}>Testar</Button>
                  <Button size="sm" variant="secondary" loading={busy === `r${c.id}`} onClick={() => reconnect(c.id)}>Reconectar</Button>
                  <Button size="sm" variant="danger" loading={busy === `d${c.id}`} onClick={() => disconnect(c)}>Desconectar</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">
        Uma conta Mercado Pago só pode estar vinculada a uma empresa por vez. As credenciais de assinatura do AdapterPay são separadas das credenciais das suas vendas.
      </p>
    </>
  );
}

export default function MercadoPagoPage() {
  return (
    <Suspense>
      <MercadoPagoInner />
    </Suspense>
  );
}
