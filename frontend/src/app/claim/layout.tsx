import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Payment Waiting',
  description:
    'A confidential payment is waiting on UPRAIL. Open the link to claim it with your device passkey.',
  openGraph: {
    title: 'UPRAIL — Payment Waiting',
    description:
      'A confidential payment is waiting on UPRAIL. Open the link to claim it with your device passkey.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-claim.png',
        width: 1200,
        height: 630,
        alt: 'Claim your payment on UPRAIL',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@uprailworld',
    creator: '@uprailworld',
    title: 'UPRAIL — Payment Waiting',
    description:
      'A confidential payment is waiting on UPRAIL. Open the link to claim it with your device passkey.',
    images: ['https://app.uprail.world/og/og-claim.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
