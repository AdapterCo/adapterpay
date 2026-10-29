'use client';

import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { CopyButton } from '@/components/domain';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Overview {
  code: string;
  link: string;
  bonusCents: number;
  welcomeCents: number;
  creditCents: number;
  availableCents: number;
  earnedCents: number;
  referrals: Array<{ tradeName: string; createdAt: string; rewarded: boolean }>;
  history: Array<{ kind: 'REFERRAL_WELCOME' | 'REFERRAL_BONUS' | 'INVOICE'; amountCents: number; createdAt: string }>;
}

const HISTORY_LABEL: Record<Overview['history'][number]['kind'], string> = {
  REFERRAL_BONUS: 'Indicação que assinou',
  REFERRAL_WELCOME: 'Desconto de boas-vindas (código de indicação)',
  INVOICE: 'Descontado na mensalidade',
};

/** Link de indicação: quem indica ganha crédito; quem se cadastra pelo link ganha desconto uma única vez. */
export default function ReferralsPage() {
  const data = useApi<Overview>('/referrals');

  if (data.error) return <Alert tone="danger">{data.error.message}</Alert>;
  if (!data.data) return <Spinner className="h-6 w-6 text-brand-600" />;
  const o = data.data;
  const message = `Uso o AdapterPay para receber Pix no balcão com confirmação na hora. Cadastre-se pelo meu link e ganhe ${formatBRL(o.welcomeCents)} de desconto na primeira mensalidade: ${o.link}`;

  return (
    <>
      <PageHeader
        title="Indicações"
        description={`Indique outro lojista: ele ganha ${formatBRL(o.welcomeCents)} de desconto na primeira mensalidade e você ganha ${formatBRL(o.bonusCents)} de crédito quando ele pagar.`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Seu link de indicação" description="Envie para outros lojistas. O código também pode ser digitado no cadastro." />
          <CardBody className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-lg bg-paper px-3 py-2.5 text-sm">{o.link}</code>
              <CopyButton text={o.link} label="Copiar link" copiedLabel="Link copiado" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-600">
                Código: <strong className="font-mono text-base tracking-widest text-ink">{o.code}</strong>
              </p>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">Enviar pelo WhatsApp</Button>
              </a>
            </div>
            <ol className="space-y-1.5 text-sm text-slate-600">
              <li>1. O lojista se cadastra pelo seu link (ou digita o seu código) e ganha {formatBRL(o.welcomeCents)} de desconto na primeira mensalidade, uma única vez.</li>
              <li>2. Quando ele paga a primeira mensalidade, você ganha {formatBRL(o.bonusCents)} de crédito.</li>
              <li>3. O crédito é descontado sozinho das suas próximas mensalidades, no Pix ou no cartão.</li>
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Seus créditos" />
          <CardBody className="space-y-3">
            <div>
              <p className="text-xs text-slate-500">Saldo</p>
              <p className="text-3xl font-semibold tabular-nums">{formatBRL(o.creditCents)}</p>
              {o.availableCents < o.creditCents && (
                <p className="text-xs text-slate-500">{formatBRL(o.creditCents - o.availableCents)} já reservado na próxima mensalidade.</p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500">Ganho com indicações</p>
              <p className="text-lg font-semibold tabular-nums text-paid">{formatBRL(o.earnedCents)}</p>
            </div>
            <p className="text-xs text-slate-500">A mensalidade nunca fica abaixo de R$ 1,00; o que sobrar do crédito vale para os meses seguintes.</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Lojistas indicados" description={o.referrals.length ? `${o.referrals.length} cadastro${o.referrals.length > 1 ? 's' : ''} com o seu link.` : undefined} />
        {o.referrals.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">Ninguém se cadastrou com o seu link ainda. Envie para um lojista que recebe Pix no balcão.</p>
          </CardBody>
        ) : (
          <Table>
            <thead><tr><Th>Empresa</Th><Th>Cadastro</Th><Th>Seu crédito</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {o.referrals.map((r, i) => (
                <tr key={i}>
                  <Td>{r.tradeName}</Td>
                  <Td>{formatDateTime(r.createdAt)}</Td>
                  <Td>{r.rewarded ? <Badge tone="success">{formatBRL(o.bonusCents)} recebido</Badge> : <Badge tone="info">Aguardando 1ª mensalidade</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {o.history.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Extrato de créditos" />
          <Table>
            <thead><tr><Th>Data</Th><Th>Movimento</Th><Th className="text-right">Valor</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {o.history.map((h, i) => (
                <tr key={i}>
                  <Td>{formatDateTime(h.createdAt)}</Td>
                  <Td>{HISTORY_LABEL[h.kind] ?? h.kind}</Td>
                  <Td className={`text-right tabular-nums ${h.amountCents > 0 ? 'text-paid' : ''}`}>{h.amountCents > 0 ? '+' : '−'}{formatBRL(Math.abs(h.amountCents))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
