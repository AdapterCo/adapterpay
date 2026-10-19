'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError, errorMessage, resetCsrf } from '@/lib/api';

function safeNext(next: string | null): string {
  // Evita open redirect: somente caminhos internos.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUnverified(false);
    try {
      const res = await api<{ ok: true; mfaEnrollmentRequired: boolean }>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(needMfa && mfaCode ? { mfaCode } : {}) },
      });
      resetCsrf();
      if (res.mfaEnrollmentRequired) {
        router.replace('/seguranca/mfa?obrigatorio=1');
        return;
      }
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setNeedMfa(true);
        if (mfaCode) setError(err.message);
      } else if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    await api('/auth/resend-verification', { method: 'POST', body: { email } }).catch(() => undefined);
    setError('Se o email estiver pendente de confirmação, enviamos um novo link.');
    setUnverified(false);
  };

  return (
    <AuthShell title="Entrar no AdapterPay" subtitle="Acesse o painel da sua empresa.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {params.get('verificado') && <Alert tone="success">Email confirmado. Faça login para continuar.</Alert>}
        {params.get('senha') && <Alert tone="success">Senha redefinida. Entre com a nova senha.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {unverified && (
          <Alert tone="warning" title="Confirme seu email">
            Enviamos um link de confirmação no cadastro.{' '}
            <button type="button" onClick={resend} className="font-medium underline">Reenviar link</button>
          </Alert>
        )}
        <Field label="Email">
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Senha">
          {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {needMfa && (
          <Field label="Código do autenticador" hint="6 dígitos do app autenticador ou um código de recuperação (XXXX-XXXX).">
            {(p) => <Input {...p} inputMode="text" autoComplete="one-time-code" autoFocus value={mfaCode} onChange={(e) => setMfaCode(e.target.value.trim())} />}
          </Field>
        )}
        <Button type="submit" loading={loading} className="w-full">Entrar</Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/esqueci-senha" className="text-brand-700 hover:underline">Esqueci minha senha</Link>
          <Link href="/planos" className="text-brand-700 hover:underline">Criar conta</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
