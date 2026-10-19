'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/** Diálogo modal acessível (foco preso, ESC fecha, aria-labelledby/aria-describedby). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <RadixDialog.Title className="text-lg font-semibold text-ink">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-slate-500">{description}</RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
          <RadixDialog.Close
            className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
