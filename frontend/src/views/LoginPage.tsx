'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  KeyRound,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn } from '../lib/webauthn';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';

export const LoginPage: React.FC = () => {
  const { user, login: loginWithX, refreshSession } = useXAuth();
  const navigate = useNavigate();

  const [isXLoading, setIsXLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successStepMessage, setSuccessStepMessage] = useState('');
  const [urlInvite, setUrlInvite] = useState('');

  // Capture ?invite=CODE if present
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invite');
      if (inv) setUrlInvite(inv.trim().toUpperCase());
    }
  }, []);

  // Determine which step the user is on:
  // Step 1: Connect 𝕏 (if !user)
  // Step 2: Create / Verify Passkey (if user && !user.hasPasskey)
  // Step 3: Complete -> route to /parking (first time) or /app (returning)
  const isStep1 = !user;
  const isStep2 = !!user && user.hasPasskey === false;
  const isComplete = !!user && user.hasPasskey === true;

  // If already complete, forward immediately to destination
  useEffect(() => {
    if (isComplete) {
      if (user.isActivated === false) {
        navigate('/parking', { replace: true });
      } else {
        navigate('/app', { replace: true });
      }
    }
  }, [isComplete, user, navigate]);

  // Step 1: Initiate 𝕏 OAuth login
  const handleXLogin = async () => {
    try {
      setIsXLoading(true);
      setError(null);
      await loginWithX();
    } catch (err: any) {
      console.error('X login error:', err);
      setError(err?.message || 'Failed to authenticate with 𝕏. Please try again.');
      setIsXLoading(false);
    }
  };

  // Step 2: Register Device Passkey for 𝕏 handle
  const handleRegisterPasskey = async () => {
    if (!user?.handle) return;
    try {
      setIsPasskeyLoading(true);
      setError(null);

      const result = await webauthn.registerPasskey(user.handle);
      if (result.success) {
        setIsSuccess(true);
        setSuccessStepMessage('Device Passkey created! Confidential vault secured.');

        // Refresh user session to pick up new passkey & near account
        await refreshSession();

        // Redirect after short confirmation
        setTimeout(() => {
          if (user.isActivated === false) {
            navigate('/parking', { replace: true });
          } else {
            navigate('/app', { replace: true });
          }
        }, 800);
      }
    } catch (err: any) {
      console.error('Passkey creation error:', err);
      if (err?.name === 'NotAllowedError') {
        setError('Passkey prompt was cancelled on your device.');
      } else {
        setError(err?.message || 'Failed to register passkey. Please try again.');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Quick Passkey Sign In for returning users who already set up both
  const handleQuickPasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setError(null);

      const result = await webauthn.loginWithPasskey();
      if (result.success) {
        setIsSuccess(true);
        setSuccessStepMessage('Passkey verified! Welcome back.');
        await refreshSession();

        setTimeout(() => {
          if (result.user.isActivated === false) {
            navigate('/parking', { replace: true });
          } else {
            navigate('/app', { replace: true });
          }
        }, 500);
      }
    } catch (err: any) {
      console.error('Quick passkey login error:', err);
      if (err?.name === 'NotAllowedError') {
        setError('Passkey prompt was cancelled on your device.');
      } else {
        setError('Passkey not recognized on this device. Please connect with 𝕏 first.');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const isInteracting = isXLoading || isPasskeyLoading || isSuccess;

  return (
    <div className="min-h-[100dvh] w-full bg-stone-50 text-stone-900 flex flex-col justify-center items-center px-4 py-8 sm:px-6 sm:py-12 selection:bg-black selection:text-white relative overflow-hidden font-sans">
      {/* Interactive Background Canvas */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Main Multi-Stage Card */}
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-white border border-stone-200/90 rounded-3xl p-6 sm:p-8 md:p-9 shadow-xl space-y-6">
        
        {/* Brand & Step Indicator */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs">
            <span className="font-display font-black text-base tracking-tight">UP</span>
          </div>

          <div className="space-y-1">
            <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-600 mb-1">
              <span>{isStep1 ? 'Step 1 of 2: Identity' : 'Step 2 of 2: Security'}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight">
              {isStep1 ? 'Connect with 𝕏' : 'Set Up Device Passkey'}
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 font-sans">
              {isStep1
                ? 'Sign in with your Twitter handle to link confidential payments.'
                : 'Create your hardware biometric key to secure your NEAR vault.'}
            </p>
          </div>
        </div>

        {/* Preloaded Invite Banner */}
        {urlInvite && (
          <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 text-xs font-mono flex items-center justify-between shadow-xs">
            <span className="text-stone-500">Access Invite:</span>
            <span className="font-bold text-stone-950 bg-white px-2 py-0.5 rounded border border-stone-300 tracking-wider">
              {urlInvite}
            </span>
            <span className="text-[10px] text-stone-400">Preloaded</span>
          </div>
        )}

        {/* Error / Success Feedback */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-mono flex items-start space-x-2.5 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{error}</span>
          </div>
        )}

        {isSuccess && (
          <div className="p-3.5 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs font-mono flex items-center space-x-2.5 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <span className="font-medium">{successStepMessage}</span>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 1: Connect with 𝕏 */}
        {/* ============================================================== */}
        {isStep1 && (
          <div className="space-y-4 pt-1">
            {/* Primary Action: 𝕏 OAuth */}
            <button
              type="button"
              onClick={handleXLogin}
              disabled={isInteracting}
              className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
            >
              {isXLoading ? (
                <div className="w-full flex items-center justify-center space-x-2.5">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-wider">Connecting to 𝕏...</span>
                </div>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </div>
                  <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                    1. Connect with 𝕏
                  </span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </>
              )}
            </button>

            {/* Subtle Divider for Returning Users */}
            <div className="relative flex items-center justify-center py-1">
              <div className="w-full h-px bg-stone-200" />
              <span className="absolute bg-white px-3 text-[10px] font-mono font-medium text-stone-400 uppercase tracking-widest select-none">
                or
              </span>
            </div>

            {/* Quick Unlock for Returning Users who already configured passkey */}
            <button
              type="button"
              onClick={handleQuickPasskeyLogin}
              disabled={isInteracting}
              className="group relative w-full h-12 px-4 rounded-2xl bg-stone-50 hover:bg-stone-100 active:scale-[0.99] border border-stone-200 text-stone-700 font-sans font-semibold text-xs tracking-wide transition-all duration-150 flex items-center justify-between cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
            >
              {isPasskeyLoading ? (
                <div className="w-full flex items-center justify-center space-x-2">
                  <div className="w-3.5 h-3.5 border-2 border-stone-900 border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs">Checking passkey...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center space-x-2">
                    <Fingerprint className="w-4 h-4 text-stone-600" />
                    <span>Already configured? Quick unlock</span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-700 transition-colors" />
                </>
              )}
            </button>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 2: Create / Register Device Passkey */}
        {/* ============================================================== */}
        {isStep2 && (
          <div className="space-y-4 pt-1 animate-fade-in">
            {/* Identity Badge */}
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <img
                  src={user.avatarUrl}
                  alt={user.handle}
                  className="w-8 h-8 rounded-full border border-stone-300"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="text-left">
                  <div className="text-xs font-bold font-sans text-stone-900">
                    {user.name}
                  </div>
                  <div className="text-[11px] font-mono text-stone-500">
                    @{user.handle}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-1 text-[11px] font-mono text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                <span>Connected</span>
              </div>
            </div>

            {/* Explanation box */}
            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 space-y-1 font-sans">
              <div className="font-bold flex items-center space-x-1.5 text-amber-950">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>One-time Passkey Registration</span>
              </div>
              <p className="text-[11px] text-amber-800/90 leading-relaxed">
                Your device hardware (Face ID / Touch ID) will generate a cryptographic key. No passwords or seed phrases needed.
              </p>
            </div>

            {/* Primary Action: Create Passkey */}
            <button
              type="button"
              onClick={handleRegisterPasskey}
              disabled={isInteracting}
              className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
            >
              {isPasskeyLoading ? (
                <div className="w-full flex items-center justify-center space-x-2.5">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-wider">Creating Passkey...</span>
                </div>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Fingerprint className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                    2. Enable Device Passkey
                  </span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
