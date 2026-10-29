import { ApiError } from './api';

/** Chamadas públicas dos parceiros de indicação (sem login): mesma origem + cabeçalho próprio. */
export async function partnerApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/public/partners${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', 'X-AdapterPay-Partner': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? 'Erro inesperado');
  return data as T;
}
