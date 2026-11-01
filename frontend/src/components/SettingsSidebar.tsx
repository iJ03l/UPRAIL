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
  Sun,
  Moon,
  Monitor,
  LifeBuoy,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { useTheme } from './ThemeProvider';
import { api, clearAppStorage } from '../lib/api';
import { webauthn, describePasskeyError } from '../lib/webauthn';
import { RecoveryCodesModal } from './RecoveryCodesModal';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
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
  const { mode, setMode } = useTheme();
  const { toast } = useToast();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [inviteData, setInviteData] = useState<MyInviteResponse | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<{
    hasCodes: boolean;
    remaining: number;
    viewable: number;
  } | null>(null);
  const [isViewingRecovery, setIsViewingRecovery] = useState(false);
  const [isRegeneratingRecovery, setIsRegeneratingRecovery] = useState(false);
  const [showRegenerateRecovery, setShowRegenerateRecovery] = useState(false);
  const [recoveryModalMode, setRecoveryModalMode] = useState<'new' | 'view'>('new');
  const [recoveryLegacyCount, setRecoveryLegacyCount] = useState(0);
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[] | null>(null);

  // Export UPRAIL Account Key states
  const [exportedKey, setExportedKey] = useState<{ nearAccount: string; privateKey: string; publicKey: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleExportKey = () => {
    setShowExportConfirm(true);
  };

  const performExportKey = async () => {
    setShowExportConfirm(false);
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await api.exportKeyWithPasskey();
      setExportedKey(res);
      setShowKey(true);
    } catch (err: any) {
      setExportError(err.message || 'Passkey confirmation failed');
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      api.getMyInvite()
        .then(setInviteData)
        .catch(() => {});
      api.getRecoveryStatus()
        .then(setRecoveryStatus)
        .catch(() => setRecoveryStatus(null));
    }
  }, [isOpen, user]);

  const performViewRecovery = async () => {
    setIsViewingRecovery(true);
    try {
      const result = await webauthn.viewRecoveryCodes();
      setRecoveryStatus({
        hasCodes: result.remaining > 0,
        remaining: result.remaining,
        viewable: result.codes.length,
      });
      setRecoveryLegacyCount(result.legacy);
      if (result.codes.length === 0) {
        toast(
          result.legacy > 0
            ? 'This set was created before codes could be viewed. Replace it once to make future codes viewable.'
            : 'No unused recovery codes left.',
          'error'
        );
        return;
      }
      setRecoveryModalMode('view');
      setFreshRecoveryCodes(result.codes);
    } catch (err: any) {
      toast(describePasskeyError(err), 'error');
    } finally {
      setIsViewingRecovery(false);
    }
  };

  const performRegenerateRecovery = async () => {
    setShowRegenerateRecovery(false);
    setIsRegeneratingRecovery(true);
    try {
      const result = await webauthn.regenerateRecoveryCodes();
      setFreshRecoveryCodes(result.recoveryCodes);
      setRecoveryModalMode('new');
      setRecoveryLegacyCount(0);
      setRecoveryStatus({
        hasCodes: true,
        remaining: result.remaining,
        viewable: result.recoveryCodes.length,
      });
      toast('New recovery codes generated');
    } catch (err: any) {
      toast(describePasskeyError(err), 'error');
    } finally {
      setIsRegeneratingRecovery(false);
    }
  };

  const handleClearCache = () => {
    setShowResetConfirm(true);
  };

  const performClearCache = () => {
    setShowResetConfirm(false);
    clearAppStorage();
    window.location.reload();
  };

  const handleConfirmSignOut = async () => {
    setShowSignOutModal(false);
    // Await logout before closing: the sidebar only renders while `isOpen`, so
    // calling onClose() in the same tick as logout() unmounts this component
    // and orphans the in-flight logout() — leaving the session half-alive and
    // bouncing the user back to the dashboard instead of a clean sign-out.
    await logout();
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
          <div className="space-y-6 flex flex-col">
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
                        Passkey verified
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
                              toast('Invite code copied');
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
                              toast('Invite link copied');
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
                            Used by <strong className="font-mono text-stone-950">@{inviteData.claimedBy.handle}</strong> ({new Date(inviteData.claimedBy.claimedAt).toLocaleDateString()})
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
                    Need more invites? Sending money automatically adds an invite code to the recipient's payment link.
                  </div>
                </div>
              </div>
            )}

            {/* Recovery Codes */}
            {user && (
              <div className="space-y-2 order-last">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    Recovery Codes
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200 flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    {recoveryStatus
                      ? recoveryStatus.remaining > 0
                        ? `${recoveryStatus.remaining} left`
                        : 'No codes left'
                      : '…'}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    Each code works once. View them with your passkey whenever you need them, or replace the set if you no longer have your saved copy.
                  </p>

                  {recoveryStatus && recoveryStatus.remaining > 0 && recoveryStatus.viewable < recoveryStatus.remaining && (
                    <p className="text-[10px] font-mono text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5 leading-relaxed">
                      {recoveryStatus.viewable === 0
                        ? 'This set was created before codes could be viewed. Replace it once to make future codes viewable.'
                        : `${recoveryStatus.remaining - recoveryStatus.viewable} code(s) predate secure viewing and can't be displayed.`}
                    </p>
                  )}

                  {recoveryStatus?.hasCodes ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void performViewRecovery()}
                        disabled={isViewingRecovery || isRegeneratingRecovery}
                        className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                      >
                        {isViewingRecovery ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Waiting for your passkey...</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>View recovery codes</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRegenerateRecovery(true)}
                        disabled={isViewingRecovery || isRegeneratingRecovery}
                        className="w-full text-[10px] font-mono font-bold text-stone-500 hover:text-stone-900 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isRegeneratingRecovery ? 'Waiting for your passkey...' : 'Replace recovery codes'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRegenerateRecovery(true)}
                      disabled={isRegeneratingRecovery}
                      className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                    >
                      {isRegeneratingRecovery ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Waiting for your passkey...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Generate recovery codes</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Export Vault Key Section (Passkey Protected) */}
            {user && (
              <div className="space-y-2 order-last">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    UPRAIL Account Key
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    Protected by your passkey
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  {!exportedKey ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-stone-600 leading-relaxed">
                        Export the Full Access NEAR private key for your UPRAIL account (<span className="font-mono font-semibold">{user.nearAccount || 'u_...'}</span>). Confirmed with your passkey (Face ID, fingerprint, or PIN).
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
                            <span>Waiting for your passkey...</span>
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
                        <span>Account:</span>
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
                            toast('Private key copied', 'info');
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
                        ⚠️ <strong>Never share this key.</strong> Grants full custody to withdraw money from your UPRAIL account in any wallet.
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

            {/* Help & Support */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                Need Help?
              </span>
              <a
                href="https://t.me/uprailworld"
                target="_blank"
                rel="noopener noreferrer"
                className="group w-full py-3 px-3 rounded-2xl bg-stone-50 hover:bg-stone-100 border border-stone-200 transition-colors flex items-center justify-between gap-2"
              >
                <span className="flex items-center space-x-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-900 flex-shrink-0">
                    <LifeBuoy className="w-4 h-4" />
                  </span>
                  <span className="text-left min-w-0">
                    <span className="block text-xs font-mono font-bold text-stone-900">
                      Get help on Telegram
                    </span>
                    <span className="block text-[10px] text-stone-500 font-mono truncate">
                      @uprailworld
                    </span>
                  </span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900 transition-colors flex-shrink-0" />
              </a>
            </div>

            {/* Appearance / Theme */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                Appearance
              </span>
              <div className="p-1.5 rounded-2xl bg-stone-50 border border-stone-200 grid grid-cols-3 gap-1.5">
                {([
                  { value: 'light', label: 'Light', Icon: Sun },
                  { value: 'dark', label: 'Dark', Icon: Moon },
                  { value: 'system', label: 'System', Icon: Monitor },
                ] as const).map(({ value, label, Icon }) => {
                  const active = mode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      aria-pressed={active}
                      className={`py-2 rounded-xl text-[11px] font-mono font-bold flex flex-col items-center gap-1 border transition-colors cursor-pointer ${
                        active
                          ? 'bg-black text-white border-black'
                          : 'bg-transparent text-stone-600 border-transparent hover:bg-stone-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  );
                })}
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
                <span>Reset local cache</span>
              </button>
            </div>
          </div>

          {/* Footer info */}
          <div className="pt-4 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-400">
            <span>UPRAIL Protocol</span>
            <span>v1.1 • Non-custodial</span>
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
                Are you sure you want to disconnect <span className="font-mono font-bold text-stone-900">@{user?.handle}</span>? You will need to authenticate again to access your payments.
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

      <RecoveryCodesModal
        isOpen={!!freshRecoveryCodes && freshRecoveryCodes.length > 0}
        codes={freshRecoveryCodes || []}
        onDone={() => {
          setFreshRecoveryCodes(null);
          setRecoveryLegacyCount(0);
        }}
        title={recoveryModalMode === 'view' ? 'Your recovery codes' : 'Your new recovery codes'}
        description={
          recoveryModalMode === 'view'
            ? 'These are your unused recovery codes. Each one works once and can register a new passkey.'
            : 'Save these now. Replacing codes immediately invalidates every old unused code.'
        }
        notice={
          recoveryModalMode === 'view'
            ? recoveryLegacyCount > 0
              ? `${recoveryLegacyCount} older code(s) predate secure viewing and can't be displayed. Replace the set once to make future codes viewable.`
              : 'Anyone with a code can replace your passkey. Keep these private.'
            : undefined
        }
        doneLabel={recoveryModalMode === 'view' ? 'Close' : 'I saved these codes'}
      />

      <ConfirmDialog
        isOpen={showRegenerateRecovery}
        onCancel={() => setShowRegenerateRecovery(false)}
        onConfirm={() => void performRegenerateRecovery()}
        tone="financial"
        title="Replace recovery codes?"
        description="You will get ten new single-use codes. Every old unused code stops working immediately."
        confirmLabel="Replace codes"
        warning="The previous set will stop working immediately. You can view the new codes anytime with your passkey."
        details={[
          { label: 'Codes left', value: recoveryStatus ? String(recoveryStatus.remaining) : '—' },
          { label: 'Confirmation', value: 'Passkey required after this step', mono: false },
        ]}
      />

      <ConfirmDialog
        isOpen={showExportConfirm}
        onCancel={() => setShowExportConfirm(false)}
        onConfirm={() => void performExportKey()}
        tone="danger"
        title="Export account key"
        description="This key gives full control of your UPRAIL account. Anyone who has it can move every asset without your passkey."
        confirmLabel="Export key"
        warning="Never share this key or paste it into a website. Store it offline and delete it from your clipboard after use."
        details={[
          { label: 'Account', value: user?.nearAccount || 'u_…' },
          { label: 'Protection', value: 'Passkey confirmation required after this step', mono: false },
        ]}
      />

      <ConfirmDialog
        isOpen={showResetConfirm}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={performClearCache}
        tone="danger"
        title="Reset local cache"
        description="This clears locally stored app state and cached payment data on this device, then reloads the page."
        confirmLabel="Reset cache"
        warning="Your on-chain balance and payments are not affected. You may need to confirm with your passkey again."
      />
    </>
  );
};
