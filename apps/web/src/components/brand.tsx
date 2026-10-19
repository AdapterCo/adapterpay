import Link from 'next/link';

export const SLOGAN = 'Seu negócio recebe. Você acompanha.';
export const SIGNATURE = 'Uma plataforma da Adapter Co.';

/* eslint-disable @next/next/no-img-element */

/** Símbolo (A + módulos de QR). */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/brand/adapterpay-mark.svg" alt="" aria-hidden="true" className={`${className} object-contain`} />;
}

/** Símbolo + wordmark na horizontal, para cabeçalhos. */
export function Logo({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 ${className}`} aria-label="AdapterPay — início">
      <LogoMark className="h-8 w-8" />
      <img src="/brand/adapterpay-wordmark.svg" alt="AdapterPay" className="h-5 w-auto" />
    </Link>
  );
}

/** Lockup vertical original (símbolo sobre wordmark), como na placa. */
export function LogoLockup({ className = 'h-24' }: { className?: string }) {
  return <img src="/brand/adapterpay-logo.svg" alt="AdapterPay" className={`${className} w-auto`} />;
}

export function BrandSignature({ className = '' }: { className?: string }) {
  return <p className={`text-xs text-slate-500 ${className}`}>{SIGNATURE}</p>;
}
