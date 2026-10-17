import type { Metadata } from 'next';
import './globals.css';
import { DomainGate } from '@/components/DomainGate';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  metadataBase: new URL('https://app.uprail.world'),
  title: 'UPRAIL — The Confidential Value Railway for X',
  description:
    'Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      {
        url: '/brand/uprail-favicon.png',
        type: 'image/png',
        sizes: '128x128',
      },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  openGraph: {
    title: 'UPRAIL — The Confidential Value Railway for X',
    description:
      'Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion.',
    url: 'https://app.uprail.world',
    siteName: 'UPRAIL',
    images: [
      {
        url: 'https://app.uprail.world/og/og-landing.png',
        width: 1200,
        height: 630,
        alt: 'UPRAIL — Confidential Value Railway for X',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UPRAIL — The Confidential Value Railway for X',
    description:
      'Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion.',
    site: '@Uptoberonnear',
    creator: '@Uptoberonnear',
    images: ['https://app.uprail.world/og/og-landing.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <meta name="theme-color" content="#FFFFFF" />
        {/* Apply the stored theme before first paint to avoid a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=localStorage.getItem('uprail_theme');m=(m==='light'||m==='dark'||m==='system')?m:'light';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d){e.classList.add('dark');}else{e.classList.remove('dark');}}catch(e){}})();",
          }}
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="UPRAIL" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/brand/uprail-favicon.png" />
        <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />

        {/* Primary Meta Tags for Social Previews */}
        <meta property="og:title" content="UPRAIL — The Confidential Value Railway for X" />
        <meta property="og:description" content="Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion." />
        <meta property="og:image" content="https://app.uprail.world/og/og-landing.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@Uptoberonnear" />
        <meta name="twitter:title" content="UPRAIL — The Confidential Value Railway for X" />
        <meta name="twitter:description" content="Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world — zero mempools, absolute discretion." />
        <meta name="twitter:image" content="https://app.uprail.world/og/og-landing.png" />

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
        <ThemeProvider>
          <DomainGate>{children}</DomainGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
