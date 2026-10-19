'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { passwordSchema } from '@adapterpay/shared';
import { Alert, Button, Field, Input } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const check = passwordSchema.safeParse(password);
    if (!check.success) return setError(check.error.issues[0]?.message ?? 'Senha inválida');
    if (password !== confirm) return setError('As senhas não conferem');
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      router.replace('/login?senha=1');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Definir nova senha" subtitle="Por segurança, todas as sessões abertas serão encerradas.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!token && <Alert tone="danger">Link inválido.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirme a nova senha">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" loading={loading} disabled={!token}>Salvar senha</Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
