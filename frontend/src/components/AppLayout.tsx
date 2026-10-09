'use client';

import React, { useState } from 'react';
import { Link } from '../lib/router';
import { Settings, Users } from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { SettingsSidebar } from './SettingsSidebar';
import { QuantusInteractiveCanvas } from './QuantusInteractiveCanvas';
import { InviteGateModal } from './InviteGateModal';
import { InviteModal } from './InviteModal';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user, refreshSession } = useXAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-stone-900 flex flex-col font-sans selection:bg-black selection:text-white relative">
      {/* Quantus Background Canvas (Fullscreen on dashboard/app) */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* 
        Clean, properly placed top header (no bloated navbar)
        Mobile & Desktop optimized
      */}
      <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-stone-100">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Brand */}
          <Link to="/app" className="flex items-center space-x-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-black flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform duration-200">
              <span className="font-display font-black text-white text-xs tracking-tight">UP</span>
            </div>
            <span className="font-display font-extrabold text-base tracking-tight text-stone-950">
              UPRAIL
            </span>
          </Link>

          {/* Center: Subtle Protocol Status (Desktop) */}
          <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-stone-50 border border-stone-200 text-[10px] font-mono text-stone-600">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
            <span>NEAR Intents Active</span>
          </div>

          {/* Right: User Pill / Sign In + Invites + Settings */}
          <div className="flex items-center space-x-2">
            {user ? (
              <>
                {/* Invite Button Badge */}
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors cursor-pointer text-xs font-mono font-bold text-stone-900 group"
                  title="View & Share your 1 Personal Invite Code"
                >
                  <Users className="w-3.5 h-3.5 text-stone-700 group-hover:text-black" />
                  <span>Invite</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors cursor-pointer group"
                  title="Account Settings"
                >
                  <img
                    src={user.avatarUrl || `https://unavatar.io/twitter/${user.handle}`}
                    alt={user.handle}
                    className="w-4 h-4 rounded-full border border-stone-300"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="text-xs font-bold font-mono text-stone-900 group-hover:text-black transition-colors">
                    @{user.handle}
                  </span>
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-3.5 py-1.5 rounded-full bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors shadow-xs"
              >
                Sign In
              </Link>
            )}

            {/* Settings Sidebar Toggle */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl text-stone-500 hover:text-black hover:bg-stone-100 border border-stone-200 transition-colors cursor-pointer"
              aria-label="Settings"
              title="Open Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 py-8 sm:py-12 md:py-14 flex-1">
        {children}
      </main>

      {/* Slide-over Settings Sidebar */}
      <SettingsSidebar
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Invite Modal */}
      <InviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        userHandle={user?.handle}
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
