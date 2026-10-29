'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { formatBRL, isReferralCode, normalizeReferralCode, REFERRAL_WELCOME_CENTS, registerSchema } from '@adapterpay/shared';
import { Alert, Button, Checkbox, Field, Input, Select } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage, resetCsrf } from '@/lib/api';

interface Plan {
  id: string;
  name: string;
  priceCents: number;
}

const REF_KEY = 'adapterpay:indicacao';

function RegisterForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({
    planId: params.get('plano') ?? 'inicial',
    legalName: '',
    tradeName: '',
    taxId: '',
    adminName: '',
    email: '',
    password: '',
    acceptTerms: false,
    referralCode: normalizeReferralCode(params.get('ref') ?? ''),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Plan[]>('/plans').then(setPlans).catch(() => setPlans([]));
  }, []);

  // Guarda o código do link de indicação: quem passa pelos planos antes de se cadastrar não o perde.
  useEffect(() => {
    try {
      const fromLink = normalizeReferralCode(params.get('ref') ?? '');
      if (fromLink) window.localStorage.setItem(REF_KEY, fromLink);
      else {
        const saved = window.localStorage.getItem(REF_KEY);
        if (saved) setForm((f) => (f.referralCode ? f : { ...f, referralCode: saved }));
      }
    } catch {
      /* navegação privada */
    }
  }, [params]);

  const hasReferral = isReferralCode(normalizeReferralCode(form.referralCode));

  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (map[String(i.path[0])] ??= i.message));
      setErrors(map);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      // Conta criada já ativa e logada: segue direto para o pagamento do plano.
      const res = await api<{ ok: true; planId: string }>('/auth/register', { method: 'POST', body: parsed.data });
      try {
        window.localStorage.removeItem(REF_KEY);
      } catch {
        /* navegação privada */
      }
      resetCsrf();
      router.replace(`/assinar/${encodeURIComponent(res.planId)}`);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Criar conta da empresa"
      subtitle="O cadastro é gratuito. O uso começa após o pagamento do plano, e não há teste grátis."
      wide
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Plano" className="sm:col-span-2" error={errors.planId}>
          {(p) => (
            <Select {...p} value={form.planId} onChange={(e) => set('planId')(e.target.value)}>
              {plans.length === 0 && <option value={form.planId}>{form.planId}</option>}
              {plans.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name} — {formatBRL(pl.priceCents)}/mês
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Razão social" error={errors.legalName}>
          {(p) => <Input {...p} autoComplete="organization" value={form.legalName} onChange={(e) => set('legalName')(e.target.value)} />}
        </Field>
        <Field label="Nome fantasia" error={errors.tradeName}>
          {(p) => <Input {...p} value={form.tradeName} onChange={(e) => set('tradeName')(e.target.value)} />}
        </Field>
        <Field label="CNPJ ou CPF" error={errors.taxId}>
          {(p) => <Input {...p} inputMode="numeric" value={form.taxId} onChange={(e) => set('taxId')(e.target.value)} />}
        </Field>
        <Field label="Seu nome" error={errors.adminName}>
          {(p) => <Input {...p} autoComplete="name" value={form.adminName} onChange={(e) => set('adminName')(e.target.value)} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />}
        </Field>
        <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números." error={errors.password}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password')(e.target.value)} />}
        </Field>
        <Field
          label="Código de indicação (opcional)"
          hint={hasReferral ? undefined : `Recebeu um código de outro lojista? Ganhe ${formatBRL(REFERRAL_WELCOME_CENTS)} de desconto na primeira mensalidade.`}
          error={errors.referralCode}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              autoCapitalize="characters"
              maxLength={20}
              placeholder="Ex.: K7Q2MX9A"
              value={form.referralCode}
              onChange={(e) => set('referralCode')(e.target.value.toUpperCase())}
            />
          )}
        </Field>
        {hasReferral && (
          <Alert tone="success" className="sm:col-span-2">
            Indicação aplicada: {formatBRL(REFERRAL_WELCOME_CENTS)} de desconto na primeira mensalidade (uma única vez).
          </Alert>
        )}
        <div className="sm:col-span-2">
          <Checkbox
            checked={form.acceptTerms}
            onChange={(e) => set('acceptTerms')(e.target.checked)}
            label={
              <>
                Li e aceito os <Link href="/termos" target="_blank" className="text-brand-700 underline">Termos de uso</Link> e a{' '}
                <Link href="/privacidade" target="_blank" className="text-brand-700 underline">Política de privacidade</Link>.
              </>
            }
          />
          {errors.acceptTerms && <p role="alert" className="mt-1 text-xs text-red-600">{errors.acceptTerms}</p>}
        </div>
        <Button type="submit" loading={loading} className="sm:col-span-2">Criar conta</Button>
        <p className="text-sm text-slate-500 sm:col-span-2">
          Já tem conta? <Link href="/login" className="text-brand-700 hover:underline">Entrar</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
