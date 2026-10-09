import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UPRAIL — The Confidential Value Railway for X',
  description: 'Non-custodial, confidential payments to any 𝕏 handle & wallet powered by NEAR Intents and hardware Passkeys.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none'><rect width='32' height='32' rx='8' fill='%23000000'/><path d='M8 20V12a4 4 0 0 1 8 0v8M16 12a4 4 0 0 1 8 0v8' stroke='%23FFFFFF' stroke-width='2.75' stroke-linecap='round'/><circle cx='20' cy='20' r='1.5' fill='%23FFFFFF'/></svg>",
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
