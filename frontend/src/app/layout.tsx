import type { Metadata } from 'next';
import './globals.css';
import { DomainGate } from '@/components/DomainGate';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/Toast';
import { NativeL1AuthHost } from '@/components/NativeL1AuthHost';

export const metadata: Metadata = {
  metadataBase: new URL('https://app.uprail.world'),
  title: 'UPRAIL — The Confidential Value Railway for X',
  description:
    'Send payments to any X handle. The handle is not recorded on-chain, and payments go to an Uprail sub-account, not your personal wallet. Claim instantly with passkeys on app.uprail.world.',
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
      'Send payments to any X handle. The handle is not recorded on-chain, and payments go to an Uprail sub-account, not your personal wallet. Claim instantly with passkeys on app.uprail.world.',
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
      'Send payments to any X handle. The handle is not recorded on-chain, and payments go to an Uprail sub-account, not your personal wallet. Claim instantly with passkeys on app.uprail.world.',
    site: '@uprailworld',
    creator: '@uprailworld',
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
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#F7F5F0" />
        {/* Apply the stored theme (or OS preference on first visit) before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=localStorage.getItem('uprail_theme');m=(m==='light'||m==='dark'||m==='system')?m:'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d){e.classList.add('dark');}else{e.classList.remove('dark');}var mc=document.querySelector('meta[name=\"theme-color\"]');if(mc)mc.setAttribute('content',d?'#1B1C1E':'#F7F5F0');}catch(e){}})();",
          }}
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="UPRAIL" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/brand/uprail-favicon.png" />
        <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />

        {/* Social preview tags come from the `metadata` export above so per-route
            layouts (claim, send, receive, docs) can override them. Hardcoding
            them here emitted a second, conflicting set on every page and made
            crawlers pick the generic landing card. */}

        {/* Bespoke Fonts: Bricolage Grotesque (tall display), Cabinet Grotesk / Space Grotesk & JetBrains Mono */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface text-stone-900 min-h-screen selection:bg-black selection:text-white antialiased overflow-x-hidden">
        <ThemeProvider>
          <ToastProvider>
            <DomainGate>{children}</DomainGate>
            <NativeL1AuthHost />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
