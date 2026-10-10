import type { Metadata } from 'next';
import './globals.css';
import { DomainGate } from '@/components/DomainGate';

export const metadata: Metadata = {
  title: 'UPRAIL — The Confidential Value Railway for X',
  description:
    'Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion.',
  icons: {
    icon: '/brand/uprail-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <meta name="theme-color" content="#000000" />

        {/* Rare Bespoke Fonts: Clash Display, Cabinet Grotesk, Syne & JetBrains Mono */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@300,400,500,600,700&f[]=cabinet-grotesk@400,500,700,800,900&f[]=syne@600,700,800,900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-stone-900 min-h-screen selection:bg-black selection:text-white antialiased overflow-x-hidden">
        <DomainGate>{children}</DomainGate>
      </body>
    </html>
  );
}
