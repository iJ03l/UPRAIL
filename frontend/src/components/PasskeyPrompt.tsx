'use client';

import React from 'react';
import {
  Fingerprint,
  ShieldCheck,
  X,
  Smartphone,
  KeyRound,
} from 'lucide-react';

interface PasskeyPromptProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  handle: string;
  isClaiming?: boolean;
  hasExistingPasskey?: boolean;
}

export const PasskeyPrompt: React.FC<PasskeyPromptProps> = ({
  isOpen,
  onClose,
  onConfirm,
  handle,
  isClaiming = false,
  hasExistingPasskey = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isClaiming}
          className="absolute top-5 right-5 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Biometric Icon Graphic */}
        <div className="flex justify-center mb-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center shadow-sm">
              <Fingerprint className="w-10 h-10 text-stone-900" />
            </div>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-white border border-stone-200 shadow-sm">
              <ShieldCheck className="w-4 h-4 text-stone-900" />
            </div>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center space-y-1.5 mb-6">
          <h3 className="text-xl font-extrabold text-stone-950 font-display">
            {hasExistingPasskey ? 'Verify Device Passkey' : 'One-Touch Passkey'}
          </h3>
          <p className="text-xs text-stone-600 leading-relaxed">
            Claim private payment for{' '}
            <span className="text-stone-900 font-bold font-mono">@{handle}</span> directly on
            this device.
          </p>
        </div>

        {/* Key UX benefits — Zero crypto jargon */}
        <div className="space-y-3 mb-6 bg-stone-50 rounded-2xl p-4 border border-stone-200 text-xs text-stone-700">
          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-stone-200 text-stone-900 mt-0.5">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-bold text-stone-900">No seed phrases or passwords</p>
              <p className="text-stone-500 text-[11px]">
                Secured by Touch ID, Face ID, or your device passcode.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-stone-200 text-stone-900 mt-0.5">
              <KeyRound className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-bold text-stone-900">Hardware Isolated</p>
              <p className="text-stone-500 text-[11px]">
                Keys never leave your phone or laptop's secure chip.
              </p>
            </div>
          </div>
        </div>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={isClaiming}
          className="w-full py-4 px-6 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-60"
        >
          {isClaiming ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Prompting Biometrics...</span>
            </>
          ) : (
            <>
              <Fingerprint className="w-4 h-4" />
              <span>{hasExistingPasskey ? 'Authenticate with Touch ID' : 'Create & Claim with Passkey'}</span>
            </>
          )}
        </button>

        <p className="text-center text-[10px] text-stone-400 mt-3 font-mono">
          WebAuthn P-256 standard • Cloudflare Enclave Protected
        </p>
      </div>
    </div>
  );
};
