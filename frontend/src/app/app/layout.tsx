import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'UPRAIL — Confidential Value Railway',
  description: 'Manage your confidential intent account. View balances, send payments, and receive from any chain.',
  openGraph: {
    title: 'UPRAIL — Confidential Value Railway',
    description: 'Manage your confidential intent account. View balances, send payments, and receive from any chain.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-app.png',
        width: 1200,
        height: 630,
        alt: 'UPRAIL dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UPRAIL — Confidential Value Railway',
    description: 'Manage your confidential intent account. View balances, send payments, and receive from any chain.',
    images: ['https://app.uprail.world/og/og-app.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
