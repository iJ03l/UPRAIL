'use client';

import React, { useState, useEffect } from 'react';
import { Key, ArrowRight, Sparkle, Shield, WarningCircle } from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { api } from '../lib/api';
import { currentInvite, inviteFromSearch, takeInvite } from '../lib/invite';

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

  // Preload from the share link, falling back to the code remembered on the
  // way in (the URL is usually long gone by the time this modal opens).
  useEffect(() => {
    const preloaded = inviteFromSearch(window.location.search) || currentInvite();
    if (preloaded) setCode(preloaded);
  }, []);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    setCode(sanitized);
    setError(null);
  };

  const finishActivation = (res: { personalInviteCode: string; message?: string }) => {
    takeInvite();
    setSuccessData({
      personalInviteCode: res.personalInviteCode,
      message: res.message || 'Account successfully activated!',
    });

    // Notify parent to refresh user profile
    setTimeout(() => {
      onActivated();
    }, 2000);
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
      finishActivation(res);
    } catch (err: any) {
      setError(err.message || 'Failed to redeem invite code');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSkip = async () => {
    setIsValidating(true);
    setError(null);
    try {
      const res = await api.redeemInvite(undefined, { skip: true });
      finishActivation(res);
    } catch (err: any) {
      setError(err.message || 'Failed to activate account');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={() => {}}
      canClose={false}
      showCloseButton={false}
      zIndexClass="z-[200]"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 sm:p-8 pt-6 pb-6 space-y-6 font-sans"
      ariaLabel="Enter Invite Code"
    >
      {/* Success View */}
      {successData ? (
        <div className="text-center space-y-5 animate-fade-in">
          <div className="w-16 h-16 rounded-3xl bg-stone-100 border border-stone-200 text-stone-900 flex items-center justify-center mx-auto shadow-sm">
            <Sparkle weight="fill" className="w-8 h-8 text-stone-950" />
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

          <div className="text-xs text-stone-500 font-mono animate-pulse">
            Entering the app...
          </div>
        </div>
      ) : (
        /* Input View */
        <form onSubmit={handleRedeem} className="space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-xs">
              <Key weight="fill" className="w-7 h-7" />
            </div>
            <div className="space-y-1.5 flex flex-col items-center">
              <Badge tone="neutral" icon={<Shield weight="fill" className="w-3 h-3" />}>
                Early Access
              </Badge>
              <h2 className="text-2xl font-black font-display text-stone-950 tracking-tight">
                Enter Invite Code
              </h2>
              <p className="text-xs text-stone-600 max-w-xs mx-auto">
                Have a 6-letter ref code? Enter it below, or skip to continue right into UPRAIL.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2 animate-fade-in font-mono">
              <WarningCircle weight="fill" className="w-4 h-4 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-stone-600 block text-center">
              6-Letter Ref Code (Optional)
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

            <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono px-1">
              <span>Format: 6 Capital Letters</span>
              <span>{code.length}/6 characters</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              type="submit"
              disabled={code.length !== 6 || isValidating}
              className={`w-full py-4 px-6 rounded-2xl font-display font-extrabold text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all duration-200 shadow-xs min-h-11 ${
                code.length === 6 && !isValidating
                  ? 'bg-black hover:bg-stone-800 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed'
              }`}
            >
              {isValidating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Activating...</span>
                </>
              ) : (
                <>
                  <span>Activate With Code</span>
                  <ArrowRight weight="bold" className="w-4 h-4 ml-1" />
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isValidating}
              onClick={handleSkip}
              className="w-full py-3 px-4 rounded-2xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 min-h-11"
            >
              Skip for now &amp; continue →
            </button>
          </div>

          {/* Note on how to get an invite */}
          <div className="p-3 rounded-2xl bg-stone-50 border border-stone-100 text-[11px] text-stone-500 text-center leading-relaxed">
            You can enter a friend&apos;s code above to credit them, or skip to activate automatically and receive your own personal invite code.
          </div>
        </form>
      )}
    </ModalSheet>
  );
};
