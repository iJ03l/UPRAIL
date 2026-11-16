'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
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
}

type WizardStage = 'preflight' | 'backup_key' | 'confirm' | 'success';

export const SelfCustodyUpgradeModal: React.FC<SelfCustodyUpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgraded,
}) => {
  const { user, refreshSession } = useXAuth();
  const { toast: showToast } = useToast();

  const [stage, setStage] = useState<WizardStage>('preflight');
  const [preflight, setPreflight] = useState<CustodyPreflight | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [sweepingL1, setSweepingL1] = useState(false);
  const [sweepProgressMsg, setSweepProgressMsg] = useState<string | null>(null);

  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [backupPubkey, setBackupPubkey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadedKey, setDownloadedKey] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeResult, setUpgradeResult] = useState<{
    nearAccount: string;
    backupPubkey: string;
    txHash: string;
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
    setStage('preflight');
    setError(null);
    setSavedConfirmed(false);
    setCopiedKey(false);
    setDownloadedKey(false);
    setUpgradeResult(null);
    setBackupPubkey('');
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

  const handleRegenerateKey = async () => {
    setError(null);
    try {
      const phrase = await generateDeviceRecoveryKey();
      setRecoveryPhrase(phrase);
      if (resolvedNearAccount) {
        const kp = await deriveBackupEd25519Keypair(phrase, resolvedNearAccount);
        setBackupPubkey(kp.nearPublicKey);
      } else {
        setBackupPubkey('');
      }
      setCopiedKey(false);
      setDownloadedKey(false);
      setSavedConfirmed(false);
    } catch {
      setError('Failed to generate a new Recovery Key on device.');
    }
  };

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

  const handleSweepPlainL1 = async () => {
    setError(null);
    setSweepingL1(true);
    setSweepProgressMsg('Preparing NEAR L1 sweep…');
    try {
      await api.sweepPlainL1SelfCustody(
        { nextStep: 'upgrade' },
        (_stage, msg) => setSweepProgressMsg(msg)
      );
      showToast('NEAR L1 balances swept into Intents', 'success');
      await loadPreflight();
    } catch (err: any) {
      setError(describePasskeyError(err) || err?.message || 'Failed to sweep NEAR L1 balances.');
    } finally {
      setSweepingL1(false);
      setSweepProgressMsg(null);
    }
  };

  const handleExecuteUpgrade = async () => {
    if (!backupPubkey) {
      setError('Device Recovery Key is not initialized yet.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const prep = await api.prepareUpgradeToSelfCustody(backupPubkey);
      const assertion = await performWebAuthnAssertion(prep.options);
      const submitted = await api.submitUpgradeToSelfCustody({
        actionId: prep.actionId,
        assertion,
      });
      await refreshSession();
      setUpgradeResult({
        nearAccount: submitted.nearAccount,
        backupPubkey: submitted.backupPubkey,
        txHash: submitted.txHash,
      });
      setStage('success');
      showToast('Passkey Self-Custody enabled on-chain!', 'success');
      onUpgraded?.();
    } catch (err: any) {
      setError(describePasskeyError(err) || err?.message || 'Self-Custody upgrade did not complete.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasPlainToSweep = (preflight?.plainBalancesToSweep?.length ?? 0) > 0;
  const blockers = preflight?.blockingReasons ?? [];

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sc-upgrade-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-stone-800 bg-[#0F0C0B] text-stone-100 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-stone-800/80 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                Passkey Self-Custody
              </div>
              <h2 id="sc-upgrade-title" className="text-base sm:text-lg font-display font-bold text-stone-50 truncate">
                {stage === 'preflight' && '1. Pre-Upgrade On-Chain Check'}
                {stage === 'backup_key' && '2. Save Your Offline Recovery Key'}
                {stage === 'confirm' && '3. Sign Atomic Key Rotation'}
                {stage === 'success' && 'Self-Custody Active On-Chain'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || sweepingL1}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-100 hover:bg-stone-800/70 transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-xs text-red-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* ── STAGE 1: PREFLIGHT ──────────────────────────────────── */}
          {stage === 'preflight' && (
            <div className="space-y-4">
              <p className="text-xs text-stone-300 leading-relaxed">
                Upgrading permanently removes the Uprail server key from your <code className="text-stone-100 font-mono">intents.near</code> account,
                disables predecessor-based signing, and binds your device passkey (P-256) + offline Recovery Key directly on-chain.
              </p>

              {loadingPreflight && !preflight ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-stone-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Inspecting live on-chain keys and balances…</span>
                </div>
              ) : preflight ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-400">NEAR Account</span>
                      <span className="font-mono text-stone-100 truncate max-w-[260px]" title={preflight.nearAccount}>
                        {preflight.nearAccount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-400">Registered Passkeys (P-256)</span>
                      <span className={preflight.eligiblePasskeys.length > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {preflight.eligiblePasskeys.length} eligible
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-400">Server Key Present On-Chain</span>
                      <span className="font-mono text-stone-200">
                        {preflight.authState.serverKeyPresentOnchain ? 'Yes (will be removed)' : 'No'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-400">Existing Escrow Circles / Gifts</span>
                      <span className="font-mono text-stone-300">
                        {preflight.activeEscrowCircles} Circles · {preflight.activeEscrowGifts} Gifts (supported)
                      </span>
                    </div>
                  </div>

                  {hasPlainToSweep && (
                    <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-3">
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-2">
                        <KeyRound className="w-4 h-4 shrink-0" />
                        <span>NEAR L1 Balances Detected ({preflight.plainBalancesToSweep.length})</span>
                      </div>
                      <p className="text-[11px] text-amber-100/80 leading-relaxed">
                        Sweep L1 tokens into Intents now using two-step passkey L1 authorization so you retain full self-custody over them after server-key removal:
                      </p>
                      <div className="space-y-1">
                        {preflight.plainBalancesToSweep.map((b) => (
                          <div key={b.assetId} className="flex justify-between text-xs font-mono text-stone-100 bg-black/30 px-3 py-1.5 rounded-lg">
                            <span>{b.symbol}</span>
                            <span>{b.amountFormatted}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleSweepPlainL1}
                        disabled={sweepingL1}
                        className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {sweepingL1 ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{sweepProgressMsg || 'Authorizing L1 Sweep…'}</span>
                          </>
                        ) : (
                          <>
                            <Fingerprint className="w-3.5 h-3.5" />
                            <span>Sign & Sweep L1 → Intents</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {blockers.length > 0 && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 space-y-1.5">
                      <div className="text-xs font-bold text-red-300">Resolve Before Upgrading</div>
                      <ul className="list-disc pl-4 space-y-1 text-[11px] text-red-200/90">
                        {blockers.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={loadPreflight}
                  disabled={loadingPreflight || sweepingL1}
                  className="px-3.5 py-2.5 rounded-xl border border-stone-700 text-xs text-stone-300 hover:bg-stone-800 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingPreflight ? 'animate-spin' : ''}`} />
                  <span>Re-check</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStage('backup_key')}
                  disabled={!preflight?.readyToUpgrade || sweepingL1}
                  className="flex-1 py-3 px-4 rounded-2xl bg-[#E05326] hover:bg-[#c8461d] text-white font-display font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>Continue to Recovery Key</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STAGE 2: BACKUP KEY GENERATION ──────────────────────── */}
          {stage === 'backup_key' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-100/90 leading-relaxed">
                Generated <strong>locally inside your browser</strong>. Only its derived public key (<code className="font-mono text-amber-200">ed25519:…</code>) leaves this device.
                If you lose your passkey, this key is your <strong>only</strong> way to authorize a replacement passkey.
              </div>

              <div className="rounded-2xl border border-stone-800 bg-stone-950 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400">
                    Offline Recovery Key
                  </span>
                  <button
                    type="button"
                    onClick={handleRegenerateKey}
                    className="text-[11px] text-stone-400 hover:text-stone-100 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regenerate</span>
                  </button>
                </div>
                <div className="font-mono text-xs sm:text-sm break-all text-emerald-300 bg-stone-900 border border-stone-800 rounded-xl p-3 select-all">
                  {recoveryPhrase || 'Generating…'}
                </div>
                <div className="text-[11px] font-mono text-stone-400 break-all">
                  Derived Public Key: <span className="text-stone-200">{backupPubkey}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyRecoveryKey}
                    className="py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadRecoveryKey}
                    className="py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {downloadedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
                    <span>{downloadedKey ? 'Downloaded' : 'Save .txt'}</span>
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-stone-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={savedConfirmed}
                  onChange={(e) => setSavedConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-stone-700 bg-stone-900 text-[#E05326] focus:ring-[#E05326]"
                />
                <span>
                  I have saved this offline <code className="font-mono">UP1-…</code> Recovery Key. I understand Uprail cannot recover a lost passkey without it.
                </span>
              </label>

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setStage('preflight')}
                  className="px-4 py-3 rounded-2xl border border-stone-700 text-xs text-stone-300 hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStage('confirm')}
                  disabled={!savedConfirmed || !backupPubkey}
                  className="flex-1 py-3 px-4 rounded-2xl bg-[#E05326] hover:bg-[#c8461d] text-white font-display font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>Continue to Final Signature</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STAGE 3: ATOMIC KEY ROTATION SIGNATURE ──────────────── */}
          {stage === 'confirm' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-stone-800 bg-stone-900/70 p-4 space-y-2.5 text-xs">
                <div className="font-bold text-stone-100">Atomic On-Chain Transition</div>
                <ul className="space-y-1.5 text-stone-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Add your Passkey P-256 public key(s) on <code className="font-mono">intents.near</code></span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Add your offline Recovery Key (<code className="font-mono truncate">{backupPubkey.slice(0, 22)}…</code>)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Remove Uprail&apos;s server key &amp; disable predecessor signing</span>
                  </li>
                </ul>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setStage('backup_key')}
                  disabled={isSubmitting}
                  className="px-4 py-3 rounded-2xl border border-stone-700 text-xs text-stone-300 hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleExecuteUpgrade}
                  disabled={isSubmitting}
                  className="flex-1 py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-display font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying &amp; Relaying…</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      <span>Sign with Passkey &amp; Upgrade</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── STAGE 4: SUCCESS ────────────────────────────────────── */}
          {stage === 'success' && upgradeResult && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-emerald-300">
                  <ShieldCheck className="w-4 h-4" />
                  <span>You now control 100% of your keys on-chain.</span>
                </div>
                <div className="font-mono text-[11px] text-stone-300 break-all">
                  Account: {upgradeResult.nearAccount}
                </div>
                {upgradeResult.txHash && (
                  <div className="font-mono text-[11px] text-stone-400 break-all">
                    Tx Hash: {upgradeResult.txHash}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <Link
                  to={`/verify?q=${encodeURIComponent(upgradeResult.nearAccount)}`}
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 font-display font-bold text-xs text-center transition-colors"
                >
                  Verify Keys On-Chain
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-2xl bg-stone-100 hover:bg-white text-stone-950 font-display font-bold text-xs transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
