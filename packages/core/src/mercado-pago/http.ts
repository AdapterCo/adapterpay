import { redactPayload } from '../redact';

export type MpErrorKind = 'http' | 'timeout' | 'network' | 'invalid_response';

/**
 * Erro tipado de chamada ao Mercado Pago. `outcomeUnknown` indica que, para uma operação de escrita,
 * não sabemos se o provedor aplicou a operação (timeout/queda de rede/5xx) — nesses casos a cobrança
 * vai para RECONCILING e é reconciliada pela mesma chave de idempotência.
 */
export class MpApiError extends Error {
  constructor(
    message: string,
    readonly kind: MpErrorKind,
    readonly status: number | null,
    readonly body: unknown,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'MpApiError';
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }

  get notFound(): boolean {
    return this.status === 404;
  }

  get retryable(): boolean {
    return this.kind !== 'http' || this.status === 429 || (this.status !== null && this.status >= 500);
  }

  /** Para escritas: o provedor pode ter aplicado a operação. */
  get outcomeUnknown(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || (this.status !== null && this.status >= 500);
  }

  /** Erro definitivo de validação (a operação certamente NÃO foi aplicada). */
  get definitiveClientError(): boolean {
    return this.kind === 'http' && this.status !== null && this.status >= 400 && this.status < 500 && this.status !== 429 && this.status !== 409 && this.status !== 408;
  }

  /** Código de erro do corpo do MP quando presente (ex.: invalid_grant). */
  get providerCode(): string | null {
    const b = this.body as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return null;
    const v = b.error ?? b.code ?? (Array.isArray(b.errors) ? (b.errors[0] as Record<string, unknown>)?.code : null);
    return typeof v === 'string' ? v : null;
  }
}

export interface MpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  accessToken?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Envia o corpo como application/x-www-form-urlencoded (não usado por padrão). */
  form?: boolean;
}

export interface MpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class MercadoPagoHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MpClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(req: MpRequest): Promise<T> {
    const url = new URL(req.path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.opts.userAgent ?? 'AdapterPay/1.0',
    };
    if (req.accessToken) headers.Authorization = `Bearer ${req.accessToken}`;
    if (req.idempotencyKey) headers['X-Idempotency-Key'] = req.idempotencyKey;
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? this.opts.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new MpApiError(`Timeout em ${req.method} ${req.path}`, 'timeout', null, null);
      }
      throw new MpApiError(`Falha de rede em ${req.method} ${req.path}`, 'network', null, null);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 500) };
      }
    }

    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : null;
      throw new MpApiError(
        `Mercado Pago respondeu ${res.status} em ${req.method} ${req.path}`,
        'http',
        res.status,
        redactPayload(parsed),
        retryAfterMs,
      );
    }
    if (parsed === null && req.method !== 'DELETE') {
      throw new MpApiError(`Resposta vazia em ${req.method} ${req.path}`, 'invalid_response', res.status, null);
    }
    return parsed as T;
  }
}
