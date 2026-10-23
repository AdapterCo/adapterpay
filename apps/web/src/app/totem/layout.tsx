import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Totem',
  robots: { index: false, follow: false },
};

// Quiosque: sem zoom por pinça (o layout já é grande o bastante para toque).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#091f48',
};

export default function TotemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
