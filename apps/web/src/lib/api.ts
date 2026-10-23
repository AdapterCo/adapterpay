'use client';

/** Cliente da API AdapterPay (mesma origem; cookies HttpOnly; CSRF double-submit). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, 'CSRF_UNAVAILABLE', 'Não foi possível iniciar a sessão segura');
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

export function resetCsrf(): void {
  csrfToken = null;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: Options = {}, retry = true): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = data?.error;
    if (e?.code === 'CSRF_INVALID' && retry) {
      resetCsrf();
      return api<T>(path, opts, false);
    }
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? 'Erro inesperado', e?.details);
  }
  return data as T;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? 'Erro inesperado', e?.details);
  }
  return data as T;
}

/** Envio binário (foto de produto): corpo com os bytes da imagem. */
export async function apiUpload<T = unknown>(path: string, blob: Blob): Promise<T> {
  const csrf = await ensureCsrf();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': blob.type || 'image/jpeg', 'X-CSRF-Token': csrf },
      body: blob,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet.');
  }
  return parseResponse<T>(res);
}

/** API do totem: autentica pelo cookie do dispositivo (sem sessão de usuário nem CSRF da sessão). */
export async function totemApi<T = unknown>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api/v1/totem${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-AdapterPay-Totem': '1',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão. Tentando novamente…');
  }
  return parseResponse<T>(res);
}

/** Mensagem amigável para exibir ao usuário. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details) && err.details.length) {
      const first = err.details[0] as { message?: string };
      return first.message ? `${err.message}: ${first.message}` : err.message;
    }
    return err.message;
  }
  return 'Erro inesperado. Tente novamente.';
}

/** Gera chave de idempotência para criação de cobrança (retries não duplicam). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
