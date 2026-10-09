'use client';

import React, { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, ArrowRight, Sparkles, Shield, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

interface InviteGateModalProps {
  isOpen: boolean;
  onActivated: () => void;
  userHandle?: string;
}

export const InviteGateModal: React.FC<InviteGateModalProps> = ({
  isOpen,
  onActivated,
  userHandle,
}) => {
  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    personalInviteCode: string;
    message: string;
  } | null>(null);

  // Auto-detect invite code from URL query parameters (e.g. ?invite=UPRAIL)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlInvite = params.get('invite');
      if (urlInvite) {
        const cleaned = urlInvite.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
        if (cleaned.length === 6) {
          setCode(cleaned);
        }
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    setCode(sanitized);
    setError(null);
  };

  const handleRedeem = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (code.length !== 6) {
      setError('Invite code must be exactly 6 capital letters (e.g. UPRAIL)');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // 1. Validate format and availability
      const val = await api.validateInvite(code);
      if (!val.valid) {
        setError(val.reason || 'Invalid or already claimed invite code');
        setIsValidating(false);
        return;
      }

      // 2. Redeem and activate account
      const res = await api.redeemInvite(code);
      setSuccessData({
        personalInviteCode: res.personalInviteCode,
        message: res.message || 'Account successfully activated!',
      });

      // Notify parent to refresh user profile
      setTimeout(() => {
        onActivated();
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to redeem invite code');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in font-sans">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Success View */}
        {successData ? (
          <div className="text-center space-y-5 animate-fade-in">
            <div className="w-16 h-16 rounded-3xl bg-stone-100 border border-stone-200 text-stone-900 flex items-center justify-center mx-auto shadow-sm">
              <Sparkles className="w-8 h-8 text-stone-950" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-2xl font-black font-display text-stone-950 tracking-tight">
                Welcome to UPRAIL!
              </h2>
              <p className="text-xs text-stone-600 font-mono">
                {userHandle ? `@${userHandle}` : 'Your account'} is now fully activated.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-2">
              <div className="text-[11px] font-mono text-stone-500 uppercase tracking-wider font-bold">
                Your 1 Personal Invite Code to Share
              </div>
              <div className="text-2xl font-mono font-black tracking-widest text-stone-950 bg-white py-2 px-4 rounded-xl border border-stone-200 inline-block shadow-xs">
                {successData.personalInviteCode}
              </div>
              <p className="text-[11px] text-stone-500">
                You have exactly 1 invite code to invite a friend. You will see who uses it in your Settings.
              </p>
            </div>

            <div className="text-xs text-stone-400 font-mono animate-pulse">
              Entering the app...
            </div>
          </div>
        ) : (
          /* Input View */
          <form onSubmit={handleRedeem} className="space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-xs">
                <KeyRound className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono text-stone-600 font-bold uppercase tracking-wider mb-1">
                  <Shield className="w-3 h-3 text-stone-900" />
                  <span>Private Access Gate</span>
                </div>
                <h2 className="text-2xl font-black font-display text-stone-950 tracking-tight">
                  Enter Invite Code
                </h2>
                <p className="text-xs text-stone-600 max-w-xs mx-auto">
                  Every first-time user must enter a 6 capital letter invite code to activate their UPRAIL account.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2 animate-fade-in font-mono">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-600 block text-center">
                6-Letter Invite Code
              </label>

              {/* 6 Letter Capitalized Code Input */}
              <div className="relative">
                <input
                  type="text"
                  value={code}
                  onChange={handleCodeChange}
                  maxLength={6}
                  autoFocus
                  placeholder="UPRAIL"
                  className="w-full text-center text-2xl font-mono font-black tracking-[0.35em] uppercase py-3.5 px-4 rounded-2xl bg-stone-50 border border-stone-300 text-stone-950 placeholder-stone-300 focus:outline-none focus:border-black focus:bg-white transition-all shadow-inner"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono px-1">
                <span>Format: 6 Capital Letters</span>
                <span>{code.length}/6 characters</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={code.length !== 6 || isValidating}
              className={`w-full py-4 px-6 rounded-2xl font-display font-extrabold text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all duration-200 shadow-xs ${
                code.length === 6 && !isValidating
                  ? 'bg-black hover:bg-stone-800 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed'
              }`}
            >
              {isValidating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Validating Code...</span>
                </>
              ) : (
                <>
                  <span>Activate Account</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </button>

            {/* Note on how to get an invite */}
            <div className="p-3 rounded-2xl bg-stone-50 border border-stone-100 text-[11px] text-stone-500 text-center leading-relaxed">
              Don't have an invite code? Ask an existing user for their 1 personal invite code, or have someone send confidential funds to your 𝕏 handle — payments preload automatic invite access!
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
