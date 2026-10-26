import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Send Confidentially',
  description: 'Send payments to any X handle or external wallet. The handle is not recorded on-chain.',
  openGraph: {
    title: 'UPRAIL — Send Confidentially',
    description: 'Send payments to any X handle or external wallet. The handle is not recorded on-chain.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-send.png',
        width: 1200,
        height: 630,
        alt: 'Send confidential payment',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@uprailworld',
    creator: '@uprailworld',
    title: 'UPRAIL — Send Confidentially',
    description: 'Send payments to any X handle or external wallet. The handle is not recorded on-chain.',
    images: ['https://app.uprail.world/og/og-send.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
