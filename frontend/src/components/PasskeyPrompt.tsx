'use client';

import React from 'react';
import {
  Fingerprint,
  ShieldCheck,
  X,
  Smartphone,
  KeyRound,
  AlertCircle,
} from 'lucide-react';

interface PasskeyPromptProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  handle: string;
  isClaiming?: boolean;
  hasExistingPasskey?: boolean;
  error?: string | null;
  onClearError?: () => void;
}

export const PasskeyPrompt: React.FC<PasskeyPromptProps> = ({
  isOpen,
  onClose,
  onConfirm,
  handle,
  isClaiming = false,
  hasExistingPasskey = false,
  error = null,
  onClearError,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Close Button — always enabled when an error is present or not claiming */}
        <button
          onClick={onClose}
          disabled={isClaiming && !error}
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
            {hasExistingPasskey ? 'Confirm with your passkey' : 'Set up your passkey'}
          </h3>
          <p className="text-xs text-stone-600 leading-relaxed">
            {hasExistingPasskey ? (
              <>
                Use your passkey (Face ID, fingerprint, or your PIN) to receive this payment for{' '}
                <span className="text-stone-900 font-bold font-mono">@{handle}</span>.
              </>
            ) : (
              <>
                This device will save a passkey so you can receive money for{' '}
                <span className="text-stone-900 font-bold font-mono">@{handle}</span> and sign in
                without a password.
              </>
            )}
          </p>
        </div>

        {/* Key UX benefits — Zero crypto jargon */}
        <div className="space-y-3 mb-6 bg-stone-50 rounded-2xl p-4 border border-stone-200 text-xs text-stone-700">
          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-stone-200 text-stone-900 mt-0.5">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-bold text-stone-900">No password to remember</p>
              <p className="text-stone-500 text-[11px]">
                Your device saves your passkey for you.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-stone-200 text-stone-900 mt-0.5">
              <KeyRound className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-bold text-stone-900">Stays on your device</p>
              <p className="text-stone-500 text-[11px]">
                Your passkey uses Face ID, fingerprint, or your PIN. UPRAIL never sees it.
              </p>
            </div>
          </div>
        </div>

        {/* In-Modal Error Alert */}
        {error && (
          <div className="mb-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between animate-fade-in">
            <div className="flex items-center space-x-2 min-w-0 pr-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="break-words font-mono text-[11px]">{error}</span>
            </div>
            {onClearError && (
              <button
                type="button"
                onClick={onClearError}
                className="text-red-500 hover:text-red-800 text-xs font-mono font-bold flex-shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={isClaiming}
          className="w-full py-4 px-6 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-60"
        >
          {isClaiming ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Waiting for your passkey…</span>
            </>
          ) : (
            <>
              <Fingerprint className="w-4 h-4" />
              <span>{hasExistingPasskey ? 'Confirm with passkey & receive' : 'Set up passkey & receive'}</span>
            </>
          )}
        </button>

        <p className="text-center text-[10px] text-stone-400 mt-3 font-sans leading-relaxed">
          Your passkey stays on this device. UPRAIL never sees your Face ID or fingerprint.
        </p>
      </div>
    </div>
  );
};
