'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError, errorMessage } from '@/lib/api';

function AcceptInvite() {
  const token = useSearchParams().get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needsAccount, setNeedsAccount] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/users/accept-invite', {
        method: 'POST',
        body: { token, ...(needsAccount ? { name, password } : {}) },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('nome e senha')) {
        setNeedsAccount(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Convite aceito">
        <Alert tone="success">Seu acesso foi liberado. Entre para começar.</Alert>
        <Link href="/login" className="mt-6 block">
          <Button className="w-full">Entrar</Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Aceitar convite" subtitle="Você foi convidado para acessar uma empresa no AdapterPay.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!token && <Alert tone="danger">Link de convite inválido.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {needsAccount && (
          <>
            <Alert tone="info">Crie sua senha para concluir o primeiro acesso.</Alert>
            <Field label="Seu nome">
              {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números.">
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
          </>
        )}
        <Button type="submit" loading={loading} disabled={!token}>{needsAccount ? 'Criar acesso e aceitar' : 'Aceitar convite'}</Button>
      </form>
    </AuthShell>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
