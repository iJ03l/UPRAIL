import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Deposit from Any Chain',
  description: 'Deposit funds from any chain. Get your unified deposit address for NEAR, Ethereum, Solana, and more.',
  openGraph: {
    title: 'UPRAIL — Deposit from Any Chain',
    description: 'Deposit funds from any chain. Get your unified deposit address for NEAR, Ethereum, Solana, and more.',
    images: [
      {
        url: 'https://app.uprail.world/og/og-receive.png',
        width: 1200,
        height: 630,
        alt: 'Deposit from any chain',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@uprailworld',
    creator: '@uprailworld',
    title: 'UPRAIL — Deposit from Any Chain',
    description: 'Deposit funds from any chain. Get your unified deposit address for NEAR, Ethereum, Solana, and more.',
    images: ['https://app.uprail.world/og/og-receive.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
