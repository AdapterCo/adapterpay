'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatBRL, PIX_KEY_LABELS, type PixKeyType } from '@adapterpay/shared';
import { Alert, Badge, Button, Spinner } from '@adapterpay/ui';
import { BrandSignature, Logo } from '@/components/brand';
import { CopyButton } from '@/components/domain';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { partnerApi } from '@/lib/partner-api';

interface Panel {
  name: string;
  status: 'ACTIVE' | 'BLOCKED';
  code: string;
  link: string;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
  bonusCents: number;
  welcomeCents: number;
  totals: { registered: number; paying: number; waiting: number; toReceiveCents: number; receivedCents: number };
  referrals: Array<{ business: string; createdAt: string; status: 'REGISTERED' | 'EARNED' | 'PAID_OUT'; amountCents: number; earnedAt: string | null }>;
  payouts: Array<{ amountCents: number; count: number; paidAt: string }>;
}

const STATUS: Record<Panel['referrals'][number]['status'], { label: string; tone: 'info' | 'warning' | 'success' }> = {
  REGISTERED: { label: 'Cadastrou, aguardando 1ª mensalidade', tone: 'info' },
  EARNED: { label: 'Pagou: a receber', tone: 'warning' },
  PAID_OUT: { label: 'Pago a você', tone: 'success' },
};

/** Painel do parceiro (link secreto): quantos usaram o link, quanto vai receber e o que já recebeu. */
export default function PartnerPanelPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Panel | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await partnerApi<Panel>(`/${encodeURIComponent(token)}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const message = data
    ? `Recebe Pix no balcão? Com o AdapterPay o pagamento aparece confirmado na hora, sem conferir print. Cadastre-se pelo meu link e ganhe ${formatBRL(data.welcomeCents)} de desconto na primeira mensalidade: ${data.link}`
    : '';

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="px-4 py-5"><div className="mx-auto max-w-4xl"><Logo /></div></header>
      <main id="conteudo" className="mx-auto w-full max-w-4xl flex-1 px-4 pb-16">
        {notFound ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-line">
            <h1 className="text-xl font-semibold">Link do painel inválido</h1>
            <p className="mt-2 text-sm text-slate-600">Ele pode ter sido trocado por um link novo. Peça um novo link em <Link href="/indique" className="text-brand-700 underline">Indique e ganhe</Link> com o mesmo WhatsApp.</p>
          </div>
        ) : !data ? (
          <Spinner className="mx-auto my-16 h-8 w-8 text-brand-600" />
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Olá, {data.name.split(' ')[0]}</h1>
            <p className="mt-1 text-sm text-slate-600">
              Você recebe {formatBRL(data.bonusCents)} por Pix por lojista que pagar a primeira mensalidade. Chave cadastrada: {PIX_KEY_LABELS[data.pixKeyType]} {data.pixKeyMasked}.
            </p>
            {data.status === 'BLOCKED' && <Alert tone="warning" className="mt-4">Seu código está pausado e não vale para novos cadastros. Fale com a Adapter Co.</Alert>}

            <section className="mt-6 grid gap-3 sm:grid-cols-4" aria-label="Resumo">
              {[
                { label: 'Cadastros pelo seu link', value: String(data.totals.registered) },
                { label: 'Já pagaram', value: String(data.totals.paying) },
                { label: 'A receber', value: formatBRL(data.totals.toReceiveCents), strong: true },
                { label: 'Já recebido', value: formatBRL(data.totals.receivedCents) },
              ].map((k) => (
                <div key={k.label} className={`rounded-2xl p-4 ring-1 ${k.strong ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-line'}`}>
                  <p className={`text-xs ${k.strong ? 'text-white/80' : 'text-slate-500'}`}>{k.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
                </div>
              ))}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-line">
              <h2 className="font-semibold">Seu link de divulgação</h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 truncate rounded-lg bg-paper px-3 py-2.5 text-sm">{data.link}</code>
                <CopyButton text={data.link} label="Copiar link" copiedLabel="Link copiado" />
                <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><Button variant="secondary">Enviar pelo WhatsApp</Button></a>
              </div>
              <p className="mt-2 text-sm text-slate-600">Código para digitar no cadastro: <strong className="font-mono tracking-widest text-ink">{data.code}</strong></p>
            </section>

            <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-line">
              <div className="flex items-center justify-between p-5">
                <h2 className="font-semibold">Quem usou o seu link</h2>
                <Button variant="ghost" size="sm" onClick={() => void load()}>Atualizar</Button>
              </div>
              {data.referrals.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-slate-500">Ninguém se cadastrou ainda. Envie o link para lojistas que recebem Pix no balcão.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.referrals.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div>
                        <p className="font-medium">{r.business}</p>
                        <p className="text-xs text-slate-500">Cadastro em {formatDateTime(r.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {r.amountCents > 0 && <span className="tabular-nums font-semibold">{formatBRL(r.amountCents)}</span>}
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.payouts.length > 0 && (
              <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-line">
                <h2 className="p-5 font-semibold">Pagamentos recebidos</h2>
                <ul className="divide-y divide-slate-100">
                  {data.payouts.map((p, i) => (
                    <li key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{formatDateTime(p.paidAt)} · {p.count} {p.count === 1 ? 'indicação' : 'indicações'}</span>
                      <span className="font-semibold tabular-nums text-paid">{formatBRL(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="mt-6 text-xs text-slate-500">Os nomes das empresas aparecem abreviados para proteger os dados delas. Este link é pessoal: não compartilhe.</p>
          </>
        )}
      </main>
      <footer className="px-4 pb-6 text-center"><BrandSignature /></footer>
    </div>
  );
}
