'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** Busca simples com recarga manual. path=null desabilita. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current) setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Erro inesperado'));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/**
 * Assina um endpoint SSE do NOSSO backend. Em falha repetida, cai para polling (fallback 3s)
 * chamando `onFallbackTick`. Nunca consulta o Mercado Pago diretamente.
 */
export function useEventStream(
  url: string | null,
  events: Record<string, (data: unknown) => void>,
  onFallbackTick?: () => void,
) {
  const handlers = useRef(events);
  handlers.current = events;
  const fallbackRef = useRef(onFallbackTick);
  fallbackRef.current = onFallbackTick;
  const [mode, setMode] = useState<'sse' | 'polling' | 'idle'>('idle');

  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let failures = 0;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const startPolling = () => {
      if (pollTimer || !fallbackRef.current) return;
      setMode('polling');
      pollTimer = setInterval(() => fallbackRef.current?.(), 3000);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource(url, { withCredentials: true });
      setMode('sse');
      for (const name of Object.keys(handlers.current)) {
        es.addEventListener(name, (ev) => {
          failures = 0;
          let parsed: unknown = (ev as MessageEvent).data;
          try {
            parsed = JSON.parse((ev as MessageEvent).data as string);
          } catch {
            /* texto simples */
          }
          handlers.current[name]?.(parsed);
        });
      }
      es.onerror = () => {
        es?.close();
        failures++;
        if (failures >= 3) startPolling();
        // Reconecta com espera crescente (limitada); servidor encerra streams longos por design.
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [url]);

  return mode;
}

/** Diferença entre o relógio do servidor e o do cliente — o prazo usa sempre o backend. */
export function useServerOffset(serverTime: string | null | undefined): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);
  return offset;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
