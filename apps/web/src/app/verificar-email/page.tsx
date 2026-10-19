'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

function Verify() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) {
      setState('error');
      setMsg('Link inválido.');
      return;
    }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMsg(errorMessage(err));
      });
  }, [token]);

  return (
    <AuthShell title="Confirmação de email">
      {state === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Spinner className="h-4 w-4" /> Confirmando…
        </p>
      )}
      {state === 'ok' && (
        <>
          <Alert tone="success">Email confirmado! Entre para escolher a forma de pagamento e ativar seu plano.</Alert>
          <Link href="/login?verificado=1&next=/app/assinatura" className="mt-6 block">
            <Button className="w-full">Entrar</Button>
          </Link>
        </>
      )}
      {state === 'error' && <Alert tone="danger">{msg} Faça login para solicitar um novo link.</Alert>}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
