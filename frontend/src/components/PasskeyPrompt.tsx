import React from 'react';
import {
  Fingerprint,
  ShieldCheck,
  X,
  Smartphone,
  KeyRound,
  Lock,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-dark-card border border-dark-border shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-near-cyan/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isClaiming}
          className="absolute top-5 right-5 p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Biometric Icon Graphic */}
        <div className="flex justify-center mb-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-brand-500/20 to-near-cyan/20 border border-brand-500/30 flex items-center justify-center shadow-lg shadow-brand-500/10">
              <Fingerprint className="w-10 h-10 text-brand-400 animate-pulse" />
            </div>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-dark-card border border-dark-border">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center space-y-1.5 mb-6">
          <h3 className="text-xl font-black text-white">
            {hasExistingPasskey ? 'Verify Device Passkey' : 'One-Click Device Passkey'}
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Claim confidential payments for{' '}
            <span className="text-brand-400 font-semibold">@{handle}</span> directly on
            this device.
          </p>
        </div>

        {/* Key UX benefits — Zero crypto jargon */}
        <div className="space-y-3 mb-6 bg-dark-surface/70 rounded-2xl p-4 border border-dark-border/50 text-xs text-slate-300">
          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400 mt-0.5">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white">No seed phrases or passwords</p>
              <p className="text-slate-400 text-[11px]">
                Secured directly by Touch ID, Face ID, or your device passcode.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400 mt-0.5">
              <KeyRound className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white">Device-bound NIST P-256 keys</p>
              <p className="text-slate-400 text-[11px]">
                Hardware enclave creates unlinkable cryptographic intent signatures.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 mt-0.5">
              <Lock className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white">Confidential shielded payout</p>
              <p className="text-slate-400 text-[11px]">
                Only the verified holder of this passkey can unlock and route the funds.
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onConfirm}
          disabled={isClaiming}
          className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-emerald-400 hover:from-brand-600 hover:to-emerald-500 text-dark-bg font-extrabold text-sm flex items-center justify-center space-x-2 shadow-lg shadow-brand-500/25 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isClaiming ? (
            <>
              <div className="w-4 h-4 border-2 border-dark-bg border-t-transparent rounded-full animate-spin" />
              <span>Authenticating Biometrics...</span>
            </>
          ) : (
            <>
              <Fingerprint className="w-4 h-4" />
              <span>
                {hasExistingPasskey ? 'Authorize with Passkey' : 'Create Passkey & Claim'}
              </span>
            </>
          )}
        </button>

        <p className="mt-3 text-center text-[10px] text-slate-500">
          Powered by WebAuthn NIST P-256 on NEAR Confidential Intents
        </p>
      </div>
    </div>
  );
};
