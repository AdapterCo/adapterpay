'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<null | { emailEnabled: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setSent(await api<{ emailEnabled: boolean }>('/auth/forgot-password', { method: 'POST', body: { email } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link de redefinição para o seu email.">
      {sent?.emailEnabled ? (
        <Alert tone="success">Se houver uma conta com esse email, você receberá o link em instantes (válido por 1 hora). Confira também a caixa de spam.</Alert>
      ) : sent ? (
        <Alert tone="warning" title="Envio de email indisponível">
          Peça ao administrador da sua empresa para redefinir sua senha em Usuários. Se você é o administrador principal, fale com o suporte da Adapter Co.
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">
            {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" loading={loading}>Enviar link</Button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-sm text-brand-700 hover:underline">Voltar ao login</Link>
    </AuthShell>
  );
}
