'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { api } from '../lib/api';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import {
  ShieldAlert,
  KeyRound,
  ArrowRight,
  Sparkles,
  Car,
  AlertOctagon,
  Share2,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

const BOUNCER_QUOTES_REJECT = [
  "🚨 'BZZZT!' The gate arm slammed down. The bouncer laughs: 'Nice try chief, but that coupon expired in 1999.'",
  "The bouncer looked at your code, chuckled softly, and handed it back: 'Not on the guest list, pal.'",
  "ACCESS DENIED! The parking enforcement canine sniffed your code and turned away in disappointment.",
  "The valet attendant tapped his clipboard: 'Sir, this is a restricted settlement zone. Bring a real 6-letter pass.'",
];

export const ParkingPage: React.FC = () => {
  const { user, isLoading, refreshSession } = useXAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isShake, setIsShake] = useState(false);
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

  // Strict Guard: If user is already activated, they NEVER see this parking page
  if (!isLoading && user?.isActivated) {
    return <Navigate to="/app" replace />;
  }

  // Strict Guard: If user is not logged in at all, send to login
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
      setErrorMsg('Code must be exactly 6 capital letters (e.g. UPRAIL)');
      setIsShake(true);
      setTimeout(() => setIsShake(false), 500);
      return;
    }

    setIsValidating(true);
    setErrorMsg(null);

    try {
      // 1. Check validity first
      const val = await api.validateInvite(code);
      if (!val.valid) {
        const randomQuote = BOUNCER_QUOTES_REJECT[Math.floor(Math.random() * BOUNCER_QUOTES_REJECT.length)];
        setErrorMsg(randomQuote);
        setIsShake(true);
        setTimeout(() => setIsShake(false), 500);
        setIsValidating(false);
        return;
      }

      // 2. Redeem invite and activate account
      const res = await api.redeemInvite(code);
      setSuccessData({
        personalInviteCode: res.personalInviteCode,
        message: res.message || 'VIP clearance granted!',
      });

      // Refresh session in background
      await refreshSession();

      // Automatically drive into /app after 2.2 seconds of celebration
      setTimeout(() => {
        navigate('/app', { replace: true });
      }, 2200);
    } catch (err: any) {
      const randomQuote = BOUNCER_QUOTES_REJECT[Math.floor(Math.random() * BOUNCER_QUOTES_REJECT.length)];
      setErrorMsg(err.message || randomQuote);
      setIsShake(true);
      setTimeout(() => setIsShake(false), 500);
    } finally {
      setIsValidating(false);
    }
  };

  const handleTweetForCode = () => {
    const handle = user?.handle ? `@${user.handle}` : 'my ride';
    const text = encodeURIComponent(
      `Yo @UPRAILapp! My ride (${handle}) is stuck in the parking lot gate 🛑🚗 Someone toss me a 6-letter VIP pass! #UPRAIL`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  return (
    <div className="min-h-[100dvh] w-full bg-stone-950 text-white flex flex-col justify-center items-center px-4 py-8 sm:px-6 sm:py-12 relative overflow-hidden font-sans selection:bg-amber-400 selection:text-black">
      {/* Interactive Background */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Top Warning Strip */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-amber-400 text-black py-1.5 px-4 text-center font-mono font-black text-[11px] sm:text-xs tracking-widest uppercase flex items-center justify-center space-x-2 shadow-md">
        <span>🚧</span>
        <span>QUARANTINE PARKING LOT #402 • ENGINE OFF • HAZARDS ON</span>
        <span>🚧</span>
      </div>

      <div className="relative z-10 w-full max-w-md sm:max-w-lg space-y-5 my-6">
        
        {/* Main Card (Styled as an Impound Notice / Valet Station) */}
        <div
          className={`bg-stone-900/95 backdrop-blur-xl border-2 border-stone-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 transition-all duration-300 ${
            isShake ? 'animate-bounce border-red-500/80 shadow-red-500/20' : ''
          }`}
        >
          {/* Success View */}
          {successData ? (
            <div className="text-center space-y-6 animate-fade-in py-2">
              <div className="relative inline-block mx-auto">
                <div className="w-20 h-20 rounded-3xl bg-amber-400/10 border-2 border-amber-400 text-amber-400 flex items-center justify-center mx-auto shadow-lg shadow-amber-400/20">
                  <Sparkles className="w-10 h-10 animate-pulse" />
                </div>
                {/* Rubber Stamp Badge */}
                <div className="absolute -top-3 -right-6 px-3 py-1 bg-emerald-500 text-white font-mono font-black text-xs uppercase tracking-widest rounded-lg border-2 border-white shadow-xl rotate-12 animate-bounce">
                  VALIDATED ✓
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-white">
                  VIP CLEARANCE GRANTED!
                </h2>
                <p className="text-xs sm:text-sm text-stone-300 font-mono">
                  The bouncer nods, lifts the barrier arm, and waves you through.
                </p>
              </div>

              {/* Personal Invite Code Reward */}
              <div className="p-4 rounded-2xl bg-black/60 border border-stone-800 text-center space-y-2.5">
                <div className="text-[11px] font-mono text-amber-400 uppercase tracking-widest font-bold">
                  Your 1 Personal VIP Code to Share
                </div>
                <div className="text-3xl font-mono font-black tracking-[0.3em] text-white bg-stone-900 py-3 px-4 rounded-xl border border-stone-700 inline-block shadow-inner">
                  {successData.personalInviteCode}
                </div>
                <p className="text-[11px] text-stone-400">
                  You have exactly 1 pass to invite a friend into the parking lot.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/app', { replace: true })}
                  className="w-full py-4 px-6 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-display font-black text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                >
                  <span>Drive into Terminal 🏎️💨</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          ) : (
            /* Input & Bouncer Notice View */
            <form onSubmit={handleValidate} className="space-y-6">
              
              {/* Header with Comical Tone */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-mono font-bold uppercase tracking-wider">
                    <Car className="w-3.5 h-3.5" />
                    <span>Valet Checkpoint</span>
                  </div>
                  <span className="text-[11px] font-mono text-stone-500">
                    DRIVER: @{user?.handle}
                  </span>
                </div>

                <div className="space-y-1">
                  <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-white flex items-center space-x-2">
                    <span>HOLD UP, CHIEF!</span>
                    <span className="text-amber-400">🛑</span>
                  </h1>
                  <p className="text-xs sm:text-sm text-stone-400 leading-relaxed font-sans">
                    You can't just cruise into the UPRAIL confidential settlement terminal without a validated parking pass.
                  </p>
                </div>

                {/* Bouncer Quote Speech Bubble */}
                <div className="p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800 text-xs text-stone-300 font-mono flex items-start space-x-3">
                  <span className="text-xl flex-shrink-0">👮‍♂️</span>
                  <p className="leading-relaxed text-[11px]">
                    <strong className="text-amber-400">Bouncer Sal:</strong> "I see your shiny 𝕏 handle and fancy passkey, but nobody enters the VIP rail without a 6-letter pass. Step up and punch it in."
                  </p>
                </div>
              </div>

              {/* Error Message */}
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-red-950/60 border border-red-500/50 text-red-200 text-xs flex items-start space-x-2.5 animate-fade-in font-mono">
                  <AlertOctagon className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMsg}</span>
                </div>
              )}

              {/* 6-Letter Capital Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-stone-400 block text-center">
                  Enter 6-Letter Parking Pass
                </label>

                <div className="relative">
                  <input
                    type="text"
                    value={code}
                    onChange={handleCodeChange}
                    maxLength={6}
                    autoFocus
                    placeholder="UPRAIL"
                    className="w-full text-center text-3xl sm:text-4xl font-mono font-black tracking-[0.35em] uppercase py-4 px-4 rounded-2xl bg-stone-950 border-2 border-stone-800 text-white placeholder-stone-700 focus:outline-none focus:border-amber-400 focus:bg-black transition-all shadow-inner"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono px-1">
                  <span>FORMAT: 6 CAPITAL LETTERS</span>
                  <span>{code.length}/6 ENTERED</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={code.length !== 6 || isValidating}
                className={`w-full py-4 px-6 rounded-2xl font-display font-black text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all duration-200 shadow-md ${
                  code.length === 6 && !isValidating
                    ? 'bg-amber-400 hover:bg-amber-300 text-black cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                    : 'bg-stone-800 text-stone-500 border border-stone-700 cursor-not-allowed'
                }`}
              >
                {isValidating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Verifying with Bouncer...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Validate Parking Pass</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>

              {/* Comical Assistance Options */}
              <div className="pt-2 border-t border-stone-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-stone-500">
                    Don't have a parking pass?
                  </span>
                  <button
                    type="button"
                    onClick={handleTweetForCode}
                    className="inline-flex items-center space-x-1.5 text-[11px] font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    <span>Bribe Attendant on 𝕏</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>

                <p className="text-[11px] text-stone-500 leading-relaxed font-sans">
                  💡 <em>Valet Secret:</em> Did someone send you confidential money? Any payment sent to your handle auto-validates your ticket on first claim!
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center font-mono text-[10px] text-stone-600">
          UPRAIL MAINNET VALET & ACCESS TERMINAL • CONFIDENTIAL NEAR INTENTS
        </div>
      </div>
    </div>
  );
};
