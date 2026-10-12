'use client';

import React from 'react';
import { Link } from '../lib/router';
import { ArrowLeft } from 'lucide-react';

/**
 * Page back navigation shown at the top of every inner page (Send, Receive,
 * History, Claim). The old layout was: tiny inline back link + big centered
 * page title. The title is gone, so the back button now owns that space:
 *
 * - Desktop (sm+): a wide bar spanning the content column.
 * - Mobile: a round floating button pinned right under the sticky navbar,
 *   with a small spacer so page content never sits beneath it.
 *
 * Navigation is a client-side router Link, so it responds instantly regardless
 * of the user's network.
 */
export const BackBar: React.FC<{
  to?: string;
  label?: string;
}> = ({ to = '/app', label = 'Back to Dashboard' }) => {
  return (
    <>
      {/* Mobile: breathing room for the floating button */}
      <div className="h-10 sm:hidden" aria-hidden="true" />

      {/* Mobile: round floating back button under the navbar */}
      <Link
        to={to}
        aria-label={label}
        className="sm:hidden fixed left-4 top-[4.75rem] z-40 w-11 h-11 rounded-full bg-black text-white shadow-lg border border-stone-900 flex items-center justify-center transition-transform active:scale-95"
      >
        <ArrowLeft className="w-5 h-5" />
      </Link>

      {/* Desktop: wide back bar occupying the former header space */}
      <Link
        to={to}
        className="hidden sm:flex w-full items-center space-x-2.5 px-5 py-4 rounded-2xl bg-stone-50 hover:bg-stone-100 border border-stone-200 hover:border-stone-950 transition-colors active:scale-[0.99]"
      >
        <ArrowLeft className="w-4 h-4 text-stone-700" />
        <span className="text-sm font-mono font-bold text-stone-900">{label}</span>
        <span className="ml-auto text-[11px] font-mono text-stone-400">
          {to === '/app' ? 'Dashboard' : to}
        </span>
      </Link>
    </>
  );
};
