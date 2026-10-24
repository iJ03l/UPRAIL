'use client';

import React, { useState } from 'react';
import { Link } from '../lib/router';
import { Bot } from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { SettingsSidebar } from './SettingsSidebar';
import { QuantusInteractiveCanvas } from './QuantusInteractiveCanvas';
import { InviteGateModal } from './InviteGateModal';
import { GlitchLogo } from './GlitchLogo';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user, refreshSession } = useXAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface text-stone-900 flex flex-col font-sans selection:bg-black selection:text-white relative">
      {/* Quantus Background Canvas (Fullscreen on dashboard/app) */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* 
        Clean, properly placed top header (no bloated navbar)
        Mobile & Desktop optimized
      */}
      <header className="sticky top-0 z-30 w-full bg-surface-glass backdrop-blur-md border-b border-stone-100">
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-[72px] flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Brand with Cinematic Glitch — icon-only on mobile, full wordmark on sm+ */}
          <GlitchLogo href="/app" size="md" hideWordmarkOnMobile className="flex-shrink-0" />

          {/* Center: live protocol status — compact on mobile, full label on desktop */}
          <div
            className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-stone-50/80 border border-stone-200/80 text-[10px] sm:text-[11px] font-mono text-stone-600 flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-none"
            title="NEAR Intents is live"
          >
            <span className="intents-pulse" aria-hidden="true">
              <svg width="30" height="14" viewBox="0 0 30 14" fill="none">
                <path
                  d="M0 8h5l2-3 2 6 3-10 2 9 2-4h12"
                  stroke="currentColor"
                  strokeOpacity="0.22"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="intents-ecg-trace"
                  d="M0 8h5l2-3 2 6 3-10 2 9 2-4h12"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength="100"
                />
              </svg>
            </span>
            <span className="hidden sm:inline tracking-tight">NEAR Intents Active</span>
            <span className="sm:hidden tracking-tight">Intents</span>
          </div>

          {/* Right: User Pill / Sign In + AI Chat + Settings */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0 min-w-0">
            {user ? (
              <>
                {/* AI Chat Payments Link */}
                <Link
                  to="/app/agents"
                  className="flex items-center justify-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors cursor-pointer text-xs font-mono font-bold text-stone-900 group flex-shrink-0"
                  title="Send & receive payments in ChatGPT, Claude & Cursor"
                >
                  <Bot className="w-4 h-4 text-stone-700 group-hover:text-black flex-shrink-0" />
                  <span className="hidden md:inline">AI Chat</span>
                </Link>

                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex items-center gap-2 h-9 sm:h-10 px-2 sm:px-3 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors cursor-pointer group flex-shrink-0 min-w-0"
                  title="Account Settings"
                  aria-label={`Account settings for @${user.handle}`}
                >
                  <img
                    src={user.avatarUrl || `https://unavatar.io/twitter/${user.handle}`}
                    alt={user.handle}
                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-stone-300 flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="hidden sm:inline text-xs font-bold font-mono text-stone-900 group-hover:text-black transition-colors max-w-[150px] truncate">
                    @{user.handle}
                  </span>
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="h-9 sm:h-10 px-3.5 sm:px-4 inline-flex items-center rounded-full bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors shadow-xs flex-shrink-0"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-12 md:py-14 flex-1">
        {children}
      </main>

      {/* Slim footer credit */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 pt-2 pb-8 flex flex-col sm:flex-row items-center justify-center gap-2 text-[11px] font-mono text-stone-400 text-center">
        <span>
          Built by{' '}
          <a
            href="https://x.com/xy63ry0rx"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-stone-700 hover:text-black transition-colors"
          >
            @5194
          </a>{' '}
          · for{' '}
          <a
            href="https://x.com/uprailworld"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-stone-700 hover:text-black transition-colors"
          >
            UP
          </a>
        </span>
        <span className="hidden sm:inline text-stone-300">—</span>
        <span>crypto payments, not promises · private by default</span>
      </footer>

      {/* Slide-over Settings Sidebar */}
      <SettingsSidebar
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Invite Gatekeeper Modal for First-time unactivated users */}
      {user && user.isActivated === false && (
        <InviteGateModal
          isOpen={true}
          onActivated={refreshSession}
          userHandle={user.handle}
        />
      )}
    </div>
  );
};
