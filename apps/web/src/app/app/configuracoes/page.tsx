'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, Spinner } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { CopyButton } from '@/components/domain';
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
}

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

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await critical(() =>
        api('/settings', {
          method: 'PATCH',
          body: {
            tradeName: form.tradeName,
            legalName: form.legalName,
            timezone: form.timezone,
            logoUrl: form.logoUrl || null,
            brandColor: form.brandColor || null,
            fiscalAddress: form.fiscalAddress || null,
            allowSellerCancel: form.allowSellerCancel,
            requireAdminMfa: form.requireAdminMfa,
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
            <Checkbox checked={form.allowSellerCancel} onChange={(e) => setForm({ ...form, allowSellerCancel: e.target.checked })} label="Permitir que vendedores cancelem as próprias cobranças pendentes (somente se o Mercado Pago confirmar o cancelamento)" />
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
