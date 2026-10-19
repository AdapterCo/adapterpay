'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Dialog, Field, Input } from '@adapterpay/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;

const Ctx = createContext<Runner | null>(null);

/**
 * Operações críticas: se a API responder MFA_REQUIRED, pede o código do autenticador,
 * confirma a sessão (step-up) e repete a operação.
 */
export function CriticalProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const askCode = () =>
    new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setCode('');
      setError(null);
      setOpen(true);
    });

  const run: Runner = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'MFA_ENROLLMENT_REQUIRED') {
          router.push('/seguranca/mfa?obrigatorio=1');
          throw err;
        }
        if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
          await askCode();
          return fn();
        }
        throw err;
      }
    },
    [router],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/mfa/challenge', { method: 'POST', body: { code } });
      setOpen(false);
      pending.current?.resolve();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Ctx.Provider value={run}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            pending.current?.reject(new ApiError(403, 'MFA_REQUIRED', 'Operação cancelada'));
          }
        }}
        title="Confirme sua identidade"
        description="Esta é uma operação crítica. Digite o código do app autenticador."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Código">
            {(p) => <Input {...p} autoFocus autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.trim())} />}
          </Field>
          <Button type="submit" loading={loading} disabled={code.length < 6}>Confirmar</Button>
        </form>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useCritical(): Runner {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCritical fora do CriticalProvider');
  return ctx;
}
