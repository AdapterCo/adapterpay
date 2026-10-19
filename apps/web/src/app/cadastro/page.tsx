'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { formatBRL, registerSchema } from '@adapterpay/shared';
import { Alert, Button, Checkbox, Field, Input, Select } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

interface Plan {
  id: string;
  name: string;
  priceCents: number;
}

function RegisterForm() {
  const params = useSearchParams();
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
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Plan[]>('/plans').then(setPlans).catch(() => setPlans([]));
  }, []);

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
      const res = await api<{ email: string }>('/auth/register', { method: 'POST', body: parsed.data });
      setDone(res.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Confirme seu email">
        <Alert tone="success" title="Cadastro recebido">
          Enviamos um link de confirmação para <strong>{done}</strong>. Depois de confirmar, faça login e conclua o pagamento do plano para liberar o uso.
        </Alert>
        <Link href="/login" className="mt-6 block">
          <Button className="w-full" variant="secondary">Ir para o login</Button>
        </Link>
      </AuthShell>
    );
  }

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
