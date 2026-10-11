import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Receive from Any Chain',
  description: 'Receive confidential payments from any chain. Get your unified receive address for NEAR, Ethereum, Solana, and more.',
  openGraph: {
    title: 'UPRAIL — Receive from Any Chain',
    description: 'Receive confidential payments from any chain. Get your unified receive address for NEAR, Ethereum, Solana, and more.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-receive.png',
        width: 1200,
        height: 630,
        alt: 'Receive from any chain',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UPRAIL — Receive from Any Chain',
    description: 'Receive confidential payments from any chain. Get your unified receive address for NEAR, Ethereum, Solana, and more.',
    images: ['https://app.uprail.world/og/og-receive.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
