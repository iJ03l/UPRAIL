import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UPRAIL — The Confidential Value Railway for X',
  description: 'Non-custodial, confidential payments to any 𝕏 handle & wallet powered by NEAR Intents and hardware Passkeys.',
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body>{children}</body>
    </html>
  );
}
