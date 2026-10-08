import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Send,
  Gift,
  History,
  ShieldCheck,
  ChevronDown,
  LogOut,
  UserCheck,
  Zap,
} from 'lucide-react';
import { XUser } from '../types';

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
  shieldedTotalUsd = 151.32,
}) => {
  const location = useLocation();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showDemoSwitcher, setShowDemoSwitcher] = useState(false);

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-dark-border bg-dark-bg/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-500 via-emerald-400 to-near-cyan flex items-center justify-center shadow-lg shadow-brand-500/25 group-hover:scale-105 transition-transform duration-200">
              <span className="font-mono font-extrabold text-dark-bg text-xl tracking-tight">UP</span>
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg tracking-tight text-white flex items-center">
                UPRAIL
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold bg-brand-500/10 text-brand-400 border border-brand-500/20 rounded-md">
                  BETA
                </span>
              </span>
              <span className="text-[10px] font-medium text-slate-400 -mt-1 hidden sm:inline">
                Confidential Payments for X
              </span>
            </div>
          </Link>

          {/* Navigation links */}
          <nav className="hidden md:flex items-center space-x-1 pl-4">
            <Link
              to="/"
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/')
                  ? 'bg-slate-800/80 text-white shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <Send className="w-4 h-4 text-brand-400" />
              <span>Send</span>
            </Link>
            <Link
              to="/claim"
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/claim')
                  ? 'bg-slate-800/80 text-white shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <Gift className="w-4 h-4 text-cyan-400" />
              <span>Claim</span>
            </Link>
            <Link
              to="/history"
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/history')
                  ? 'bg-slate-800/80 text-white shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <History className="w-4 h-4 text-slate-400" />
              <span>Activity</span>
            </Link>
          </nav>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center space-x-3">
          {/* NEAR Intent Protocol badge */}
          <div className="hidden lg:flex items-center space-x-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>NEAR Confidential Intents</span>
          </div>

          {/* Shielded Balance Pill */}
          <Link
            to="/claim"
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-500/20 text-xs sm:text-sm font-medium text-emerald-300 transition-colors"
            title="Your device passkey protected confidential balance"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>${shieldedTotalUsd.toFixed(2)}</span>
            <span className="text-[11px] text-emerald-500/80 hidden sm:inline">Shielded</span>
          </Link>

          {/* User Session */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-dark-card hover:bg-dark-cardHover border border-dark-border transition-all"
              >
                <img
                  src={user.avatarUrl}
                  alt={user.handle}
                  className="w-6 h-6 rounded-full object-cover border border-slate-700"
                />
                <span className="text-sm font-medium text-slate-200">@{user.handle}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* Profile Dropdown */}
              {showProfileMenu && (
                <div
                  className="absolute right-0 mt-2 w-56 rounded-xl bg-dark-card border border-dark-border shadow-2xl py-2 z-50 animate-fade-in"
                  onMouseLeave={() => setShowProfileMenu(false)}
                >
                  <div className="px-4 py-2 border-b border-dark-border/60">
                    <p className="text-xs text-slate-400">Signed in to X as</p>
                    <p className="text-sm font-semibold text-white">@{user.handle}</p>
                    <div className="mt-1 flex items-center text-[11px] text-brand-400">
                      <Zap className="w-3 h-3 mr-1" />
                      Passkey Linked
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      setShowDemoSwitcher(true);
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800/60 flex items-center space-x-2"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>Switch Demo Account</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-950/30 flex items-center space-x-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => onLogin()}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-white text-dark-bg font-semibold text-xs sm:text-sm hover:bg-slate-200 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>Sign in with X</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation bottom bar */}
      <div className="md:hidden flex items-center justify-around border-t border-dark-border bg-dark-bg/95 py-2">
        <Link
          to="/"
          className={`flex flex-col items-center text-xs py-1 px-4 ${
            isActive('/') ? 'text-brand-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Send className="w-5 h-5 mb-1" />
          <span>Send</span>
        </Link>
        <Link
          to="/claim"
          className={`flex flex-col items-center text-xs py-1 px-4 ${
            isActive('/claim') ? 'text-cyan-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Gift className="w-5 h-5 mb-1" />
          <span>Claim</span>
        </Link>
        <Link
          to="/history"
          className={`flex flex-col items-center text-xs py-1 px-4 ${
            isActive('/history') ? 'text-brand-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <History className="w-5 h-5 mb-1" />
          <span>Activity</span>
        </Link>
      </div>

      {/* Demo Account Switcher Modal */}
      {showDemoSwitcher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-dark-card border border-dark-border p-6 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-white mb-2">Switch Demo X Account</h3>
            <p className="text-xs text-slate-400 mb-4">
              Switch handles to test sending payments from one user and claiming them as the recipient.
            </p>
            <div className="space-y-2">
              {['cryptowhale', 'alice', 'bob_builder', 'satoshi', 'vitalik'].map((demo) => (
                <button
                  key={demo}
                  onClick={() => {
                    onLogin(demo);
                    setShowDemoSwitcher(false);
                  }}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border flex items-center justify-between transition-colors ${
                    user?.handle === demo
                      ? 'bg-brand-500/10 border-brand-500/40 text-brand-300'
                      : 'bg-dark-surface hover:bg-slate-800 border-dark-border text-slate-300'
                  }`}
                >
                  <span className="text-sm font-medium">@{demo}</span>
                  {user?.handle === demo && (
                    <span className="text-xs font-semibold text-brand-400">Active</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowDemoSwitcher(false)}
              className="mt-4 w-full py-2 text-xs font-medium text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
