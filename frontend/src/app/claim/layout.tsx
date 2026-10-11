import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Payment Waiting',
  description: 'A confidential payment is waiting for you. Claim it instantly with your device passkey.',
  openGraph: {
    title: 'UPRAIL — Payment Waiting',
    description: 'A confidential payment is waiting for you. Claim it instantly with your device passkey.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-refer.png',
        width: 1200,
        height: 630,
        alt: 'Payment waiting',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UPRAIL — Payment Waiting',
    description: 'A confidential payment is waiting for you. Claim it instantly with your device passkey.',
    images: ['https://app.uprail.world/og/og-refer.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
