'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { formatBrWhatsApp, parsePercentToBps } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, Spinner } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { CopyButton, MoneyInput } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Settings {
  legalName: string;
  tradeName: string;
  taxIdMasked: string;
  timezone: string;
  logoUrl: string | null;
  brandColor: string | null;
  fiscalAddress: string | null;
  allowSellerCancel: boolean;
  requireAdminMfa: boolean;
  savingsPosRateBps: number;
  savingsLinkRateBps: number;
  dailyReportEnabled: boolean;
  dailyReportPhone: string | null;
  dailyReportHour: number;
  loyaltyMode: 'OFF' | 'CASHBACK' | 'GIFT';
  loyaltyCashbackBps: number;
  loyaltyGiftEvery: number;
  loyaltyGiftName: string | null;
  loyaltyMinPurchaseCents: number;
  googleReviewUrl: string | null;
  restaurantMode: boolean;
  whatsappAvailable: boolean;
  lastDailyReport: { day: string; status: string; sentAt: string | null; lastError: string | null } | null;
}

const bpsToInput = (bps: number) => (bps / 100).toFixed(2).replace('.', ',');
const REPORT_STATUS: Record<string, string> = { SENT: 'enviado', FAILED: 'falhou', PENDING: 'enviando' };

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'];

export default function SettingsPage() {
  const { me, reload } = useSession();
  const critical = useCritical();
  const settings = useApi<Settings>('/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [rates, setRates] = useState({ pos: '', link: '' });
  const [phone, setPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [cashbackRate, setCashbackRate] = useState('');

  useEffect(() => {
    if (!settings.data) return;
    setForm(settings.data);
    setRates({ pos: bpsToInput(settings.data.savingsPosRateBps), link: bpsToInput(settings.data.savingsLinkRateBps) });
    setCashbackRate(bpsToInput(settings.data.loyaltyCashbackBps));
    setPhone(formatBrWhatsApp(settings.data.dailyReportPhone));
  }, [settings.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setMsg(null);
    const posBps = parsePercentToBps(rates.pos);
    const linkBps = parsePercentToBps(rates.link);
    if (posBps === null || linkBps === null) {
      setError('Informe as taxas como 0,49 (entre 0 e 20%).');
      return;
    }
    const cashbackBps = parsePercentToBps(cashbackRate);
    if (form.loyaltyMode === 'CASHBACK' && (!cashbackBps || cashbackBps < 1)) {
      setError('Informe o percentual de cashback, por exemplo 5.');
      return;
    }
    setSaving(true);
    try {
      await critical(() =>
        api('/settings', {
          method: 'PATCH',
          body: {
            tradeName: form.tradeName,
            legalName: form.legalName,
            timezone: form.timezone,
            logoUrl: form.logoUrl || null,
            googleReviewUrl: form.googleReviewUrl?.trim() || null,
            restaurantMode: form.restaurantMode,
            brandColor: form.brandColor || null,
            fiscalAddress: form.fiscalAddress || null,
            allowSellerCancel: form.allowSellerCancel,
            requireAdminMfa: form.requireAdminMfa,
            savingsPosRateBps: posBps,
            savingsLinkRateBps: linkBps,
            dailyReportEnabled: form.dailyReportEnabled,
            dailyReportPhone: phone.trim() ? phone : null,
            dailyReportHour: form.dailyReportHour,
            loyaltyMode: form.loyaltyMode,
            ...(cashbackBps ? { loyaltyCashbackBps: cashbackBps } : {}),
            loyaltyGiftEvery: form.loyaltyGiftEvery,
            loyaltyGiftName: form.loyaltyGiftName?.trim() || null,
            loyaltyMinPurchaseCents: form.loyaltyMinPurchaseCents,
          },
        }),
      );
      setMsg('Configurações salvas.');
      await Promise.all([settings.reload(), reload()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const exportData = async () => {
    setError(null);
    try {
      const data = await critical(() => api<unknown>('/privacy/export'));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adapterpay-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const sendTest = async () => {
    setError(null);
    setMsg(null);
    setTesting(true);
    try {
      await api('/settings/daily-report/test', { method: 'POST' });
      setMsg('Fechamento de teste enviado. Confira o WhatsApp.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const regenCodes = async () => {
    setError(null);
    try {
      const r = await critical(() => api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST' }));
      setCodes(r.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!form) return settings.error ? <Alert tone="danger">{settings.error.message}</Alert> : <Spinner className="h-6 w-6 text-brand-600" />;

  return (
    <>
      <PageHeader title="Configurações" description="Empresa, identidade visual, segurança e privacidade." />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Empresa" description={`Documento: ${form.taxIdMasked}`} />
          <CardBody className="flex flex-col gap-3">
            <Field label="Razão social">{(p) => <Input {...p} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />}</Field>
            <Field label="Nome fantasia" hint="Exibido nas páginas públicas de pagamento.">{(p) => <Input {...p} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />}</Field>
            <Field label="Endereço fiscal (mínimo)">{(p) => <Input {...p} value={form.fiscalAddress ?? ''} onChange={(e) => setForm({ ...form, fiscalAddress: e.target.value })} />}</Field>
            <Field label="Fuso horário padrão">
              {(p) => (
                <Select {...p} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Identidade visual" description="Usada nas páginas públicas (/p e /c)." />
          <CardBody className="flex flex-col gap-3">
            <Field label="URL do logotipo (https)">{(p) => <Input {...p} type="url" placeholder="https://…" value={form.logoUrl ?? ''} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />}</Field>
            <Field
              label="Link de avaliação no Google"
              hint="Aparece para o cliente depois do pagamento aprovado. No Google Perfil da Empresa, use “Pedir avaliações” e copie o link."
            >
              {(p) => <Input {...p} type="url" placeholder="https://g.page/r/…/review" value={form.googleReviewUrl ?? ''} onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })} />}
            </Field>
            <Field label="Cor da marca">
              {(p) => (
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="Seletor de cor" value={form.brandColor ?? '#005efe'} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} className="h-10 w-12 rounded border border-slate-300" />
                  <Input {...p} value={form.brandColor ?? ''} placeholder="#005efe" onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
                </div>
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Operação" />
          <CardBody className="flex flex-col gap-3">
            <Checkbox
              checked={form.restaurantMode}
              onChange={(e) => setForm({ ...form, restaurantMode: e.target.checked })}
              label="Modo Restaurante: mesas com QR próprio e conta paga integral ou dividida entre as pessoas"
            />
            {form.restaurantMode && (
              <p className="-mt-1 text-xs text-slate-500">Depois de salvar, o menu Mesas aparece. Cada mesa usa um POS próprio (conta no limite de POS do plano). Balcão e totem continuam iguais.</p>
            )}
            <Checkbox checked={form.allowSellerCancel} onChange={(e) => setForm({ ...form, allowSellerCancel: e.target.checked })} label="Permitir que vendedores cancelem as próprias cobranças pendentes (somente se o Mercado Pago confirmar o cancelamento)" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Fechamento de caixa no WhatsApp"
            description="Resumo do dia por caixa e por vendedor: total, quantidade, ticket médio e economia."
          />
          <CardBody className="flex flex-col gap-3">
            {!form.whatsappAvailable && (
              <Alert tone="warning">O envio por WhatsApp ainda não está ativo na plataforma. Avise o suporte da Adapter Co.</Alert>
            )}
            <Checkbox
              checked={form.dailyReportEnabled}
              onChange={(e) => setForm({ ...form, dailyReportEnabled: e.target.checked })}
              label="Enviar o fechamento automaticamente todo dia"
            />
            <Field label="WhatsApp que recebe" hint="Com DDD. Ex.: (11) 98765-4321">
              {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <Field label="Horário do envio" hint="Até 5h, o resumo é do dia anterior inteiro. A partir de 6h, é do dia até o horário do envio.">
              {(p) => (
                <Select {...p} value={form.dailyReportHour} onChange={(e) => setForm({ ...form, dailyReportHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={testing} disabled={!form.whatsappAvailable || !settings.data?.dailyReportPhone} onClick={sendTest}>
                Enviar teste agora
              </Button>
              {form.lastDailyReport && (
                <span className="text-xs text-slate-500">
                  Último fechamento: {form.lastDailyReport.day.split('-').reverse().join('/')} · {REPORT_STATUS[form.lastDailyReport.status] ?? form.lastDailyReport.status}
                </span>
              )}
            </div>
            {!settings.data?.dailyReportPhone && <p className="text-xs text-slate-500">Salve o número para liberar o envio de teste.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Fidelidade"
            description="Recompense quem volta. O cliente é identificado pelo WhatsApp no caixa e recebe um código de uso único."
          />
          <CardBody className="flex flex-col gap-3">
            <Field label="Modalidade">
              {(p) => (
                <Select {...p} value={form.loyaltyMode} onChange={(e) => setForm({ ...form, loyaltyMode: e.target.value as Settings['loyaltyMode'] })}>
                  <option value="OFF">Desligada</option>
                  <option value="CASHBACK">Cashback: % de cada compra vira desconto na próxima</option>
                  <option value="GIFT">Brinde: a cada N compras o cliente ganha um brinde</option>
                </Select>
              )}
            </Field>
            {form.loyaltyMode === 'CASHBACK' && (
              <Field label="Cashback (%)" hint="Ex.: 5 = R$ 2,50 de cashback numa compra de R$ 50,00.">
                {(p) => <Input {...p} inputMode="decimal" value={cashbackRate} onChange={(e) => setCashbackRate(e.target.value)} />}
              </Field>
            )}
            {form.loyaltyMode === 'GIFT' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="A cada quantas compras">
                  {(p) => (
                    <Input {...p} type="number" min={2} max={100} value={form.loyaltyGiftEvery} onChange={(e) => setForm({ ...form, loyaltyGiftEvery: Math.max(2, Math.min(100, Number(e.target.value) || 2)) })} />
                  )}
                </Field>
                <Field label="Brinde">
                  {(p) => <Input {...p} maxLength={60} placeholder="1 café grátis" value={form.loyaltyGiftName ?? ''} onChange={(e) => setForm({ ...form, loyaltyGiftName: e.target.value })} />}
                </Field>
              </div>
            )}
            {form.loyaltyMode !== 'OFF' && (
              <Field label="Compra mínima para contar (opcional)">
                {(p) => <MoneyInput {...p} valueCents={form.loyaltyMinPurchaseCents || null} onChange={(c) => setForm({ ...form, loyaltyMinPurchaseCents: c ?? 0 })} />}
              </Field>
            )}
            {form.loyaltyMode !== 'OFF' && !form.whatsappAvailable && (
              <p className="text-xs text-slate-500">O envio dos códigos por WhatsApp ainda não está ativo; o vendedor vê os códigos na tela de cobrança.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Quanto você economizou"
            description="Taxas usadas na comparação do painel e do fechamento. Ajuste se o seu contrato for diferente."
          />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Pix na maquininha (%)">
              {(p) => <Input {...p} inputMode="decimal" value={rates.pos} onChange={(e) => setRates({ ...rates, pos: e.target.value })} />}
            </Field>
            <Field label="Pix por link (%)">
              {(p) => <Input {...p} inputMode="decimal" value={rates.link} onChange={(e) => setRates({ ...rates, link: e.target.value })} />}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Segurança" actions={me?.user.mfaEnabled ? <Badge tone="success">MFA ativo</Badge> : <Badge tone="warning">MFA inativo</Badge>} />
          <CardBody className="flex flex-col gap-3">
            {!me?.user.mfaEnabled ? (
              <Link href="/seguranca/mfa"><Button variant="secondary">Ativar autenticação em dois fatores</Button></Link>
            ) : (
              <Button variant="secondary" onClick={regenCodes}>Gerar novos códigos de recuperação</Button>
            )}
            {codes && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-600">Novos códigos (os anteriores deixaram de valer):</p>
                <p className="mt-1 font-mono text-xs">{codes.join(' · ')}</p>
                <CopyButton text={codes.join('\n')} label="Copiar" size="sm" className="mt-2" />
              </div>
            )}
            <Checkbox checked={form.requireAdminMfa} onChange={(e) => setForm({ ...form, requireAdminMfa: e.target.checked })} label="Exigir MFA de todos os administradores em operações críticas" />
          </CardBody>
        </Card>

        <div className="flex justify-end lg:col-span-2">
          <Button type="submit" loading={saving}>Salvar configurações</Button>
        </div>
      </form>

      <Card className="mt-6">
        <CardHeader title="Privacidade (LGPD)" description="Exporte os dados da empresa: usuários, lojas, POS, cobranças e faturas, sem credenciais." />
        <CardBody>
          <Button variant="secondary" onClick={exportData}>Exportar dados da empresa (JSON)</Button>
        </CardBody>
      </Card>
    </>
  );
}
