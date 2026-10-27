'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { formatBrWhatsApp } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Spinner } from '@adapterpay/ui';
import { api, errorMessage } from '@/lib/api';

interface Status {
  available: boolean;
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';
  number: string | null;
  checkFailed?: boolean;
}
interface Pairing {
  qrBase64: string | null;
  pairingCode: string | null;
  connected: boolean;
}

/** O QR do WhatsApp expira em cerca de 40 s; geramos outro antes disso enquanto a tela está aberta. */
const QR_REFRESH_MS = 35_000;

/**
 * WhatsApp do lojista: os códigos de cashback e brinde saem deste número para o cliente.
 * O fechamento de caixa continua vindo do WhatsApp da Adapter Co.
 */
export function WhatsAppConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<Status>('/settings/whatsapp');
      setStatus(s);
      if (s.status === 'CONNECTED') setPairing(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Enquanto o QR está na tela, confere a conexão a cada 3 s.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(t);
  }, [pairing, refresh]);

  const connect = useCallback(
    async (withPhone: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const p = await api<Pairing>('/settings/whatsapp/connect', { method: 'POST', body: withPhone && phone.trim() ? { number: phone } : {} });
        if (p.connected) {
          setPairing(null);
          await refresh();
        } else {
          setPairing(p);
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [phone, refresh],
  );

  // Renova o QR antes de expirar (não renova o código por número, que vale por mais tempo).
  useEffect(() => {
    if (!pairing || pairing.pairingCode) return;
    const t = setTimeout(() => void connect(false), QR_REFRESH_MS);
    return () => clearTimeout(t);
  }, [pairing, connect]);

  const disconnect = async () => {
    if (!window.confirm('Desconectar o WhatsApp da loja? Os códigos de fidelidade deixam de ser enviados aos clientes até você conectar de novo.')) return;
    setBusy(true);
    setError(null);
    try {
      await api('/settings/whatsapp/disconnect', { method: 'POST' });
      setPairing(null);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.status === 'CONNECTED';

  return (
    <Card>
      <CardHeader
        title="WhatsApp da loja"
        description="Os códigos de cashback e brinde chegam ao cliente por este número. O fechamento de caixa continua vindo do WhatsApp da Adapter Co."
        actions={status && (connected ? <Badge tone="success">Conectado</Badge> : pairing ? <Badge tone="warning">Aguardando leitura</Badge> : <Badge>Desconectado</Badge>)}
      />
      <CardBody className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {!status ? (
          <Spinner className="h-5 w-5 text-brand-600" />
        ) : !status.available ? (
          <Alert tone="warning">A conexão de WhatsApp ainda não está ativa na plataforma. Avise o suporte da Adapter Co.</Alert>
        ) : connected ? (
          <>
            <p className="text-sm text-slate-700">
              Enviando pelo número <strong className="tabular-nums">{formatBrWhatsApp(status.number) || 'conectado'}</strong>.
              {status.checkFailed && <span className="text-slate-500"> Não foi possível confirmar a conexão agora.</span>}
            </p>
            <div>
              <Button type="button" variant="secondary" loading={busy} onClick={() => void disconnect()}>Desconectar WhatsApp</Button>
            </div>
          </>
        ) : pairing ? (
          <div className="flex flex-col items-center gap-3 text-center">
            {pairing.pairingCode ? (
              <>
                <p className="text-sm text-slate-700">No celular da loja, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho &gt; Conectar com número de telefone e digite:</p>
                <p className="font-mono text-3xl font-semibold tracking-[0.2em] text-ink">{pairing.pairingCode}</p>
              </>
            ) : pairing.qrBase64 ? (
              <>
                <img src={pairing.qrBase64} alt="QR Code para conectar o WhatsApp da loja" width={240} height={240} className="rounded-lg ring-1 ring-line" />
                <p className="text-sm text-slate-700">No celular da loja, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho e aponte para o QR.</p>
              </>
            ) : (
              <Spinner className="h-6 w-6 text-brand-600" />
            )}
            <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner className="h-3 w-3" /> Esperando a conexão. Esta tela atualiza sozinha.</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPairing(null)}>Cancelar</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600">Use um número comercial da loja. Ele fica conectado como um aparelho do WhatsApp, igual ao WhatsApp Web.</p>
            <div>
              <Button type="button" loading={busy} onClick={() => void connect(false)}>Conectar com QR Code</Button>
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
              <Field label="Ou receba um código no número" hint="Útil quando o QR precisa ser lido no mesmo celular." className="flex-1">
                {(p) => <Input {...p} type="tel" inputMode="tel" placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(e.target.value)} />}
              </Field>
              <Button type="button" variant="secondary" loading={busy} disabled={!phone.trim()} onClick={() => void connect(true)}>Gerar código</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
