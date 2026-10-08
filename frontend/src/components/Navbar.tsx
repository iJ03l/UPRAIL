import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Send,
  Gift,
  History,
  ShieldCheck,
  ChevronDown,
  LogOut,
  Fingerprint,
  ExternalLink,
} from 'lucide-react';
import { XUser } from '../types';
import { AuthModal } from './AuthModal';

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
  const [showAuthModal, setShowAuthModal] = useState(false);

  const isActive = (path: string) => {
    if (path === '/app' && (location.pathname === '/app' || location.pathname === '/app/send')) return true;
    if (path !== '/app' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-[#2C221D] bg-[#0A0807]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          {/* Brand Emblem */}
          <div className="flex items-center space-x-8">
            <Link to="/" className="flex items-center space-x-3 group">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#E05326] via-[#FF6B35] to-[#FFFFFF] p-[1.5px] shadow-lg shadow-[#E05326]/25 group-hover:scale-105 transition-transform duration-200">
                <div className="w-full h-full bg-[#0A0807] rounded-2xl flex items-center justify-center">
                  <span className="font-display font-black text-white text-lg tracking-tight">UP</span>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="font-display font-extrabold text-lg tracking-tight text-white flex items-center">
                  UPRAIL
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E05326]/15 text-[#E05326] border border-[#E05326]/30 rounded">
                    APP
                  </span>
                </span>
                <span className="text-[10px] font-sans text-[#A69C95] -mt-0.5 hidden sm:inline">
                  app.uprail.world
                </span>
              </div>
            </Link>

            {/* Navigation links for App */}
            <nav className="hidden md:flex items-center space-x-1">
              <Link
                to="/app"
                className={`px-3.5 py-2 rounded-xl text-xs font-display font-semibold transition-all flex items-center space-x-2 ${
                  isActive('/app')
                    ? 'bg-[#E05326]/15 text-white border border-[#E05326]/40 shadow-[0_0_15px_rgba(224,83,38,0.2)]'
                    : 'text-[#A69C95] hover:text-white hover:bg-[#181310]'
                }`}
              >
                <Send className="w-3.5 h-3.5 text-[#E05326]" />
                <span>Send Payment</span>
              </Link>

              <Link
                to="/app/claim"
                className={`px-3.5 py-2 rounded-xl text-xs font-display font-semibold transition-all flex items-center space-x-2 ${
                  isActive('/app/claim') || location.pathname.startsWith('/claim')
                    ? 'bg-[#E05326]/15 text-white border border-[#E05326]/40 shadow-[0_0_15px_rgba(224,83,38,0.2)]'
                    : 'text-[#A69C95] hover:text-white hover:bg-[#181310]'
                }`}
              >
                <Gift className="w-3.5 h-3.5 text-[#E05326]" />
                <span>Claim Intent</span>
              </Link>

              <Link
                to="/app/history"
                className={`px-3.5 py-2 rounded-xl text-xs font-display font-semibold transition-all flex items-center space-x-2 ${
                  isActive('/app/history') || location.pathname.startsWith('/history')
                    ? 'bg-[#E05326]/15 text-white border border-[#E05326]/40 shadow-[0_0_15px_rgba(224,83,38,0.2)]'
                    : 'text-[#A69C95] hover:text-white hover:bg-[#181310]'
                }`}
              >
                <History className="w-3.5 h-3.5 text-[#E05326]" />
                <span>Escrow History</span>
              </Link>
            </nav>
          </div>

          {/* Right Area: Shielded Balance & Dual Auth State */}
          <div className="flex items-center space-x-4">
            {/* Shielded Balance Pill */}
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#140F0D] border border-[#2C221D]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#E05326]" />
              <div className="flex flex-col text-right">
                <span className="text-[9px] font-mono uppercase text-[#8A7E76]">Shielded Vault</span>
                <span className="text-xs font-mono font-bold text-white leading-none">
                  ${shieldedTotalUsd.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Back to landing link */}
            <Link
              to="/"
              className="text-xs font-mono text-[#A69C95] hover:text-white transition-colors hidden lg:flex items-center space-x-1"
            >
              <span>uprail.world</span>
              <ExternalLink className="w-3 h-3" />
            </Link>

            {/* Dual Auth Trigger (Passkey / X) */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-[#181310] border border-[#2C221D] hover:border-[#E05326]/50 transition-all text-xs font-mono text-white"
                >
                  <img
                    src={user.avatarUrl}
                    alt={user.handle}
                    className="w-6 h-6 rounded-full border border-[#E05326]/50 object-cover"
                  />
                  <span className="font-bold">@{user.handle}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {showProfileMenu && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-[#140F0D] border border-[#2C221D] shadow-[0_15px_40px_rgba(0,0,0,0.8)] py-2 z-50">
                    <div className="px-4 py-2 border-b border-[#2C221D]">
                      <div className="text-xs font-bold text-white">{user.name}</div>
                      <div className="text-[11px] font-mono text-[#E05326]">@{user.handle}</div>
                      <div className="text-[10px] font-mono text-[#8A7E76] mt-1 flex items-center">
                        <Fingerprint className="w-3 h-3 mr-1 text-emerald-400" />
                        <span>Passkey Linked</span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        onLogout();
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-[#221B17] transition-colors flex items-center space-x-2"
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
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#E05326] to-[#FF6B35] text-white font-display font-bold text-xs uppercase tracking-wide hover:shadow-[0_0_25px_rgba(224,83,38,0.5)] transition-all flex items-center space-x-2"
              >
                <Fingerprint className="w-3.5 h-3.5" />
                <span>Connect (Passkey / 𝕏)</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Dual Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => onLogin('alice')}
      />
    </>
  );
};
