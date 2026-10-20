'use client';

import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  detectInAppBrowser,
  inAppBrowserLabel,
  openInSystemBrowser,
  type InAppBrowserInfo,
} from '../lib/inAppBrowser';

/**
 * Warns the user when the page is running inside an app's embedded webview
 * (X, Telegram, Instagram…), where passkey sign-in is unavailable, and offers a
 * one-tap escape into the real browser. Renders nothing in a normal browser.
 */
export const InAppBrowserNotice: React.FC<{ className?: string }> = ({ className }) => {
  const [info, setInfo] = useState<InAppBrowserInfo | null>(null);

  // Detect after mount so the statically-exported HTML has no user-agent
  // dependent markup (avoids hydration mismatches).
  useEffect(() => {
    setInfo(detectInAppBrowser());
  }, []);

  if (!info?.isInApp) return null;

  return (
    <div
      className={`p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs font-mono animate-fade-in ${
        className || ''
      }`}
    >
      <ExternalLink className="w-4 h-4 text-amber-700 flex-shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="font-bold text-amber-900">Passkey sign-in doesn&apos;t work in-app</div>
        <div className="text-amber-800 leading-relaxed">
          You&apos;re in {inAppBrowserLabel(info)}. To use your passkey (Face ID or fingerprint), open this
          page in your phone&apos;s browser first.
        </div>
      </div>
      <button
        type="button"
        onClick={() => openInSystemBrowser()}
        className="flex-shrink-0 py-2 px-3.5 rounded-xl bg-amber-900 hover:bg-amber-800 text-white font-display font-bold text-[11px] uppercase tracking-wider transition-colors cursor-pointer"
      >
        Open in browser
      </button>
    </div>
  );
};
