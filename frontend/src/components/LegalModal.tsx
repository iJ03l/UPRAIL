'use client';

import React, { useState, useEffect } from 'react';
import { X, Shield, FileText, CheckCircle2, Lock, Scale, ExternalLink } from 'lucide-react';

export type LegalTab = 'privacy' | 'terms';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: LegalTab;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'privacy',
}) => {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-950/60 backdrop-blur-md animate-fade-in select-none">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-2xl bg-white border border-stone-200 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/60 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <img src="/brand/uprail-icon.png" alt="UPRAIL" className="w-8 h-8 object-contain" />
            <div>
              <h2 className="font-display font-extrabold text-base sm:text-lg text-stone-950 tracking-tight">
                {activeTab === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}
              </h2>
              <div className="flex items-center space-x-2 text-[11px] font-mono text-stone-400">
                <span>UPRAIL.app</span>
                <span>•</span>
                <span>Last updated: October 2026</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-stone-900 transition-colors flex items-center justify-center cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-5 sm:px-6 pt-3 pb-2 border-b border-stone-100 flex items-center space-x-2 bg-white flex-shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'privacy'
                ? 'bg-black text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Privacy Policy</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
              activeTab === 'terms'
                ? 'bg-black text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Terms & Conditions</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-7 overflow-y-auto space-y-6 text-stone-700 text-xs sm:text-sm font-sans leading-relaxed select-text">
          {activeTab === 'privacy' ? (
            <div className="space-y-6">
              {/* Highlight Box */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/90 flex items-start space-x-3">
                <Lock className="w-4 h-4 text-stone-900 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="font-bold text-stone-950 font-sans text-xs">
                    Confidential & Privacy-First Architecture
                  </div>
                  <p className="text-[12px] text-stone-600 leading-normal">
                    UPRAIL does not monetize, sell, track, or broker user personal data. We require only public 𝕏 handle identity and cryptographic hardware passkeys to deliver confidential settlement on NEAR Protocol.
                  </p>
                </div>
              </div>

              {/* Section 1 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">1</span>
                  <span>Information We Collect</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  When using UPRAIL, we process only the minimum information required to operate confidential transfers:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-stone-600 text-xs sm:text-[13px]">
                  <li>
                    <strong className="text-stone-900">𝕏 (Twitter) Profile Data:</strong> Public user ID, username (<code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">@handle</code>), and display name accessed strictly via official 𝕏 OAuth 2.0 PKCE (<code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">users.read</code>). We never request posting permissions or private message access.
                  </li>
                  <li>
                    <strong className="text-stone-900">WebAuthn Passkey Public Keys:</strong> Public cryptographic credentials (COSE P-256) registered by your device hardware. Your private keys never leave your secure enclave.
                  </li>
                  <li>
                    <strong className="text-stone-900">Confidential Transaction Metadata:</strong> Cryptographic commitment hashes, escrow identifiers, and asset denominations required to settle transfers on NEAR Intents.
                  </li>
                </ul>
              </div>

              {/* Section 2 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">2</span>
                  <span>Information We Never Collect</span>
                </h3>
                <ul className="list-disc pl-5 space-y-1.5 text-stone-600 text-xs sm:text-[13px]">
                  <li>We never collect or store passwords, seed phrases, or private keys.</li>
                  <li>We never collect biometric data. Face ID, Touch ID, and Windows Hello authentications occur purely within your local device operating system.</li>
                  <li>We do not employ third-party analytics trackers or advertising trackers.</li>
                </ul>
              </div>

              {/* Section 3 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">3</span>
                  <span>Edge Sessions & Cryptographic Security</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  Session tokens are stateless HMAC-SHA256 cryptographically signed cookies delivered over HTTPS TLS with <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">SameSite=Lax</code> and <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">HttpOnly</code> flags. All database records on Cloudflare edge infrastructure are restricted to public identity hashes and encrypted payment escrows.
                </p>
              </div>

              {/* Section 4 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">4</span>
                  <span>User Rights & Data Revocation</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  You can disconnect UPRAIL from your 𝕏 account at any time through your 𝕏 Security and App Permissions settings. You may also request deletion of off-chain identity mappings by contacting <a href="mailto:privacy@uprail.world" className="underline font-mono text-stone-900">privacy@uprail.world</a>.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Highlight Box */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/90 flex items-start space-x-3">
                <Scale className="w-4 h-4 text-stone-900 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="font-bold text-stone-950 font-sans text-xs">
                    Non-Custodial Protocol Interface
                  </div>
                  <p className="text-[12px] text-stone-600 leading-normal">
                    UPRAIL is a decentralized software interface enabling confidential transfers. UPRAIL does not take custody of funds or private keys; all transactions settle directly on the NEAR Protocol.
                  </p>
                </div>
              </div>

              {/* Section 1 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">1</span>
                  <span>Acceptance & Eligibility</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  By authenticating your 𝕏 handle or registering a device Passkey on UPRAIL (<code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">app.uprail.world</code>), you acknowledge and agree to these Terms. You represent that you have legal capacity to enter into binding agreements and are not a resident of any restricted or sanctioned territory.
                </p>
              </div>

              {/* Section 2 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">2</span>
                  <span>Passkey & Device Security Responsibility</span>
                </h3>
                <ul className="list-disc pl-5 space-y-1.5 text-stone-600 text-xs sm:text-[13px]">
                  <li>
                    You maintain exclusive responsibility for protecting the physical devices, biometric credentials, and security keys registered with UPRAIL.
                  </li>
                  <li>
                    Because UPRAIL does not hold seed phrases or private keys, loss of your registered authenticators combined with loss of your 𝕏 account may permanently preclude claiming pending payments.
                  </li>
                </ul>
              </div>

              {/* Section 3 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">3</span>
                  <span>Cryptographic Settlement & Irreversibility</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  Blockchain intents and smart contracts on NEAR are irreversible once validated. You must verify recipient 𝕏 handles, token contracts, and transferred amounts prior to authorizing any intent with your passkey. Payments unclaimed after 30 days are automatically subject to automated escrow return.
                </p>
              </div>

              {/* Section 4 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">4</span>
                  <span>Prohibited Activities</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  You agree not to use UPRAIL to conduct illegal transactions, circumvent applicable sanctions, facilitate money laundering, terror financing, extortion, or exploit software vulnerabilities.
                </p>
              </div>

              {/* Section 5 */}
              <div className="space-y-2">
                <h3 className="font-display font-bold text-sm text-stone-900 tracking-tight flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] flex items-center justify-center font-bold">5</span>
                  <span>Disclaimer of Warranties & Limitation of Liability</span>
                </h3>
                <p className="text-stone-600 text-xs sm:text-[13px]">
                  UPRAIL is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without warranty of any kind. UPRAIL shall not be liable for any damages resulting from network congestion, RPC outages, smart contract failures, browser incompatibility, or unauthorized access to your physical hardware.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-stone-100 bg-stone-50 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] font-mono text-stone-400">
            Confidential rail tooling for 𝕏
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white font-sans font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xs"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
