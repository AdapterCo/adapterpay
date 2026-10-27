/**
 * Botão "Avaliar no Google" das páginas públicas (balcão, link e mesa). Fica visível o tempo todo,
 * em qualquer estado da cobrança. O totem não usa este botão.
 */
export function GoogleReviewButton({ url, tradeName, className = '' }: { url: string | null; tradeName: string; className?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-base font-semibold text-ink shadow-sm ring-1 ring-line hover:ring-brand-600 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-amber-500" fill="currentColor" aria-hidden="true">
        <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
      </svg>
      Avaliar {tradeName} no Google
    </a>
  );
}
