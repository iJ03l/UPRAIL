'use client';

import React, { useState, useEffect } from 'react';
import { Link } from '../lib/router';
import {
  X,
  LogOut,
  RotateCcw,
  Globe,
  Sliders,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { api } from '../lib/api';
import { MyInviteResponse } from '../types';

interface SettingsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  isOpen,
  onClose,
}) => {
  const { user, logout } = useXAuth();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [inviteData, setInviteData] = useState<MyInviteResponse | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Export Vault Private Key states
  const [exportedKey, setExportedKey] = useState<{ nearAccount: string; privateKey: string; publicKey: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleExportKey = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await api.exportKeyWithPasskey();
      setExportedKey(res);
      setShowKey(true);
    } catch (err: any) {
      setExportError(err.message || 'Passkey verification failed');
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      api.getMyInvite()
        .then(setInviteData)
        .catch(() => {});
    }
  }, [isOpen, user]);

  const handleClearCache = () => {
    if (window.confirm('Reset local application state and cached intent records?')) {
      localStorage.removeItem('uprail_payments');
      localStorage.removeItem('uprail_shielded_balances');
      window.location.reload();
    }
  };

  const handleConfirmSignOut = () => {
    setShowSignOutModal(false);
    logout();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex justify-end">
        {/* Backdrop */}
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity cursor-pointer z-[100]"
          aria-hidden="true"
        />

        {/* Slide-over Drawer Panel */}
        <div className="relative w-full max-w-sm bg-white shadow-2xl border-l border-stone-200 flex flex-col justify-between p-5 sm:p-6 z-[101] h-full overflow-y-auto animate-fade-in font-sans">
          {/* Top Content */}
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-stone-900" />
                <span className="font-display font-extrabold text-base text-stone-950">
                  Settings
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                aria-label="Close settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Account Profile Card */}
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200">
              {user ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img
                      src={user.avatarUrl || `https://unavatar.io/twitter/${user.handle}`}
                      alt={user.handle}
                      className="w-9 h-9 rounded-full border border-stone-300"
                    />
                    <div>
                      <div className="text-xs font-bold text-stone-950 font-mono">
                        @{user.handle}
                      </div>
                      <div className="text-[10px] text-stone-500 font-mono">
                        Vault Authorized
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSignOutModal(true)}
                    className="p-2 rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
                    title="Disconnect Session"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-stone-500 font-mono">No active session</span>
                  <Link
                    to="/login"
                    onClick={onClose}
                    className="px-3.5 py-1.5 rounded-xl bg-black text-white text-xs font-display font-bold uppercase tracking-wider hover:bg-stone-800 transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              )}
            </div>

            {/* Personal Invite Section (1 Invite Access) */}
            {user && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    Your Personal Invite
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200">
                    1 Quota
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  {inviteData ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-mono font-black tracking-widest text-stone-950 bg-white px-3 py-1 rounded-xl border border-stone-200">
                          {inviteData.inviteCode}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(inviteData.inviteCode);
                              setCopiedInvite(true);
                              setTimeout(() => setCopiedInvite(false), 2000);
                            }}
                            className="p-1.5 rounded-lg bg-white hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-mono transition-colors cursor-pointer"
                            title="Copy Code"
                          >
                            {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(inviteData.inviteLink);
                              setCopiedLink(true);
                              setTimeout(() => setCopiedLink(false), 2000);
                            }}
                            className="p-1.5 rounded-lg bg-black hover:bg-stone-800 text-white text-xs font-mono transition-colors cursor-pointer"
                            title="Copy Link"
                          >
                            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {inviteData.status === 'USED' && inviteData.claimedBy ? (
                        <div className="p-2.5 rounded-xl bg-white border border-stone-200 text-[11px] text-stone-700 flex items-center space-x-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
                          <span>
                            Claimed by <strong className="font-mono text-stone-950">@{inviteData.claimedBy.handle}</strong> ({new Date(inviteData.claimedBy.claimedAt).toLocaleDateString()})
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-stone-500 font-mono flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                          <span>1 invite available to share with a friend</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-stone-400 font-mono animate-pulse">
                      Loading your invite code...
                    </div>
                  )}

                  <div className="text-[10px] text-stone-500 font-sans border-t border-stone-200 pt-2 leading-relaxed">
                    Need more invites? Sending confidential money automatically preloads an invite code into the recipient's claim link!
                  </div>
                </div>
              </div>
            )}

            {/* Export Vault Key Section (Passkey Protected) */}
            {user && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    Vault Private Key
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    Passkey Protected
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  {!exportedKey ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-stone-600 leading-relaxed">
                        Export the Full Access NEAR private key for your vault (<span className="font-mono font-semibold">{user.nearAccount || 'u_...'}</span>). Authorized with your biometric passkey.
                      </p>
                      {exportError && (
                        <p className="text-[11px] font-mono text-red-600 bg-red-50 p-2 rounded-xl border border-red-200">
                          {exportError}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={handleExportKey}
                        disabled={isExporting}
                        className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 shadow-xs"
                      >
                        {isExporting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Authenticating Passkey...</span>
                          </>
                        ) : (
                          <>
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Export Private Key</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono">
                        <span>Vault Account:</span>
                        <span className="font-bold text-stone-900 truncate max-w-[170px]">
                          {exportedKey.nearAccount}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono font-bold text-stone-500">
                          Private Key (Ed25519)
                        </label>
                        <div className="p-2.5 rounded-xl bg-stone-950 text-stone-100 font-mono text-xs break-all select-all relative group">
                          {showKey ? exportedKey.privateKey : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(exportedKey.privateKey);
                            setCopiedKey(true);
                            setTimeout(() => setCopiedKey(false), 2000);
                          }}
                          className="flex-1 py-2 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                        >
                          {copiedKey ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Copied Key</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Key</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          className="py-2 px-3 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-mono transition-colors cursor-pointer"
                          title={showKey ? 'Hide Key' : 'Reveal Key'}
                        >
                          {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[10px] font-mono text-amber-900 leading-tight">
                        ⚠️ <strong>Never share this key.</strong> Grants full custody to withdraw funds from your onchain NEAR vault in any wallet.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Network Routing Status */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                Network Routing
              </span>

              <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center space-x-1.5">
                    <Globe className="w-3.5 h-3.5 text-stone-700" />
                    <span>NEAR Intents RPC:</span>
                  </span>
                  <span className="text-stone-900 font-bold flex items-center space-x-1">
                    <Check className="w-3 h-3 text-stone-900" />
                    <span>Mainnet</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">Solver Latency:</span>
                  <span className="text-stone-900 font-bold">~42ms</span>
                </div>
              </div>
            </div>

            {/* Cache Maintenance */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleClearCache}
                className="w-full py-2.5 px-3 rounded-xl border border-stone-200 hover:border-stone-400 text-stone-600 hover:text-stone-900 text-xs font-mono transition-colors flex items-center justify-center space-x-2 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Local Vault Cache</span>
              </button>
            </div>
          </div>

          {/* Footer info */}
          <div className="pt-4 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-400">
            <span>UPRAIL Protocol</span>
            <span>v1.0 • Non-custodial</span>
          </div>
        </div>
      </div>

      {/* Sign Out Confirmation Modal */}
      {showSignOutModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-white border border-stone-200 p-6 sm:p-7 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 mx-auto">
              <LogOut className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-stone-950 font-display">
                Sign Out?
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Are you sure you want to disconnect <span className="font-mono font-bold text-stone-900">@{user?.handle}</span>? You will need to authenticate again to access your confidential payments.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSignOutModal(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSignOut}
                className="flex-1 py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
