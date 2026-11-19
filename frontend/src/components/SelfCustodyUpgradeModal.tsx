'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Warning,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  Fingerprint,
  CircleNotch,
  Shield,
  ShieldCheck,
  SignOut,
} from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { api } from '../lib/api';
import {
  deriveBackupEd25519Keypair,
  generateDeviceRecoveryKey,
  performWebAuthnAssertion,
} from '../lib/selfCustody';
import { describePasskeyError } from '../lib/webauthn';
import { useXAuth } from '../hooks/useXAuth';
import { useToast } from './Toast';
import { Link } from '../lib/router';
import type { CustodyPreflight } from '../types';

interface SelfCustodyUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgraded?: () => void;
  required?: boolean;
}

type ModalStage = 'setup' | 'success';

export const SelfCustodyUpgradeModal: React.FC<SelfCustodyUpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgraded,
  required = false,
}) => {
  const { user, refreshSession, logout } = useXAuth();
  const { toast: showToast } = useToast();

  const [stage, setStage] = useState<ModalStage>('setup');
  const [preflight, setPreflight] = useState<CustodyPreflight | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);

  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [backupPubkey, setBackupPubkey] = useState('');
  const [backupNearPrivateKey, setBackupNearPrivateKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadedKey, setDownloadedKey] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [upgradeResult, setUpgradeResult] = useState<{
    nearAccount: string;
    backupPubkey: string;
    txHash: string;
    sweptL1?: Array<{ symbol: string; amount: string; txHash?: string; skipped?: string }>;
  } | null>(null);

  const loadPreflight = async () => {
    setLoadingPreflight(true);
    setError(null);
    try {
      const pf = await api.getCustodyPreflight();
      setPreflight(pf);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Self-Custody preflight checks.');
    } finally {
      setLoadingPreflight(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setStage('setup');
    setError(null);
    setSavedConfirmed(false);
    setCopiedKey(false);
    setDownloadedKey(false);
    setUpgradeResult(null);
    setBackupPubkey('');
    setBackupNearPrivateKey('');
    setSubmitStatus(null);
    void loadPreflight();

    let cancelled = false;
    (async () => {
      try {
        const phrase = await generateDeviceRecoveryKey();
        if (!cancelled) {
          setRecoveryPhrase(phrase);
        }
      } catch {
        if (!cancelled) {
          setError('Could not initialize device cryptographic key generator.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const resolvedNearAccount = (preflight?.nearAccount || user?.nearAccount || '').trim().toLowerCase();

  useEffect(() => {
    if (!isOpen || !recoveryPhrase || !resolvedNearAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const kp = await deriveBackupEd25519Keypair(recoveryPhrase, resolvedNearAccount);
        if (!cancelled) {
          setBackupPubkey(kp.nearPublicKey);
          setBackupNearPrivateKey(kp.nearPrivateKey);
        }
      } catch {
        if (!cancelled) {
          setError('Could not derive backup public key for your NEAR account.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, recoveryPhrase, resolvedNearAccount]);

  if (!isOpen) return null;

  const handleCopyRecoveryKey = async () => {
    if (!recoveryPhrase) return;
    await navigator.clipboard.writeText(recoveryPhrase);
    setCopiedKey(true);
    showToast('Recovery Key copied — store it offline safely', 'success');
  };

  const handleDownloadRecoveryKey = () => {
    if (!recoveryPhrase) return;
    const handle = (user?.handle || 'uprail').replace(/[^a-zA-Z0-9_-]/g, '');
    const content = [
      'UPRAIL SELF-CUSTODY RECOVERY KEY (DEVICE-ONLY — NEVER SENT TO SERVER)',
      '========================================================================',
      `Handle: @${handle}`,
      `NEAR Intents & L1 Account: ${preflight?.nearAccount || user?.nearAccount || ''}`,
      `Backup Public Key: ${backupPubkey}`,
      `NEAR L1 FullAccess Private Key: ${backupNearPrivateKey}`,
      '',
      `Recovery Key: ${recoveryPhrase}`,
      '',
      'IMPORTANT:',
      '- Keep this Recovery Key offline (password manager, hardware vault, or paper).',
      '- Anyone with this key + your X sign-in can authorize a replacement passkey.',
      '- Uprail never stores this key and cannot regenerate it for you.',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uprail-recovery-key-${handle}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadedKey(true);
  };

  const plainToSweep = preflight?.plainBalancesToSweep ?? [];
  const blockers = preflight?.blockingReasons ?? [];

  const handleExecuteUpgrade = async () => {
    if (submittingRef.current) return;
    if (!backupPubkey) {
      setError('Device Recovery Key is not initialized yet.');
      return;
    }
    submittingRef.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      setSubmitStatus('Preparing challenge…');
      const prep = await api.prepareUpgradeToSelfCustody(backupPubkey);
      setSubmitStatus('Confirm with your Passkey…');
      const assertion = await performWebAuthnAssertion(prep.options);
      setSubmitStatus(
        plainToSweep.length > 0
          ? 'Sweeping L1 balances & activating Self-Custody…'
          : 'Activating Passkey Self-Custody on-chain…'
      );
      const submitted = await api.submitUpgradeToSelfCustody({
        actionId: prep.actionId,
        assertion,
      });
      await refreshSession();
      setUpgradeResult({
        nearAccount: submitted.nearAccount,
        backupPubkey: submitted.backupPubkey,
        txHash: submitted.txHash,
        sweptL1: submitted.sweptL1,
      });
      setStage('success');
      showToast('Passkey Self-Custody enabled on-chain!', 'success');
      onUpgraded?.();
    } catch (err: any) {
      setError(describePasskeyError(err) || err?.message || 'Self-Custody upgrade did not complete.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmitStatus(null);
    }
  };

  const canSubmit =
    Boolean(preflight?.readyToUpgrade) &&
    savedConfirmed &&
    Boolean(backupPubkey) &&
    !loadingPreflight &&
    !isSubmitting;

  const canDismiss = !isSubmitting && (!required || stage === 'success');

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      canClose={canDismiss}
      zIndexClass="z-[120]"
      maxWidthClass="sm:max-w-md"
      panelClassName="p-0 flex flex-col overflow-hidden text-stone-950"
      showCloseButton={canDismiss}
      closeLabel="Close Self-Custody upgrade modal"
      ariaLabelledBy="sc-upgrade-title"
    >
      {/* Header */}
      <div className="px-5 sm:px-6 pt-2 sm:pt-4 pb-4 pr-14 border-b border-stone-100 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Shield weight="fill" className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <h2 id="sc-upgrade-title" className="text-base font-display font-extrabold text-stone-950 truncate">
              {stage === 'setup'
                ? required
                  ? 'Migrate to Passkey Self-Custody'
                  : 'Enable Passkey Self-Custody'
                : 'Self-Custody Active'}
            </h2>
            {resolvedNearAccount && (
              <p className="text-[11px] font-mono text-stone-500 truncate">
                {resolvedNearAccount}
              </p>
            )}
          </div>
        </div>
      </div>

          {/* Body */}
          <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overscroll-contain flex-1">
            {error && (
              <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
                <Warning weight="fill" className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {stage === 'setup' && (
              <div className="space-y-4">
                {required && (
                  <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-200 leading-relaxed">
                    <strong>One-time migration required:</strong> UPRAIL now uses Passkey Self-Custody for all transactions. Complete this upgrade to continue — your balances remain intact.
                  </div>
                )}

                {/* Concise Guarantees */}
                <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3.5 space-y-2 text-xs text-stone-700">
                  <div className="flex items-start gap-2">
                    <CheckCircle weight="fill" className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Confidential &amp; Intents balances stay intact</strong> on your vault — only your device passkey can sign.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle weight="fill" className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>L1 tokens auto-sweep into Intents</strong> during migration (escrow sponsors token storage on <code className="font-mono text-[11px]">intents.near</code> automatically).
                    </span>
                  </div>
                </div>

                {loadingPreflight && !preflight ? (
                  <div className="py-2 flex items-center gap-2 text-xs font-mono text-stone-500">
                    <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                    <span>Checking vault &amp; L1 balances…</span>
                  </div>
                ) : null}

                {plainToSweep.length > 0 && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-stone-800 space-y-1">
                    <div className="font-bold text-emerald-700">
                      Auto-sweeping L1 balances into Intents (storage sponsored):
                    </div>
                    <div className="font-mono text-[11px] text-stone-600">
                      {plainToSweep.map((b) => `${b.amountFormatted} ${b.symbol}`).join(' · ')}
                    </div>
                  </div>
                )}

                {blockers.length > 0 && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 space-y-1">
                    <div className="text-xs font-bold text-red-700">Resolve Before Enabling</div>
                    <ul className="list-disc pl-4 space-y-1 text-[11px] text-red-700">
                      {blockers.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Offline Recovery Key */}
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-stone-600">
                      Offline Recovery Key
                    </span>
                    <span className="text-[10px] font-mono text-stone-500">
                      Device-only · Never sent to server
                    </span>
                  </div>

                  <div className="font-mono text-xs break-all text-stone-950 bg-white border border-stone-200 rounded-xl p-2.5 select-all">
                    {recoveryPhrase || 'Generating…'}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting || !recoveryPhrase}
                      onClick={handleCopyRecoveryKey}
                      className="btn-secondary py-2 px-3 rounded-xl text-xs font-mono font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {copiedKey ? <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" /> : <Copy weight="fill" className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || !recoveryPhrase}
                      onClick={handleDownloadRecoveryKey}
                      className="btn-secondary py-2 px-3 rounded-xl text-xs font-mono font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {downloadedKey ? <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" /> : <DownloadSimple weight="fill" className="w-3.5 h-3.5" />}
                      <span>{downloadedKey ? 'Saved .txt' : 'Save .txt'}</span>
                    </button>
                  </div>
                </div>

                <label className={`flex items-start gap-2.5 text-xs text-stone-700 select-none ${isSubmitting ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={savedConfirmed}
                    disabled={isSubmitting}
                    onChange={(e) => setSavedConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-stone-300 text-[#E05326] focus:ring-[#E05326] disabled:cursor-not-allowed"
                  />
                  <span>
                    I saved my offline <code className="font-mono font-bold">UP1-…</code> Recovery Key (needed if I ever lose this device passkey).
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleExecuteUpgrade}
                  disabled={!canSubmit}
                  className="btn-primary w-full py-3 px-4 rounded-2xl font-display font-bold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                      <span>{submitStatus || 'Activating Self-Custody…'}</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint weight="bold" className="w-4 h-4" />
                      <span>Sign with Passkey &amp; Enable Self-Custody</span>
                    </>
                  )}
                </button>

                {required && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void logout()}
                    className="w-full py-2 text-[11px] font-mono text-stone-500 hover:text-stone-900 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <SignOut weight="bold" className="w-3.5 h-3.5" />
                    <span>Sign out of @{user?.handle}</span>
                  </button>
                )}
              </div>
            )}

            {stage === 'success' && upgradeResult && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-700">
                    <ShieldCheck weight="fill" className="w-4 h-4" />
                    <span>Your passkey now controls 100% of your keys on-chain.</span>
                  </div>
                  <div className="font-mono text-[11px] text-stone-700 break-all">
                    Account: {upgradeResult.nearAccount}
                  </div>
                  {upgradeResult.sweptL1 && upgradeResult.sweptL1.filter((s) => s.txHash).length > 0 && (
                    <div className="font-mono text-[11px] text-emerald-700">
                      Swept into Intents:{' '}
                      {upgradeResult.sweptL1
                        .filter((s) => s.txHash)
                        .map((s) => `${s.amount} ${s.symbol}`)
                        .join(' · ')}
                    </div>
                  )}
                  {upgradeResult.txHash && (
                    <div className="font-mono text-[11px] text-stone-500 break-all">
                      Tx: {upgradeResult.txHash}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <Link
                    to={`/verify?q=${encodeURIComponent(upgradeResult.nearAccount)}`}
                    onClick={onClose}
                    className="btn-secondary flex-1 py-3 px-4 rounded-2xl font-display font-bold text-xs text-center"
                  >
                    Verify On-Chain
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-primary flex-1 py-3 px-4 rounded-2xl font-display font-bold text-xs cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
    </ModalSheet>
  );
};
