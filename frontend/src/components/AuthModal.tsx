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

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { login: loginWithX } = useXAuth();
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = useState(false);

  if (!isOpen) return null;

  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setPasskeyError(null);

      // Perform WebAuthn authentication ceremony
      const credential = await webauthn.authenticatePasskey('passkey_holder');
      if (credential) {
        setPasskeySuccess(true);
        setTimeout(() => {
          onClose();
          if (onSuccess) onSuccess();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Passkey authentication error:', err);
      // Fallback for simulation / mock demo if device hardware prompt dismissed
      setPasskeyError(err?.message || 'Passkey ceremony canceled or unsupported.');
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-gradient-to-b from-[#181310] to-[#0E0B09] border border-[#2C221D] p-6 sm:p-8 shadow-[0_25px_80px_rgba(224,83,38,0.35)] overflow-hidden">
        {/* Ambient burnt orange glow */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#E05326]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-[#221B17] border border-[#2C221D] text-[#C3B9B2] hover:text-white hover:border-[#E05326]/50 flex items-center justify-center transition-colors"
        >
          <CloseIcon className="w-4 h-4" />
        </button>

        {/* Title & Badge */}
        <div className="mb-6">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#E05326]/10 border border-[#E05326]/30 text-[#E05326] text-xs font-mono font-medium mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E05326] animate-pulse" />
            <span>Dual Confidential Authentication</span>
          </div>
          <h2 className="text-2xl font-display font-extrabold text-white tracking-tight">
            Connect to UPRAIL
          </h2>
          <p className="text-xs text-[#C3B9B2] mt-1">
            Choose your preferred authentication rail. Both are completely non-custodial and protected by hardware cryptography.
          </p>
        </div>

        {/* Status / Error Toast */}
        {passkeyError && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{passkeyError}</span>
          </div>
        )}

        {passkeySuccess && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Passkey verified! Unlocking confidential shard...</span>
          </div>
        )}

        {/* 2 Auth Options */}
        <div className="space-y-4">
          {/* Option 1: Passkey Auth */}
          <button
            onClick={handlePasskeyLogin}
            disabled={isPasskeyLoading || passkeySuccess}
            className="w-full text-left p-4 rounded-2xl bg-[#140F0D] border border-[#2C221D] hover:border-[#E05326] hover:bg-[#1B1410] transition-all group relative overflow-hidden shadow-sm"
          >
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-[#E05326] to-[#FF6B35] text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#E05326]/25 group-hover:scale-105 transition-transform">
                <Fingerprint className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-display font-bold text-white text-base">Passkey Auth</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white text-black">
                    RECOMMENDED
                  </span>
                </div>
                <p className="text-xs text-[#A69C95] mt-1 leading-relaxed">
                  Touch ID, Face ID, or Security Key. Zero seed phrases. Instant confidential wallet.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#221B17] flex items-center justify-between text-xs text-[#E05326] font-mono font-medium">
              <span>{isPasskeyLoading ? 'Authenticating with device...' : 'Sign in with Biometrics'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Option 2: X (Twitter) Auth */}
          <button
            onClick={() => {
              loginWithX();
              onClose();
            }}
            className="w-full text-left p-4 rounded-2xl bg-[#140F0D] border border-[#2C221D] hover:border-[#E05326]/60 hover:bg-[#1B1410] transition-all group shadow-sm"
          >
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center flex-shrink-0 font-display font-black text-xl group-hover:scale-105 transition-transform">
                𝕏
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-display font-bold text-white text-base">Connect X Handle</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#2C221D] text-[#D8CEC5]">
                    CLAIM PAYMENTS
                  </span>
                </div>
                <p className="text-xs text-[#A69C95] mt-1 leading-relaxed">
                  Authenticate your @handle to discover and claim confidential funds waiting in escrow.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#221B17] flex items-center justify-between text-xs text-white font-mono font-medium">
              <span>Authorize with OAuth 2.0 PKCE</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-[#E05326]" />
            </div>
          </button>
        </div>

        {/* Footnote */}
        <div className="mt-6 pt-4 border-t border-[#221B17] flex items-center justify-center space-x-2 text-[11px] text-[#8A7E76]">
          <Lock className="w-3.5 h-3.5 text-[#E05326]" />
          <span>Non-custodial cryptography powered by NEAR TEE Shard</span>
        </div>
      </div>
    </div>
  );
};
