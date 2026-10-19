import Link from 'next/link';

export const SLOGAN = 'Seu negócio recebe. Você acompanha.';
export const SIGNATURE = 'Uma plataforma da Adapter Co.';

export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0e8468" />
      <path d="M9 22.5 15 9h2l6 13.5h-3.1l-1.3-3.1h-5.2l-1.3 3.1H9Zm5.4-5.7h3.2L16 12.9l-1.6 3.9Z" fill="#fff" />
      <circle cx="24.5" cy="9.5" r="2.5" fill="#aeead4" />
    </svg>
  );
}

export function Logo({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 ${className}`} aria-label="AdapterPay — início">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight text-ink">
        Adapter<span className="text-brand-600">Pay</span>
      </span>
    </Link>
  );
}

export function BrandSignature({ className = '' }: { className?: string }) {
  return <p className={`text-xs text-slate-500 ${className}`}>{SIGNATURE}</p>;
}
