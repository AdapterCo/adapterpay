'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Spinner } from '@adapterpay/ui';
import { AuthShell } from '@/components/auth-shell';
import { CopyButton } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';

function MfaSetup() {
  const router = useRouter();
  const mandatory = useSearchParams().get('obrigatorio') === '1';
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user: { mfaEnabled: boolean; isSuperadmin: boolean } }>('/auth/me');
        setIsSuperadmin(me.user.isSuperadmin);
        if (me.user.mfaEnabled) {
          router.replace(me.user.isSuperadmin ? '/superadmin' : '/app/configuracoes');
          return;
        }
        setSetup(await api('/auth/mfa/setup', { method: 'POST' }));
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [router]);

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { code } });
      setCodes(r.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (codes) {
    return (
      <AuthShell title="Guarde seus códigos de recuperação">
        <Alert tone="warning">Cada código funciona uma única vez, caso você perca o acesso ao app autenticador. Eles não serão exibidos novamente.</Alert>
        <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <CopyButton text={codes.join('\n')} label="Copiar códigos" />
          <Button variant="secondary" onClick={() => router.replace(isSuperadmin ? '/superadmin' : '/app/configuracoes')}>Concluir</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Ativar autenticação em dois fatores"
      subtitle={mandatory ? 'Obrigatório para a equipe Adapter Co. e para administradores quando a empresa exigir.' : 'Proteja operações críticas com um app autenticador.'}
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {!setup ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : (
        <form onSubmit={enable} className="flex flex-col items-center gap-4">
          <p className="text-sm text-slate-600">Leia o QR com Google Authenticator, Microsoft Authenticator, 1Password ou outro app compatível.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="QR Code para configurar o autenticador" width={200} height={200} />
          <details className="w-full text-sm">
            <summary className="cursor-pointer text-brand-700">Não consegue ler o QR?</summary>
            <p className="mt-2 break-all rounded bg-slate-100 p-2 font-mono text-xs">{setup.secret}</p>
          </details>
          <Field label="Código de 6 dígitos" className="w-full">
            {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Button type="submit" className="w-full" loading={loading} disabled={code.length !== 6}>Ativar</Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaSetup />
    </Suspense>
  );
}
