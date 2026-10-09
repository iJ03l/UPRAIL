'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { api } from '../lib/api';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import {
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  HelpCircle,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';

export const ParkingPage: React.FC = () => {
  const { user, isLoading, refreshSession } = useXAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [successData, setSuccessData] = useState<{
    personalInviteCode: string;
    message: string;
  } | null>(null);

  // Auto-detect invite/ref code from URL query parameters (e.g. ?invite=UPRAIL or ?ref=UPRAIL)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlInvite = params.get('invite') || params.get('ref') || params.get('code');
      if (urlInvite) {
        const cleaned = urlInvite.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
        if (cleaned.length === 6) {
          setCode(cleaned);
        }
      }
    }
  }, []);

  // Strict Guard: If user is already activated, forward directly to /app
  if (!isLoading && user?.isActivated) {
    return <Navigate to="/app" replace />;
  }

  // Strict Guard: If user is not logged in at all, forward to /login
  if (!isLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    setCode(sanitized);
    setErrorMsg(null);
  };

  const handleValidate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (code.length !== 6) {
      setErrorMsg('Ref code must be exactly 6 letters (e.g. UPRAIL)');
      return;
    }

    setIsValidating(true);
    setErrorMsg(null);

    try {
      // 1. Check validity first
      const val = await api.validateInvite(code);
      if (!val.valid) {
        setErrorMsg(val.reason || 'Invalid or already claimed ref code');
        setIsValidating(false);
        return;
      }

      // 2. Redeem ref code and activate account
      const res = await api.redeemInvite(code);
      setSuccessData({
        personalInviteCode: res.personalInviteCode,
        message: res.message || 'Access granted! Welcome to UPRAIL.',
      });

      // Refresh session in background to pick up is_activated = true
      await refreshSession();

      // Automatically transition into /app after 2 seconds
      setTimeout(() => {
        navigate('/app', { replace: true });
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid or expired ref code. Please check and try again.');
    } finally {
      setIsValidating(false);
    }
  };

  const copyPersonalCode = () => {
    if (!successData?.personalInviteCode) return;
    navigator.clipboard.writeText(successData.personalInviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-stone-50 text-stone-900 flex flex-col justify-center items-center px-4 py-8 sm:px-6 sm:py-12 relative overflow-hidden font-sans selection:bg-black selection:text-white">
      {/* Interactive Background Canvas */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-sm sm:max-w-md space-y-4">
        
        {/* Card */}
        <div className="bg-white border border-stone-200/90 rounded-3xl p-6 sm:p-8 md:p-9 shadow-xl space-y-6">
          
          {/* Brand & Step Header */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs">
              <span className="font-display font-black text-base tracking-tight">UP</span>
            </div>

            <div className="space-y-1">
              <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-600 mb-1">
                <span>Early Access</span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight">
                Enter Ref Code
              </h1>
              <p className="text-xs sm:text-sm text-stone-500 font-sans">
                UPRAIL is currently invite-only. Enter your 6-letter referral code to activate your account.
              </p>
            </div>
          </div>

          {/* Connected User Badge */}
          {user && (
            <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2.5">
                <img
                  src={user.avatarUrl}
                  alt={user.handle}
                  className="w-7 h-7 rounded-full border border-stone-300"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="text-left">
                  <div className="font-bold text-stone-900 text-xs leading-none mb-0.5">
                    {user.name}
                  </div>
                  <div className="text-[11px] font-mono text-stone-500">
                    @{user.handle}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-1 text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                <span>Verified</span>
              </div>
            </div>
          )}

          {/* Success State */}
          {successData ? (
            <div className="text-center space-y-5 animate-fade-in py-1">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                <Sparkles className="w-7 h-7" />
              </div>

              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-stone-950">
                  Account Activated!
                </h2>
                <p className="text-xs text-stone-500 font-sans">
                  {successData.message}
                </p>
              </div>

              {/* Personal Ref Code Reward Box */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-2">
                <div className="text-[10px] font-mono text-stone-400 uppercase tracking-widest font-bold">
                  Your 1 Personal Ref Code to Invite a Peer
                </div>
                <div className="flex items-center justify-center space-x-2">
                  <span className="text-2xl font-mono font-black tracking-[0.25em] text-stone-950 bg-white py-2 px-4 rounded-xl border border-stone-300 shadow-xs">
                    {successData.personalInviteCode}
                  </span>
                  <button
                    type="button"
                    onClick={copyPersonalCode}
                    className="p-2.5 rounded-xl bg-white border border-stone-300 text-stone-700 hover:text-black hover:border-stone-400 transition-colors shadow-xs cursor-pointer"
                    title="Copy Code"
                  >
                    {copiedCode ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-stone-400">
                  Share this code with one colleague to unlock their access.
                </p>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/app', { replace: true })}
                  className="w-full h-13 py-3.5 px-6 rounded-2xl bg-black hover:bg-stone-900 text-white font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all shadow-sm cursor-pointer"
                >
                  <span>Launch Terminal</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          ) : (
            /* Input Form */
            <form onSubmit={handleValidate} className="space-y-5">
              
              {/* Error Message */}
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start space-x-2.5 animate-fade-in font-mono">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMsg}</span>
                </div>
              )}

              {/* 6-Letter Capital Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-stone-500 block text-center">
                  Ref Code
                </label>

                <div className="relative">
                  <input
                    type="text"
                    value={code}
                    onChange={handleCodeChange}
                    maxLength={6}
                    autoFocus
                    placeholder="UPRAIL"
                    className="w-full text-center text-3xl sm:text-4xl font-mono font-black tracking-[0.35em] uppercase py-3.5 px-4 rounded-2xl bg-stone-50 border-2 border-stone-200 text-stone-950 placeholder-stone-300 focus:outline-none focus:border-black focus:bg-white transition-all shadow-inner"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono px-1">
                  <span>6 CAPITAL LETTERS</span>
                  <span>{code.length}/6</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={code.length !== 6 || isValidating}
                className="w-full h-14 px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm tracking-wide transition-all duration-150 flex items-center justify-center space-x-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
              >
                {isValidating ? (
                  <div className="flex items-center space-x-2 font-mono text-xs">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Validating Ref Code...</span>
                  </div>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Activate Account</span>
                    <ArrowRight className="w-4 h-4 ml-0.5" />
                  </>
                )}
              </button>

              {/* Clean Description on How to Get It */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/80 space-y-2 text-stone-600 font-sans text-xs">
                <div className="font-bold text-stone-900 flex items-center space-x-1.5 text-xs">
                  <HelpCircle className="w-3.5 h-3.5 text-stone-600" />
                  <span>How to get a Ref Code</span>
                </div>
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-stone-500 pl-4 list-disc">
                  <li>
                    <strong className="text-stone-700">From an active member:</strong> Every activated user receives 1 personal ref code to invite a peer.
                  </li>
                  <li>
                    <strong className="text-stone-700">Receive a confidential payment:</strong> Anyone who sends funds to your 𝕏 handle automatically activates your account upon claim.
                  </li>
                  <li>
                    <strong className="text-stone-700">Early Access drop:</strong> First sign-ups can use code <code className="font-mono font-bold text-stone-900 bg-stone-200/70 px-1 py-0.5 rounded">UPRAIL</code> or request an access pass from{' '}
                    <a
                      href="https://x.com/UPRAILapp"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-stone-900 font-semibold underline underline-offset-2"
                    >
                      @UPRAILapp
                    </a>.
                  </li>
                </ul>
              </div>
            </form>
          )}

        </div>

        {/* Clean Footer */}
        <div className="text-center font-mono text-[11px] text-stone-400 select-none">
          UPRAIL • Confidential Settlement on NEAR Intents
        </div>
      </div>
    </div>
  );
};
