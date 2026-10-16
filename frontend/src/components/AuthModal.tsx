'use client';

import React, { useState } from 'react';
import {
  Fingerprint,
  X as CloseIcon,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn } from '../lib/webauthn';
import { detectInAppBrowser, inAppBrowserLabel } from '../lib/inAppBrowser';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onSelectHandle?: (handle: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess, onSelectHandle }) => {
  const { login: loginWithX } = useXAuth();
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = useState(false);

  if (!isOpen) return null;

  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setPasskeyError(null);

      const credential = await webauthn.authenticatePasskey('passkey_holder');
      if (credential) {
        setPasskeySuccess(true);
        setTimeout(() => {
          onClose();
          if (onSelectHandle) onSelectHandle('illia');
          if (onSuccess) onSuccess();
        }, 1000);
      }
    } catch (err: any) {
      console.error('Passkey authentication error:', err);
      const inApp = detectInAppBrowser();
      setPasskeyError(
        inApp.isInApp
          ? `Passkeys don't work in ${inAppBrowserLabel(inApp)} — open this page in Safari or Chrome.`
          : err?.message || 'Passkey canceled or unsupported.'
      );
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 p-6 sm:p-8 shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-600 flex items-center justify-center transition-colors cursor-pointer"
        >
          <CloseIcon className="w-4 h-4" />
        </button>

        {/* Title & Badge */}
        <div className="mb-6">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-stone-900 text-xs font-mono font-bold mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-900 animate-pulse" />
            <span>Dual Authentication</span>
          </div>
          <h2 className="text-2xl font-display font-extrabold text-stone-950 tracking-tight">
            Connect to UPRAIL
          </h2>
          <p className="text-xs text-stone-600 mt-1">
            Choose your preferred sign-in method. Both are non-custodial and protected by hardware biometrics.
          </p>
        </div>

        {/* Status / Error Toast */}
        {passkeyError && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{passkeyError}</span>
          </div>
        )}

        {passkeySuccess && (
          <div className="mb-4 p-3 rounded-xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Passkey verified! Unlocking confidential account...</span>
          </div>
        )}

        {/* 2 Auth Options */}
        <div className="space-y-3">
          {/* Option 1: Passkey Auth */}
          <button
            onClick={handlePasskeyLogin}
            disabled={isPasskeyLoading || passkeySuccess}
            className="w-full text-left p-4 rounded-2xl bg-stone-50 border border-stone-200 hover:border-black hover:bg-stone-100/70 transition-all group relative overflow-hidden shadow-sm cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className="w-11 h-11 rounded-xl bg-black text-white flex items-center justify-center flex-shrink-0 shadow-md group-hover:scale-105 transition-transform">
                <Fingerprint className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-display font-bold text-stone-950 text-base">Passkey Biometrics</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-stone-200 text-stone-900">
                    RECOMMENDED
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                  Your device passkey. Zero seed phrases. Instant private wallet.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-stone-200 flex items-center justify-between text-xs text-stone-900 font-mono font-bold">
              <span>{isPasskeyLoading ? 'Prompting device biometrics...' : 'Sign in with passkey'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Option 2: X (Twitter) Auth */}
          <button
            onClick={() => {
              loginWithX();
              onClose();
            }}
            className="w-full text-left p-4 rounded-2xl bg-stone-50 border border-stone-200 hover:border-black hover:bg-stone-100/70 transition-all group shadow-sm cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className="w-11 h-11 rounded-xl bg-black text-white flex items-center justify-center flex-shrink-0 font-display font-black text-xl group-hover:scale-105 transition-transform">
                𝕏
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-display font-bold text-stone-950 text-base">Connect 𝕏 Account</h3>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                  Authenticate your @handle to claim payments sent to you via NEAR Intents.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-stone-200 flex items-center justify-between text-xs text-stone-900 font-mono font-bold">
              <span>Authorize with 𝕏</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-stone-900" />
            </div>
          </button>
        </div>

        {/* Footnote */}
        <div className="mt-5 pt-4 border-t border-stone-200 flex items-center justify-center space-x-2 text-[11px] text-stone-400 font-mono">
          <Lock className="w-3.5 h-3.5 text-stone-700" />
          <span>Non-custodial cryptography powered by NEAR Intents</span>
        </div>
      </div>
    </div>
  );
};
