'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Link } from '../lib/router';
import {
  X,
  SignOut,
  ArrowCounterClockwise,
  Globe,
  Sliders,
  Check,
  Copy,
  ArrowSquareOut,
  ShieldCheck,
  Key,
  Eye,
  CircleNotch,
  Sun,
  Moon,
  Desktop,
  Lifebuoy,
  Shield,
  Fingerprint,
} from '@phosphor-icons/react';
import { useXAuth } from '../hooks/useXAuth';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useTheme } from './ThemeProvider';
import { api, clearAppStorage } from '../lib/api';
import { webauthn, describePasskeyError } from '../lib/webauthn';
import { RecoveryCodesModal } from './RecoveryCodesModal';
import { SelfCustodyUpgradeModal } from './SelfCustodyUpgradeModal';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { getInviteClaimSummary } from '../lib/invite';
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
  useBodyScrollLock(isOpen);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isActivatingPasskey, setIsActivatingPasskey] = useState(false);
  const [passkeyActivateMsg, setPasskeyActivateMsg] = useState<string | null>(null);
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
  const [recoveryStepMsg, setRecoveryStepMsg] = useState<string | null>(null);
  const [showRegenerateRecovery, setShowRegenerateRecovery] = useState(false);
  const [recoveryModalMode, setRecoveryModalMode] = useState<'new' | 'view'>('new');
  const [recoveryLegacyCount, setRecoveryLegacyCount] = useState(0);
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[] | null>(null);
  const actionRef = useRef(false);

  const anyBusy =
    isActivatingPasskey || isViewingRecovery || isRegeneratingRecovery || isSigningOut;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !anyBusy &&
        !showSignOutModal &&
        !showResetConfirm &&
        !showUpgradeModal &&
        !showRegenerateRecovery &&
        !freshRecoveryCodes?.length
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isOpen,
    onClose,
    anyBusy,
    showSignOutModal,
    showResetConfirm,
    showUpgradeModal,
    showRegenerateRecovery,
    freshRecoveryCodes,
  ]);

  const handleActivatePendingPasskey = async () => {
    if (actionRef.current || anyBusy) return;
    actionRef.current = true;
    setIsActivatingPasskey(true);
    setPasskeyActivateMsg('Preparing passkey activation…');
    try {
      await api.addPasskeyOnchainWithPasskey(undefined, (_stage, msg) => {
        if (msg) setPasskeyActivateMsg(msg);
      });
      await refreshSession();
      toast('Pending passkey activated on-chain!', 'success');
    } catch (err: any) {
      toast(describePasskeyError(err) || err?.message || 'Could not activate pending passkey', 'error');
    } finally {
      actionRef.current = false;
      setIsActivatingPasskey(false);
      setPasskeyActivateMsg(null);
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
    if (actionRef.current || anyBusy) return;
    actionRef.current = true;
    setIsViewingRecovery(true);
    setRecoveryStepMsg('Confirm with your passkey…');
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
      actionRef.current = false;
      setIsViewingRecovery(false);
      setRecoveryStepMsg(null);
    }
  };

  const performRegenerateRecovery = async () => {
    if (actionRef.current || anyBusy) return;
    actionRef.current = true;
    setIsRegeneratingRecovery(true);
    setRecoveryStepMsg('Confirm with your passkey to replace codes…');
    try {
      const result = await webauthn.regenerateRecoveryCodes();
      setShowRegenerateRecovery(false);
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
      setShowRegenerateRecovery(false);
      toast(describePasskeyError(err), 'error');
    } finally {
      actionRef.current = false;
      setIsRegeneratingRecovery(false);
      setRecoveryStepMsg(null);
    }
  };

  const handleClearCache = () => {
    if (anyBusy) return;
    setShowResetConfirm(true);
  };

  const performClearCache = () => {
    setShowResetConfirm(false);
    clearAppStorage();
    window.location.reload();
  };

  const handleConfirmSignOut = async () => {
    if (actionRef.current || isSigningOut) return;
    actionRef.current = true;
    setIsSigningOut(true);
    try {
      // Await logout before closing: the sidebar only renders while `isOpen`, so
      // calling onClose() in the same tick as logout() unmounts this component
      // and orphans the in-flight logout() — leaving the session half-alive and
      // bouncing the user back to the dashboard instead of a clean sign-out.
      await logout();
      setShowSignOutModal(false);
      onClose();
    } finally {
      actionRef.current = false;
      setIsSigningOut(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed inset-0 z-[100] flex justify-end"
      >
        {/* Backdrop */}
        <div
          onClick={() => {
            if (!anyBusy) onClose();
          }}
          className={`fixed inset-0 bg-stone-950/60 transition-opacity z-[100] ${anyBusy ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          aria-hidden="true"
        />

        {/* Slide-over Drawer Panel */}
        <div className="relative w-full max-w-sm bg-white shadow-2xl border-l border-stone-200 flex flex-col justify-between p-5 sm:p-6 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-[101] h-full overflow-y-auto animate-fade-in font-sans">
          {/* Top Content */}
          <div className="space-y-6 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center space-x-2">
                <Sliders weight="fill" className="w-4 h-4 text-stone-900" />
                <span className="font-display font-extrabold text-base text-stone-950">
                  Settings
                </span>
              </div>
              <button
                type="button"
                disabled={anyBusy}
                onClick={() => {
                  if (!anyBusy) onClose();
                }}
                className="w-11 h-11 -mr-2 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Close settings"
              >
                <X weight="bold" className="w-5 h-5" />
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
                        <div className="text-[11px] text-stone-500 font-mono">
                          Passkey verified
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() => setShowSignOutModal(true)}
                      className="w-10 h-10 -mr-1 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Disconnect Session"
                      aria-label="Sign out"
                    >
                      <SignOut weight="fill" className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-2 border-t border-stone-200/80 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {user.custodyMode === 'self' ? (
                        user.nearAccount ? (
                          <Link
                            to={`/verify?q=${encodeURIComponent(user.nearAccount)}`}
                            onClick={onClose}
                            className="inline-flex hover:opacity-85 transition-opacity"
                            title="Verify Self-Custody Keys On-Chain"
                          >
                            <Badge tone="ok" icon={<ShieldCheck weight="fill" className="w-3 h-3" />}>
                              Self-Custody
                            </Badge>
                          </Link>
                        ) : (
                          <Badge tone="ok" icon={<ShieldCheck weight="fill" className="w-3 h-3" />}>
                            Self-Custody
                          </Badge>
                        )
                      ) : (
                        <Badge tone="neutral" icon={<Shield weight="fill" className="w-3 h-3" />}>
                          Standard Custody
                        </Badge>
                      )}
                      {user.nearAccount && (
                        <Link
                          to={`/verify?q=${encodeURIComponent(user.nearAccount)}`}
                          onClick={onClose}
                          className="text-[10px] font-mono font-bold text-stone-700 hover:text-stone-950 inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          <span>Verify On-Chain</span>
                          <ArrowSquareOut weight="fill" className="w-2.5 h-2.5" />
                        </Link>
                      )}
                    </div>

                    {user.custodyMode !== 'self' && (
                      <button
                        type="button"
                        disabled={anyBusy}
                        onClick={() => setShowUpgradeModal(true)}
                        className="w-full py-2 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ShieldCheck weight="fill" className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Upgrade to Passkey Self-Custody</span>
                      </button>
                    )}

                    {user.custodyMode === 'self' && (user.pendingOnchainPasskeysCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={handleActivatePendingPasskey}
                        disabled={anyBusy}
                        className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isActivatingPasskey ? (
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                        ) : (
                          <Fingerprint weight="bold" className="w-3.5 h-3.5 flex-shrink-0" />
                        )}
                        <span className="truncate">
                          {isActivatingPasskey
                            ? passkeyActivateMsg || 'Activating passkey…'
                            : `Activate ${user.pendingOnchainPasskeysCount} Pending Passkey On-Chain`}
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

            {/* Personal Invite Section (Reusable Ref Code) */}
            {user && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    Your Personal Invite
                  </span>
                  <Badge tone="neutral">Reusable</Badge>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                  {inviteData ? (() => {
                    const { claims, useCount } = getInviteClaimSummary(inviteData);
                    return (
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
                              {copiedInvite ? <Check weight="bold" className="w-3.5 h-3.5" /> : <Copy weight="fill" className="w-3.5 h-3.5" />}
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
                              {copiedLink ? <Check weight="bold" className="w-3.5 h-3.5" /> : <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {claims.length > 0 ? (
                          <div className="p-2.5 rounded-xl bg-white border border-stone-200 text-[11px] text-stone-700 space-y-1.5">
                            <div className="flex items-center space-x-2">
                              <ShieldCheck weight="fill" className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
                              <span>
                                Used by <strong className="font-mono text-stone-950">{useCount}</strong> {useCount === 1 ? 'person' : 'people'} — code stays active
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {claims.slice(0, 6).map((c) => (
                                <span
                                  key={`${c.handle}-${c.claimedAt}`}
                                  className="px-1.5 py-0.5 rounded bg-stone-50 border border-stone-200 font-mono font-bold text-stone-900 text-[10px]"
                                >
                                  @{c.handle}
                                </span>
                              ))}
                              {useCount > 6 && (
                                <span className="px-1.5 py-0.5 font-mono text-stone-500 text-[10px]">
                                  +{useCount - 6} more
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-stone-500 font-mono flex items-center space-x-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                            <span>Reusable code — share with anyone joining UPRAIL</span>
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div className="text-xs text-stone-400 font-mono animate-pulse">
                      Loading your invite code...
                    </div>
                  )}

                  <div className="text-[10px] text-stone-500 font-sans border-t border-stone-200 pt-2 leading-relaxed">
                    Your personal ref code can be reused without limit. Sending money also attaches a dedicated claim link for new recipients.
                  </div>
                </div>
              </div>
            )}

            {/* Recovery Codes (legacy server-custody accounts only) */}
            {user && user.custodyMode !== 'self' && (
              <div className="space-y-2 order-last">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
                    Recovery Codes
                  </span>
                  <Badge tone="neutral" icon={<Key weight="fill" className="w-3 h-3" />}>
                    {recoveryStatus
                      ? recoveryStatus.remaining > 0
                        ? `${recoveryStatus.remaining} left`
                        : 'No codes left'
                      : '…'}
                  </Badge>
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
                        disabled={anyBusy}
                        className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isViewingRecovery ? (
                          <>
                            <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                            <span>{recoveryStepMsg || 'Waiting for your passkey…'}</span>
                          </>
                        ) : (
                          <>
                            <Eye weight="fill" className="w-3.5 h-3.5" />
                            <span>View recovery codes</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRegenerateRecovery(true)}
                        disabled={anyBusy}
                        className="w-full inline-flex items-center justify-center gap-1.5 text-[10px] font-mono font-bold text-stone-500 hover:text-stone-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRegeneratingRecovery && <CircleNotch weight="bold" className="w-3 h-3 animate-spin" />}
                        <span>{isRegeneratingRecovery ? 'Replacing recovery codes…' : 'Replace recovery codes'}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRegenerateRecovery(true)}
                      disabled={anyBusy}
                      className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isRegeneratingRecovery ? (
                        <>
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                          <span>{recoveryStepMsg || 'Waiting for your passkey…'}</span>
                        </>
                      ) : (
                        <>
                          <Key weight="fill" className="w-3.5 h-3.5" />
                          <span>Generate recovery codes</span>
                        </>
                      )}
                    </button>
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
                    <Globe weight="fill" className="w-3.5 h-3.5 text-stone-700" />
                    <span>NEAR Intents RPC:</span>
                  </span>
                  <span className="text-stone-900 font-bold flex items-center space-x-1">
                    <Check weight="bold" className="w-3 h-3 text-stone-900" />
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
                    <Lifebuoy weight="fill" className="w-4 h-4" />
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
                <ArrowSquareOut weight="fill" className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900 transition-colors flex-shrink-0" />
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
                <ArrowSquareOut weight="fill" className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900 transition-colors flex-shrink-0" />
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
                  { value: 'system', label: 'System', Icon: Desktop },
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
                disabled={anyBusy}
                onClick={handleClearCache}
                className="w-full py-2.5 px-3 rounded-xl border border-stone-200 hover:border-stone-400 text-stone-600 hover:text-stone-900 text-xs font-mono transition-colors flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowCounterClockwise weight="bold" className="w-3.5 h-3.5" />
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
      <ModalSheet
        isOpen={showSignOutModal}
        onClose={() => {
          if (!isSigningOut) setShowSignOutModal(false);
        }}
        canClose={!isSigningOut}
        zIndexClass="z-[120]"
        maxWidthClass="sm:max-w-sm"
        panelClassName="px-6 sm:p-7 pt-2 sm:pt-7 pb-6 text-center space-y-4"
        showCloseButton={!isSigningOut}
        closeLabel="Cancel sign out"
        ariaLabel="Sign out confirmation"
      >
        <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 mx-auto">
          <SignOut weight="fill" className="w-5 h-5" />
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
            disabled={isSigningOut}
            onClick={() => setShowSignOutModal(false)}
            className="flex-1 py-3 px-4 min-h-11 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSigningOut}
            onClick={handleConfirmSignOut}
            className="flex-1 py-3 px-4 min-h-11 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSigningOut && <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSigningOut ? 'Signing out…' : 'Sign Out'}</span>
          </button>
        </div>
      </ModalSheet>

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
        onCancel={() => {
          if (!isRegeneratingRecovery) setShowRegenerateRecovery(false);
        }}
        onConfirm={() => void performRegenerateRecovery()}
        isLoading={isRegeneratingRecovery}
        loadingLabel={recoveryStepMsg}
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
