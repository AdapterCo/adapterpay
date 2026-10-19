'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { formatBRL, parseBrlInputToCents } from '@adapterpay/shared';
import { Badge, Button, Input } from '@adapterpay/ui';
import { chargeLabel, chargeTone } from '@/lib/format';

export function ChargeStatusBadge({ status }: { status: string }) {
  return <Badge tone={chargeTone(status)}>{chargeLabel(status)}</Badge>;
}

/** QR renderizado no navegador a partir de um texto (BR Code ou URL). */
export function QrImage({ value, size = 256, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt={label} className="rounded-lg bg-white" />;
}

export function CopyButton({ text, label = 'Copiar', copiedLabel = 'Copiado!', className, size = 'md' }: { text: string; label?: string; copiedLabel?: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para navegadores sem Clipboard API (ex.: http em alguns aparelhos).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <Button onClick={copy} className={className} size={size} aria-live="polite">
      {copied ? copiedLabel : label}
    </Button>
  );
}

/** Contador informativo baseado em expires_at do backend corrigido pelo relógio do servidor. */
export function Countdown({ expiresAt, serverOffsetMs, now }: { expiresAt: string; serverOffsetMs: number; now: number }) {
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - (now + serverOffsetMs)) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  return (
    <span className={`tabular-nums ${remaining <= 30 ? 'text-red-600' : ''}`} aria-label={`Tempo restante ${mm} minutos e ${ss} segundos`}>
      {mm}:{ss}
    </span>
  );
}

/** Campo de valor em BRL; devolve centavos inteiros (nunca float). */
export function MoneyInput({
  valueCents,
  onChange,
  id,
  autoFocus,
  ...aria
}: {
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const [text, setText] = useState(valueCents ? formatBRL(valueCents).replace('R$ ', '') : '');
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">R$</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="0,00"
        className="h-14 pl-10 text-2xl font-semibold tabular-nums"
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d,.]/g, '');
          setText(raw);
          try {
            const cents = parseBrlInputToCents(raw);
            onChange(cents > 0 ? cents : null);
          } catch {
            onChange(null);
          }
        }}
        {...aria}
      />
    </div>
  );
}

export function Money({ cents, className }: { cents: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className ?? ''}`}>{formatBRL(cents ?? null)}</span>;
}
