'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { CriticalProvider } from '@/components/critical';
import { SessionProvider } from '@/lib/session';

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CriticalProvider>
        <AppShell>{children}</AppShell>
      </CriticalProvider>
    </SessionProvider>
  );
}
