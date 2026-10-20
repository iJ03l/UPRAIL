import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Payment Waiting',
  description:
    'A payment is waiting for you on UPRAIL. Open the link to receive it — sign in with X, then confirm with Face ID, fingerprint, or your PIN. No crypto wallet needed.',
  openGraph: {
    title: 'UPRAIL — Payment Waiting',
    description:
      'A payment is waiting for you on UPRAIL. Open the link to receive it — sign in with X, then confirm with Face ID, fingerprint, or your PIN. No crypto wallet needed.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-claim.png',
        width: 1200,
        height: 630,
        alt: 'Receive your payment on UPRAIL',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@uprailworld',
    creator: '@uprailworld',
    title: 'UPRAIL — Payment Waiting',
    description:
      'A payment is waiting for you on UPRAIL. Open the link to receive it — sign in with X, then confirm with Face ID, fingerprint, or your PIN. No crypto wallet needed.',
    images: ['https://app.uprail.world/og/og-claim.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
