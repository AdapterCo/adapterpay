'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { formatBRL, PIX_KEY_LABELS, PIX_KEY_TYPES, partnerSignupSchema, REFERRAL_BONUS_CENTS, REFERRAL_WELCOME_CENTS, type PixKeyType } from '@adapterpay/shared';
import { Alert, Button, Checkbox, Field, Input, Select } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { CopyButton } from '@/components/domain';
import { errorMessage } from '@/lib/api';
import { partnerApi } from '@/lib/partner-api';

type Result =
  | { status: 'CREATED'; code: string; link: string; panelUrl: string; whatsappSent: boolean }
  | { status: 'EXISTS'; whatsappSent: boolean };

const PIX_PLACEHOLDER: Record<PixKeyType, string> = {
  CPF_CNPJ: '000.000.000-00',
  PHONE: '(11) 98765-4321',
  EMAIL: 'voce@email.com',
  RANDOM: '123e4567-e89b-12d3-a456-426614174000',
};

/** Cadastro de parceiro de indicação: qualquer pessoa divulga o AdapterPay e recebe por Pix. */
export default function PartnerSignupPage() {
  const [form, setForm] = useState({ name: '', phone: '', pixKeyType: 'CPF_CNPJ' as PixKeyType, pixKey: '', acceptTerms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = partnerSignupSchema.safeParse(form);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (map[String(i.path[0])] ??= i.message));
      setErrors(map);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      setResult(await partnerApi<Result>('', { ...form }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (result?.status === 'CREATED') {
    return (
      <AuthShell title="Pronto! Seu link de indicação" subtitle="Compartilhe com lojistas que recebem Pix no balcão.">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium">Link para divulgar</p>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <code className="flex-1 truncate rounded-lg bg-paper px-3 py-2.5 text-sm">{result.link}</code>
              <CopyButton text={result.link} label="Copiar" copiedLabel="Copiado" />
            </div>
            <p className="mt-1.5 text-sm text-slate-600">Código: <strong className="font-mono tracking-widest text-ink">{result.code}</strong></p>
          </div>
          <Alert tone="info" title="Guarde o link do seu painel">
            É por ele que você acompanha quantos se cadastraram e quanto tem a receber. Não compartilhe.
            {result.whatsappSent ? ' Também enviamos para o seu WhatsApp.' : ''}
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={result.panelUrl} className="flex-1"><Button className="w-full">Abrir meu painel</Button></a>
            <CopyButton text={result.panelUrl} label="Copiar link do painel" copiedLabel="Link do painel copiado" />
          </div>
        </div>
      </AuthShell>
    );
  }

  if (result?.status === 'EXISTS') {
    return (
      <AuthShell title="Este WhatsApp já é parceiro">
        {result.whatsappSent ? (
          <Alert tone="success">Enviamos para o seu WhatsApp o link de divulgação e um novo link do painel. O link antigo do painel deixou de valer.</Alert>
        ) : (
          <Alert tone="warning">Não foi possível enviar o link agora. Fale com a Adapter Co. para recuperar o acesso ao seu painel.</Alert>
        )}
        <Button variant="secondary" className="mt-4" onClick={() => setResult(null)}>Voltar</Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Indique o AdapterPay e ganhe por Pix"
      subtitle={`Não precisa ter conta. Cada lojista que assinar pelo seu link ganha ${formatBRL(REFERRAL_WELCOME_CENTS)} de desconto, e você recebe ${formatBRL(REFERRAL_BONUS_CENTS)} por Pix quando ele pagar a primeira mensalidade.`}
      wide
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Seu nome completo" error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="WhatsApp" hint="Para enviar seus links e avisar dos pagamentos." error={errors.phone}>
          {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98765-4321" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
        </Field>
        <Field label="Tipo da chave Pix" error={errors.pixKeyType}>
          {(p) => (
            <Select {...p} value={form.pixKeyType} onChange={(e) => setForm({ ...form, pixKeyType: e.target.value as PixKeyType })}>
              {PIX_KEY_TYPES.map((t) => <option key={t} value={t}>{PIX_KEY_LABELS[t]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Chave Pix para receber" error={errors.pixKey}>
          {(p) => <Input {...p} placeholder={PIX_PLACEHOLDER[form.pixKeyType]} value={form.pixKey} onChange={(e) => setForm({ ...form, pixKey: e.target.value })} />}
        </Field>
        <ol className="space-y-1 text-sm text-slate-600 sm:col-span-2">
          <li>1. Você recebe um link e um código para divulgar.</li>
          <li>2. No seu painel, acompanha quantos se cadastraram e quantos já pagaram.</li>
          <li>3. A Adapter Co. faz o Pix de {formatBRL(REFERRAL_BONUS_CENTS)} por lojista que pagou a primeira mensalidade, e o pagamento aparece no painel.</li>
        </ol>
        <div className="sm:col-span-2">
          <Checkbox
            checked={form.acceptTerms}
            onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
            label={
              <>
                Autorizo a Adapter Co. a guardar meu nome, WhatsApp e chave Pix para pagar as indicações e me enviar mensagens sobre elas, conforme a{' '}
                <Link href="/privacidade" target="_blank" className="text-brand-700 underline">Política de privacidade</Link>. Cada lojista conta uma vez.
              </>
            }
          />
          {errors.acceptTerms && <p role="alert" className="mt-1 text-xs text-red-600">{errors.acceptTerms}</p>}
        </div>
        <Button type="submit" loading={loading} className="sm:col-span-2">Quero meu link de indicação</Button>
      </form>
    </AuthShell>
  );
}
