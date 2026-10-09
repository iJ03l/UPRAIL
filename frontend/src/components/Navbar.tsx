'use client';

import React, { useState } from 'react';
import { Link, useLocation } from '../lib/router';
import {
  Send,
  Gift,
  History,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { XUser } from '../types';
import { AuthModal } from './AuthModal';
import { GlitchLogo } from './GlitchLogo';

interface NavbarProps {
  user: XUser | null;
  onLogin: (handle?: string) => void;
  onLogout: () => void;
  shieldedTotalUsd?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogin,
  onLogout,
}) => {
  const location = useLocation();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const isActive = (path: string) => {
    if (path === '/app' && (location.pathname === '/app' || location.pathname === '/app/send')) return true;
    if (path !== '/app' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          {/* Brand Emblem */}
          <div className="flex items-center space-x-6 sm:space-x-8">
            <GlitchLogo href="/" size="md" badge="APP" />

            {/* Navigation links for App */}
            <nav className="flex items-center space-x-1.5">
              <Link
                to="/app"
                className={`px-3 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center space-x-1.5 ${
                  isActive('/app')
                    ? 'bg-black text-white shadow-sm'
                    : 'text-stone-600 hover:text-black hover:bg-stone-100'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </Link>

              <Link
                to="/app/claim"
                className={`px-3 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center space-x-1.5 ${
                  isActive('/app/claim') || location.pathname.startsWith('/claim')
                    ? 'bg-black text-white shadow-sm'
                    : 'text-stone-600 hover:text-black hover:bg-stone-100'
                }`}
              >
                <Gift className="w-3.5 h-3.5" />
                <span>Claim</span>
              </Link>

              <Link
                to="/app/history"
                className={`px-3 py-2 rounded-xl text-xs font-display font-bold transition-all flex items-center space-x-1.5 ${
                  isActive('/app/history') || location.pathname.startsWith('/history')
                    ? 'bg-black text-white shadow-sm'
                    : 'text-stone-600 hover:text-black hover:bg-stone-100'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>History</span>
              </Link>
            </nav>
          </div>

          {/* User Profile / Auth Area */}
          <div className="flex items-center space-x-3">
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center space-x-2.5 p-1.5 pr-3 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors"
                >
                  <img
                    src={user.avatarUrl || `https://unavatar.io/twitter/${user.handle}`}
                    alt={user.handle}
                    className="w-7 h-7 rounded-full object-cover border border-stone-300"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="text-xs font-bold text-stone-900 font-mono">
                    @{user.handle}
                  </span>
                  <ChevronDown className="w-3 h-3 text-stone-400" />
                </button>

                {/* Profile dropdown */}
                {showProfileMenu && (
                  <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-white border border-stone-200 shadow-xl py-1.5 z-50 animate-fade-in">
                    <div className="px-4 py-2 border-b border-stone-100">
                      <div className="text-xs font-bold text-stone-900">{user.name}</div>
                      <div className="text-[10px] font-mono text-stone-500">@{user.handle}</div>
                    </div>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        setShowSignOutConfirm(true);
                      }}
                      className="w-full text-left px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 flex items-center space-x-2 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Disconnect</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-4 py-2 rounded-xl bg-black text-white hover:bg-stone-800 text-xs font-display font-bold uppercase tracking-wider transition-colors shadow-sm flex items-center space-x-2 cursor-pointer"
              >
                <span>Sign In with 𝕏</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSelectHandle={(handle) => {
          onLogin(handle);
          setShowAuthModal(false);
        }}
      />

      {/* Sign Out Confirmation Modal */}
      {showSignOutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-white border border-stone-200 p-6 sm:p-7 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 mx-auto">
              <LogOut className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-stone-950 font-display">
                Sign Out?
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Are you sure you want to disconnect <span className="font-mono font-bold text-stone-900">@{user?.handle}</span>? You will need to authenticate again to access your confidential payments.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSignOutConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSignOutConfirm(false);
                  onLogout();
                }}
                className="flex-1 py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
