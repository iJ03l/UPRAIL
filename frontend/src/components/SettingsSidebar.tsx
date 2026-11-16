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
  Shield,
  Fingerprint,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { useTheme } from './ThemeProvider';
import { api, clearAppStorage } from '../lib/api';
import { webauthn, describePasskeyError } from '../lib/webauthn';
import { RecoveryCodesModal } from './RecoveryCodesModal';
import { SelfCustodyUpgradeModal } from './SelfCustodyUpgradeModal';
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
  const { user, logout, refreshSession } = useXAuth();
  const { mode, setMode } = useTheme();
  const { toast } = useToast();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isSweepingL1, setIsSweepingL1] = useState(false);
  const [sweepL1Msg, setSweepL1Msg] = useState<string | null>(null);
  const [isActivatingPasskey, setIsActivatingPasskey] = useState(false);
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

  // Export UPRAIL NEAR L1 Key states (2-step: Sign with Passkey -> Reveal Key)
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
      // Step 2 requires an explicit click to reveal the decrypted secret
      setShowKey(false);
    } catch (err: any) {
      setExportError(err.message || 'Passkey confirmation failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSweepPlainL1 = async () => {
    setIsSweepingL1(true);
    setSweepL1Msg('Preparing NEAR L1 sweep…');
    try {
      const res = await api.sweepPlainL1SelfCustody(
        { nextStep: 'settings' },
        (_stage, msg) => setSweepL1Msg(msg)
      );
      const sweptCount = res?.swept?.length || 0;
      if (sweptCount > 0) {
        toast(`Swept ${sweptCount} NEAR L1 asset(s) to Intents`, 'success');
      } else {
        toast('No pending NEAR L1 tokens to sweep', 'info');
      }
    } catch (err: any) {
      toast(describePasskeyError(err) || err?.message || 'NEAR L1 sweep cancelled or failed', 'error');
    } finally {
      setIsSweepingL1(false);
      setSweepL1Msg(null);
    }
  };

  const handleActivatePendingPasskey = async () => {
    setIsActivatingPasskey(true);
    try {
      await api.addPasskeyOnchainWithPasskey();
      await refreshSession();
      toast('Pending passkey activated on-chain!', 'success');
    } catch (err: any) {
      toast(describePasskeyError(err) || err?.message || 'Could not activate pending passkey', 'error');
    } finally {
      setIsActivatingPasskey(false);
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
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
              {user ? (
                <>
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

                  <div className="pt-2 border-t border-stone-200/80 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {user.custodyMode === 'self' ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">
                          <ShieldCheck className="w-3 h-3" />
                          Passkey Self-Custody
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200/80 text-stone-700 border border-stone-300">
                          <Shield className="w-3 h-3" />
                          Standard Custody
                        </span>
                      )}
                      {user.nearAccount && (
                        <Link
                          to={`/verify?q=${encodeURIComponent(user.nearAccount)}`}
                          onClick={onClose}
                          className="text-[10px] font-mono font-bold text-stone-700 hover:text-stone-950 inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          <span>Verify On-Chain</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      )}
                    </div>

                    {user.custodyMode !== 'self' && (
                      <button
                        type="button"
                        onClick={() => setShowUpgradeModal(true)}
                        className="w-full py-2 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Upgrade to Passkey Self-Custody</span>
                      </button>
                    )}

                    {user.custodyMode === 'self' && (user.pendingOnchainPasskeysCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={handleActivatePendingPasskey}
                        disabled={isActivatingPasskey}
                        className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isActivatingPasskey ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Fingerprint className="w-3.5 h-3.5" />
                        )}
                        <span>
                          Activate {user.pendingOnchainPasskeysCount} Pending Passkey On-Chain
                        </span>
                      </button>
                    )}
                  </div>
                </>
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
                    {user.custodyMode === 'self' ? 'Offline Recovery Key' : 'Recovery Codes'}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200 flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    {user.custodyMode === 'self'
                      ? 'UP1 Self-Custody'
                      : recoveryStatus
                      ? recoveryStatus.remaining > 0
                        ? `${recoveryStatus.remaining} left`
                        : 'No codes left'
                      : '…'}
                  </span>
                </div>

                {user.custodyMode === 'self' ? (
                  <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-2">
                    <p className="text-[11px] text-stone-600 leading-relaxed">
                      Self-Custody uses your offline <code className="font-mono font-bold">UP1-…</code> Recovery Key to authorize replacement passkeys on-chain. Standard server recovery codes are disabled.
                    </p>
                    {user.backupPubkey && (
                      <div className="text-[10px] font-mono text-stone-500 break-all bg-white p-2 rounded-xl border border-stone-200">
                        Active Backup Key: <span className="text-stone-900">{user.backupPubkey}</span>
                      </div>
                    )}
                  </div>
                ) : (
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
                )}
              </div>
            )}

            {/* NEAR L1 Key (Native Assets Only) & Sweep Section */}
            {user && (
              <div className="space-y-2 order-last">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    NEAR L1 Key (Native Assets Only)
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    2-Step Passkey Auth
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  <div className="space-y-2 pb-2 border-b border-stone-200/80">
                    <p className="text-[11px] text-stone-600 leading-relaxed">
                      Move any raw NEAR L1 native tokens on <span className="font-mono font-semibold">{user.nearAccount || 'u_...'}</span> into Intents using two-step passkey authorization (<strong>Step 1: Sign</strong> → <strong>Step 2: Authorize L1 Key</strong>).
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleSweepPlainL1()}
                      disabled={isSweepingL1}
                      className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isSweepingL1 ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{sweepL1Msg || 'Authorizing L1 Sweep…'}</span>
                        </>
                      ) : (
                        <>
                          <Fingerprint className="w-3.5 h-3.5" />
                          <span>Sweep NEAR L1 Assets → Intents</span>
                        </>
                      )}
                    </button>
                  </div>

                  {!exportedKey ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-stone-600 leading-relaxed">
                        {user.custodyMode === 'self'
                          ? 'In Self-Custody, your Intents assets, Circles, and Gifts are strictly passkey-only. This Ed25519 L1 key only controls raw NEAR L1 native assets on your sub-account.'
                          : 'Export the NEAR L1 Ed25519 private key for your UPRAIL sub-account via two steps: Sign with Passkey, then click Reveal Key.'}
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
                            <span>Step 1: Signing with passkey...</span>
                          </>
                        ) : (
                          <>
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Step 1: Sign with Passkey</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono">
                        <span>L1 Sub-Account:</span>
                        <span className="font-bold text-stone-900 truncate max-w-[170px]">
                          {exportedKey.nearAccount}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono font-bold text-stone-500">
                          NEAR L1 Private Key (Ed25519)
                        </label>
                        <div className="p-2.5 rounded-xl bg-stone-950 text-stone-100 font-mono text-xs break-all select-all relative group">
                          {showKey ? exportedKey.privateKey : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        {!showKey ? (
                          <button
                            type="button"
                            onClick={() => setShowKey(true)}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Step 2: Reveal Key</span>
                          </button>
                        ) : (
                          <>
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
                              onClick={() => setShowKey(false)}
                              className="py-2 px-3 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-mono transition-colors cursor-pointer"
                              title="Hide Key"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>

                      <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[10px] font-mono text-amber-900 leading-tight">
                        ⚠️ <strong>Never share this key.</strong> Controls NEAR L1 native tokens on {exportedKey.nearAccount}. Intents balances use your Self-Custody passkey when active.
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

            {/* Community & Support */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                Support &amp; Community
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
              <a
                href="https://x.com/uprailworld"
                target="_blank"
                rel="noopener noreferrer"
                className="group w-full py-3 px-3 rounded-2xl bg-stone-50 hover:bg-stone-100 border border-stone-200 transition-colors flex items-center justify-between gap-2"
              >
                <span className="flex items-center space-x-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-900 flex-shrink-0">
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </span>
                  <span className="text-left min-w-0">
                    <span className="block text-xs font-mono font-bold text-stone-900">
                      Follow on 𝕏
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

      <SelfCustodyUpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        onUpgraded={() => {
          void refreshSession();
        }}
      />
    </>
  );
};
