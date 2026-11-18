'use client';

import React, { useState } from 'react';
import {
  Fingerprint,
  ArrowRight,
  CheckCircle,
  WarningCircle,
  Lock,
} from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn, describePasskeyError } from '../lib/webauthn';

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
      setPasskeyError(describePasskeyError(err));
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 sm:p-8 pt-2 sm:pt-7 pb-6"
      showCloseButton
      closeLabel="Close connect dialog"
      ariaLabel="Connect to UPRAIL"
    >
      {/* Title & Badge */}
      <div className="mb-6 pr-11">
        <Badge tone="neutral" className="mb-3">
          Dual Authentication
        </Badge>
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
          <WarningCircle weight="fill" className="w-4 h-4 flex-shrink-0" />
          <span>{passkeyError}</span>
        </div>
      )}

      {passkeySuccess && (
        <div className="mb-4 p-3 rounded-xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center space-x-2">
          <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" />
          <span>Device confirmed! Unlocking your UPRAIL account...</span>
        </div>
      )}

      {/* 2 Auth Options */}
      <div className="space-y-3">
        {/* Option 1: Passkey Auth */}
        <button
          type="button"
          onClick={handlePasskeyLogin}
          disabled={isPasskeyLoading || passkeySuccess}
          className="w-full text-left p-4 rounded-2xl bg-stone-50 border border-stone-200 hover:border-black hover:bg-stone-100/70 transition-all group relative overflow-hidden shadow-sm cursor-pointer"
        >
          <div className="flex items-start space-x-4">
            <div className="w-11 h-11 rounded-xl bg-black text-white flex items-center justify-center flex-shrink-0 shadow-md group-hover:scale-105 transition-transform">
              <Fingerprint weight="bold" className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <h3 className="font-display font-bold text-stone-950 text-base">Sign in with your passkey</h3>
                <Badge tone="neutral">Recommended</Badge>
              </div>
              <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                Use Face ID, fingerprint, or your PIN. No password or crypto wallet needed.
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-stone-200 flex items-center justify-between text-xs text-stone-900 font-mono font-bold">
            <span>{isPasskeyLoading ? 'Waiting for your passkey...' : 'Continue with passkey'}</span>
            <ArrowRight weight="bold" className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>

        {/* Option 2: X (Twitter) Auth */}
        <button
          type="button"
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
            <ArrowRight weight="bold" className="w-4 h-4 group-hover:translate-x-1 transition-transform text-stone-900" />
          </div>
        </button>
      </div>

      {/* Footnote */}
      <div className="mt-5 pt-4 border-t border-stone-200 flex items-center justify-center space-x-2 text-[11px] text-stone-500 font-mono">
        <Lock weight="fill" className="w-3.5 h-3.5 text-stone-700" />
        <span>Non-custodial cryptography powered by NEAR Intents</span>
      </div>
    </ModalSheet>
  );
};
