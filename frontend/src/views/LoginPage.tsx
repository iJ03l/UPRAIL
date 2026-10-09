'use client';

import React, { useState } from 'react';
import { useNavigate } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn } from '../lib/webauthn';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';

export const LoginPage: React.FC = () => {
  const { user, login: loginWithX } = useXAuth();
  const navigate = useNavigate();

  const [isXLoading, setIsXLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [urlInvite, setUrlInvite] = useState('');

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invite');
      if (inv) setUrlInvite(inv.trim().toUpperCase());
    }
  }, []);

  // If already authenticated, redirect smoothly to vault
  React.useEffect(() => {
    if (user) {
      navigate('/app', { replace: true });
    }
  }, [user, navigate]);

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

  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setError(null);

      const result = await webauthn.loginWithPasskey();
      if (result.success) {
        setIsSuccess(true);
        setTimeout(() => {
          navigate('/app');
        }, 350);
      }
    } catch (err: any) {
      console.error('Passkey authentication error:', err);
      if (err?.name === 'NotAllowedError') {
        setError('Passkey verification was cancelled on your device.');
      } else {
        setError(err?.message || 'Passkey authentication failed. Please sign in with 𝕏 first.');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const isInteracting = isXLoading || isPasskeyLoading || isSuccess;

  return (
    <div className="min-h-[100dvh] w-full bg-stone-50 text-stone-900 flex flex-col justify-center items-center px-4 py-8 sm:px-6 sm:py-12 selection:bg-black selection:text-white relative overflow-hidden">
      {/* Quantus Background Canvas (Fullscreen roam) */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Centered multi-device card */}
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-white border border-stone-200/90 rounded-3xl p-6 sm:p-8 md:p-9 shadow-xs space-y-6 sm:space-y-7">
        
        {/* Brand & Heading (Monochrome, centered, uncluttered) */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs">
            <span className="font-display font-black text-base tracking-tight">UP</span>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight">
              Sign In
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 font-mono">
              Confidential payments to any 𝕏 handle & wallet.
            </p>
          </div>
        </div>

        {/* Preloaded Invite Banner */}
        {urlInvite && (
          <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 text-xs font-mono flex items-center justify-between animate-fade-in shadow-xs">
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
            <span className="font-medium">Authentication confirmed. Entering vault...</span>
          </div>
        )}

        {/* Actions (Primary Buttons with ample hit targets & clean spacing) */}
        <div className="space-y-3 sm:space-y-3.5 pt-1">
          {/* Button 1: Continue with 𝕏 */}
          <button
            type="button"
            onClick={handleXLogin}
            disabled={isInteracting}
            className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-xs hover:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
          >
            {isXLoading ? (
              <div className="w-full flex items-center justify-center space-x-2.5">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span className="font-mono text-xs uppercase tracking-wider">Authorizing with 𝕏...</span>
              </div>
            ) : (
              <>
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </div>
                <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                  Continue with 𝕏
                </span>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </>
            )}
          </button>

          {/* Minimal Divider */}
          <div className="relative flex items-center justify-center py-1 sm:py-1.5">
            <div className="w-full h-px bg-stone-200" />
            <span className="absolute bg-white px-3 text-[10px] font-mono font-medium text-stone-400 uppercase tracking-widest select-none">
              or
            </span>
          </div>

          {/* Button 2: Sign in with Passkey */}
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={isInteracting}
            className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-stone-50 hover:bg-stone-100 active:scale-[0.99] border border-stone-200 hover:border-stone-400 text-stone-900 font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
          >
            {isPasskeyLoading ? (
              <div className="w-full flex items-center justify-center space-x-2.5">
                <div className="w-4 h-4 border-2 border-stone-900 border-t-transparent rounded-full animate-spin" />
                <span className="font-mono text-xs uppercase tracking-wider text-stone-800">Verifying Passkey...</span>
              </div>
            ) : (
              <>
                <div className="w-8 h-8 rounded-xl bg-stone-200/70 group-hover:bg-stone-200 flex items-center justify-center text-stone-900 flex-shrink-0 transition-colors">
                  <Fingerprint className="w-4 h-4 text-stone-900" />
                </div>
                <div className="flex-1 flex flex-col items-center justify-center pr-1 sm:pr-2 leading-tight">
                  <span className="font-display font-bold text-sm sm:text-base tracking-tight text-stone-900">
                    Sign in with Passkey
                  </span>
                  <span className="text-[10px] font-mono text-stone-500 font-normal">
                    Face ID • Touch ID • Security Key
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-stone-900 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
