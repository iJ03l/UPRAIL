'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';

type GateMode = 'render' | 'redirect' | 'forbidden';

/**
 * Strictly forbidden screen shown whenever an /app route is accessed directly
 * on the apex uprail.world domain.
 */
const ForbiddenOnApex: React.FC = () => (
  <div className="min-h-screen bg-stone-950 text-white flex flex-col items-center justify-center p-6 text-center select-none font-sans">
    <div className="max-w-md w-full bg-stone-900 border border-stone-800 rounded-3xl p-8 sm:p-10 shadow-2xl space-y-6">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider">
        <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
        <span>403 Forbidden</span>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-white">
          Application Restricted
        </h1>
        <p className="text-xs sm:text-sm text-stone-400 font-sans leading-relaxed">
          The application is strictly forbidden on{' '}
          <strong className="text-stone-200">uprail.world</strong> and is only accessible on the
          dedicated secure subdomain:
        </p>
      </div>

      <div className="p-3 bg-black/60 border border-stone-800 rounded-2xl font-mono text-xs sm:text-sm text-[#E05326] font-bold">
        https://app.uprail.world
      </div>

      <div className="pt-2">
        <a
          href="https://app.uprail.world"
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-white hover:bg-stone-200 text-black font-display font-bold text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
        >
          <span>Launch app.uprail.world</span>
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  </div>
);

/**
 * Domain gate that reproduces the routing rules mirrored from the worker
 * (`worker/src/index.ts`):
 *
 * - apex uprail.world: `/` renders, every other path redirects to
 *   https://app.uprail.world, and `/app*` renders the 403 screen.
 * - any other host: render normally.
 *
 * Runs after mount so server-rendered HTML always matches the first client
 * render (static export has no server-side request context).
 */
export const DomainGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<GateMode | null>(null);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    const isApex = host === 'uprail.world' || host === 'www.uprail.world';
    const { pathname, search } = window.location;

    if (!isApex) {
      setMode('render');
      return;
    }

    if (pathname === '/' || pathname === '') {
      setMode('render');
      return;
    }

    if (pathname.startsWith('/app')) {
      setMode('forbidden');
      return;
    }

    window.location.href = `https://app.uprail.world${pathname}${search}`;
    setMode('redirect');
  }, []);

  if (mode === 'forbidden') return <ForbiddenOnApex />;
  if (mode === 'redirect') return null;
  if (mode === null) {
    // Server render and first client paint: identical output on both sides.
    return <>{children}</>;
  }
  return <>{children}</>;
};
