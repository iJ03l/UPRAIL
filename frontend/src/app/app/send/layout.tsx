import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UPRAIL — Send Confidentially',
  description: 'Send confidential payments to any X handle on NEAR Confidential Intents or to any external wallet.',
  openGraph: {
    title: 'UPRAIL — Send Confidentially',
    description: 'Send confidential payments to any X handle on NEAR Confidential Intents or to any external wallet.',
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
    description: 'Send confidential payments to any X handle on NEAR Confidential Intents or to any external wallet.',
    images: ['https://app.uprail.world/og/og-send.png'],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
