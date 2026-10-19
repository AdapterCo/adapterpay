'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { LogoLockup } from './brand';

/* eslint-disable @next/next/no-img-element */

/**
 * Moldura da placa AdapterPay — mesmo desenho do modelo impresso (placa.svg):
 * cartão branco com traço de recorte, lockup no topo, área do QR e ícone NFC no pé.
 * É usada na placa impressa, na página pública (/p e /c) e no hero da landing.
 */
export function PlateFrame({
  children,
  footer = true,
  className = '',
}: {
  children: ReactNode;
  footer?: boolean;
  className?: string;
}) {
  return (
    <div className={`plate-cut flex w-full flex-col items-center bg-white px-6 pb-7 pt-8 text-center ${className}`}>
      <LogoLockup className="h-20" />
      <div className="mt-6 flex w-full flex-col items-center">{children}</div>
      {footer && <img src="/brand/nfc.svg" alt="" aria-hidden="true" className="mt-6 h-14 w-auto" />}
    </div>
  );
}

/**
 * QR com o símbolo AdapterPay ao centro. Usa correção de erro alta (H, ~30%):
 * o símbolo ocupa bem menos que isso, mantendo a leitura pelo app do banco.
 */
export function PlateQr({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: 'H', margin: 0, width: size * 3, color: { dark: '#091f48', light: '#ffffff' } })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {src ? <img src={src} alt={label} width={size} height={size} className="block" /> : <div className="h-full w-full animate-pulse bg-slate-100" aria-hidden="true" />}
      <span
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-white"
        style={{ width: size * 0.22, height: size * 0.22 }}
        aria-hidden="true"
      >
        <img src="/brand/adapterpay-mark.svg" alt="" className="h-[78%] w-[78%] object-contain" />
      </span>
    </div>
  );
}
