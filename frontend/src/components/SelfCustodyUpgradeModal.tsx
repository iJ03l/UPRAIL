'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Fingerprint,
  Loader2,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Portal } from './Portal';
import { api } from '../lib/api';
import {
  deriveBackupEd25519Keypair,
  generateDeviceRecoveryKey,
  performWebAuthnAssertion,
} from '../lib/selfCustody';
import { describePasskeyError } from '../lib/webauthn';
import { useXAuth } from '../hooks/useXAuth';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useToast } from './Toast';
import { Link } from '../lib/router';
import type { CustodyPreflight } from '../types';

interface SelfCustodyUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgraded?: () => void;
}

type ModalStage = 'setup' | 'success';

export const SelfCustodyUpgradeModal: React.FC<SelfCustodyUpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgraded,
}) => {
  const { user, refreshSession } = useXAuth();
  const { toast: showToast } = useToast();
  useBodyScrollLock(isOpen);

  const [stage, setStage] = useState<ModalStage>('setup');
  const [preflight, setPreflight] = useState<CustodyPreflight | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);

  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [backupPubkey, setBackupPubkey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadedKey, setDownloadedKey] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      `NEAR Intents Account: ${preflight?.nearAccount || user?.nearAccount || ''}`,
      `Backup Public Key: ${backupPubkey}`,
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
    if (!backupPubkey) {
      setError('Device Recovery Key is not initialized yet.');
      return;
    }
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

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-fade-in"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sc-upgrade-title"
          className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 text-stone-950 shadow-2xl max-h-[92vh] overflow-hidden flex flex-col animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 sm:px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <h2 id="sc-upgrade-title" className="text-base font-display font-extrabold text-stone-950 truncate">
                  {stage === 'setup' ? 'Enable Passkey Self-Custody' : 'Self-Custody Active'}
                </h2>
                {resolvedNearAccount && (
                  <p className="text-[11px] font-mono text-stone-500 truncate">
                    {resolvedNearAccount}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-2 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overscroll-contain flex-1">
            {error && (
              <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {stage === 'setup' && (
              <div className="space-y-4">
                {/* Concise Guarantees */}
                <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3.5 space-y-2 text-xs text-stone-700">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Confidential &amp; Intents balances stay intact</strong> on your vault — only your device passkey can sign.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>L1 tokens auto-sweep into Intents</strong> during migration (escrow sponsors token storage on <code className="font-mono text-[11px]">intents.near</code> automatically).
                    </span>
                  </div>
                </div>

                {loadingPreflight && !preflight ? (
                  <div className="py-2 flex items-center gap-2 text-xs font-mono text-stone-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                      onClick={handleCopyRecoveryKey}
                      className="btn-secondary py-2 px-3 rounded-xl text-xs font-mono font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadRecoveryKey}
                      className="btn-secondary py-2 px-3 rounded-xl text-xs font-mono font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {downloadedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Download className="w-3.5 h-3.5" />}
                      <span>{downloadedKey ? 'Saved .txt' : 'Save .txt'}</span>
                    </button>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-stone-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={savedConfirmed}
                    onChange={(e) => setSavedConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-stone-300 text-[#E05326] focus:ring-[#E05326]"
                  />
                  <span>
                    I saved my offline <code className="font-mono font-bold">UP1-…</code> Recovery Key (needed if I ever lose this device passkey).
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleExecuteUpgrade}
                  disabled={!canSubmit}
                  className="btn-primary w-full py-3 px-4 rounded-2xl font-display font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{submitStatus || 'Activating Self-Custody…'}</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      <span>Sign with Passkey &amp; Enable Self-Custody</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {stage === 'success' && upgradeResult && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-700">
                    <ShieldCheck className="w-4 h-4" />
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
        </div>
      </div>
    </Portal>
  );
};
