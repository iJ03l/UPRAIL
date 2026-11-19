'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  WarningCircle,
  ArrowDown,
  ArrowsLeftRight,
  Check,
  CheckCircle,
  Copy,
  Fingerprint,
  ArrowsClockwise,
  Shield,
} from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { ConfirmDialog } from './ConfirmDialog';
import { TokenIcon } from './TokenIcon';
import { useXAuth } from '../hooks/useXAuth';
import { useToast } from './Toast';
import {
  api,
  formatTokenAmount,
  formatUsd,
  tokenUsdPrice,
} from '../lib/api';
import type {
  StabilizeQuote,
  StabilizeResult,
  StabilizeTargetSymbol,
  Token,
} from '../types';

interface StabilizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  initialToken?: Token | null;
  initialAmount?: string;
  onSuccess?: (result: StabilizeResult) => void;
}

function isStablecoinSymbol(sym?: string): boolean {
  const upper = (sym || '').trim().toUpperCase();
  return upper === 'USDC' || upper === 'USDT';
}

export const StabilizeModal: React.FC<StabilizeModalProps> = ({
  isOpen,
  onClose,
  tokens,
  initialToken,
  initialAmount,
  onSuccess,
}) => {
  const { user } = useXAuth();
  const { toast } = useToast();

  // Strictly show only the non-stablecoin crypto that the user actually holds
  const heldTokens = useMemo(() => {
    const out: Token[] = [];
    const seen = new Set<string>();
    for (const t of tokens) {
      if (isStablecoinSymbol(t.symbol)) continue;
      const bal = parseFloat(t.balance || '0') || 0;
      if (bal <= 0) continue;
      const key = `${t.id.toLowerCase()}|${t.symbol.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [tokens]);

  const pickDefaultToken = (): Token | undefined => {
    if (initialToken && !isStablecoinSymbol(initialToken.symbol)) {
      const matched = heldTokens.find(
        (t) =>
          t.id.toLowerCase() === initialToken.id.toLowerCase() ||
          t.symbol.toUpperCase() === initialToken.symbol.toUpperCase()
      );
      if (matched) return matched;
      if ((parseFloat(initialToken.balance || '0') || 0) > 0) return initialToken;
    }
    return heldTokens[0];
  };

  const [selectedToken, setSelectedToken] = useState<Token | undefined>(pickDefaultToken);
  const [targetAsset, setTargetAsset] = useState<StabilizeTargetSymbol>('USDC');
  const [amount, setAmount] = useState<string>('');
  const [quote, setQuote] = useState<StabilizeQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressStep, setProgressStep] = useState<
    'idle' | 'authorizing' | 'submitting' | 'settling' | 'shielding' | 'success'
  >('idle');
  const [stepMessage, setStepMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [result, setResult] = useState<StabilizeResult | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    if (progressStep !== 'settling' && progressStep !== 'shielding') return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [progressStep]);

  // Sync selectedToken with latest held balances when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setSubmitError(null);
    setQuoteError(null);
    setProgressStep('idle');
    setStepMessage(null);
    setElapsedSeconds(0);

    const def = pickDefaultToken();
    setSelectedToken(def);

    if (initialAmount && parseFloat(initialAmount) > 0) {
      setAmount(initialAmount);
    } else if (def && (parseFloat(def.balance || '0') || 0) > 0) {
      setAmount(def.balance || '');
    } else {
      setAmount('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialToken?.id, initialAmount, heldTokens.length]);

  useEffect(() => {
    if (!selectedToken) return;
    const updated = heldTokens.find(
      (t) =>
        t.id.toLowerCase() === selectedToken.id.toLowerCase() ||
        t.symbol.toUpperCase() === selectedToken.symbol.toUpperCase()
    );
    if (updated && updated.balance !== selectedToken.balance) {
      setSelectedToken(updated);
    }
  }, [heldTokens, selectedToken]);

  const numericAmount = parseFloat(amount) || 0;
  const availableBalance = parseFloat(selectedToken?.balance || '0') || 0;
  const exceedsBalance = numericAmount > 0 && numericAmount > availableBalance + 1e-12;

  const estimatedInputUsd = useMemo(() => {
    if (!selectedToken || numericAmount <= 0) return null;
    const price = tokenUsdPrice(selectedToken);
    return price !== null ? numericAmount * price : null;
  }, [selectedToken, numericAmount]);

  const effectiveUsd = useMemo(() => {
    if (estimatedInputUsd !== null) return estimatedInputUsd;
    const qIn = quote?.amountInUsd ? parseFloat(quote.amountInUsd) : NaN;
    if (Number.isFinite(qIn) && qIn > 0) return qIn;
    const qOut = quote?.amountOutUsd ? parseFloat(quote.amountOutUsd) : NaN;
    return Number.isFinite(qOut) && qOut > 0 ? qOut : null;
  }, [estimatedInputUsd, quote]);

  const isNearSelected = useMemo(() => {
    if (!selectedToken) return false;
    const sym = selectedToken.symbol.toUpperCase();
    const id = (selectedToken.id || '').toLowerCase();
    return sym === 'NEAR' || sym === 'WNEAR' || id === 'nep141:wrap.near';
  }, [selectedToken]);

  const belowMinNear = isNearSelected && numericAmount > 0 && numericAmount < 0.05;
  const belowMinUsd = effectiveUsd !== null && numericAmount > 0 && effectiveUsd < 1;
  const belowMinimum = belowMinNear || belowMinUsd;
  const minimumErrorMessage = belowMinNear
    ? 'Minimum NEAR amount to stabilize is 0.05 NEAR.'
    : belowMinUsd
    ? 'Minimum amount to stabilize is $1.00 USD.'
    : null;

  const belowEstimatedMin =
    belowMinNear || (estimatedInputUsd !== null && numericAmount > 0 && estimatedInputUsd < 1);

  // Live debounced quote calculation (1Click or Rhea Finance)
  useEffect(() => {
    if (!isOpen || !selectedToken || numericAmount <= 0 || exceedsBalance || belowEstimatedMin || result) {
      setQuote(null);
      setQuoteError(null);
      setIsQuoting(false);
      return;
    }

    const controller = new AbortController();
    setIsQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const sourceId =
          selectedToken.id && selectedToken.id.startsWith('nep')
            ? selectedToken.id
            : selectedToken.nearContractId
            ? `nep141:${selectedToken.nearContractId}`
            : selectedToken.id || selectedToken.symbol;
        const q = await api.getStabilizeQuote({
          sourceAsset: sourceId,
          targetAsset,
          amount: amount.trim(),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setQuote(q);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(err?.message || 'Could not calculate live quote.');
      } finally {
        if (!controller.signal.aborted) {
          setIsQuoting(false);
        }
      }
    }, 240);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    isOpen,
    selectedToken?.id,
    selectedToken?.nearContractId,
    selectedToken?.symbol,
    targetAsset,
    amount,
    numericAmount,
    exceedsBalance,
    belowEstimatedMin,
    result,
  ]);

  const handleSelectPercentage = (pct: number) => {
    if (!selectedToken || isSubmitting) return;
    setSubmitError(null);
    if (pct >= 1) {
      setAmount(selectedToken.balance || '0');
      return;
    }
    const bal = parseFloat(selectedToken.balance || '0') || 0;
    if (bal <= 0) {
      setAmount('0');
      return;
    }
    const decimals = Math.min(selectedToken.decimals || 6, 8);
    const val = (bal * pct).toFixed(decimals).replace(/\.?0+$/, '');
    setAmount(val || '0');
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || isSubmitting) return;
    setSubmitError(null);
    if (!selectedToken) return;
    if (numericAmount <= 0) {
      setSubmitError('Enter an amount greater than zero.');
      return;
    }
    if (exceedsBalance) {
      setSubmitError(
        `Insufficient ${selectedToken.symbol} balance. Available: ${formatTokenAmount(
          selectedToken.balance || '0'
        )} ${selectedToken.symbol}`
      );
      return;
    }
    if (belowMinimum && minimumErrorMessage) {
      setSubmitError(minimumErrorMessage);
      return;
    }
    if (!quote) {
      setSubmitError('Waiting for live quote calculation.');
      return;
    }
    void handleExecuteStabilize();
  };

  const handleExecuteStabilize = async () => {
    if (submittingRef.current || !selectedToken || !quote || belowMinimum || exceedsBalance) return;
    if (user && user.custodyMode !== 'self') {
      setSubmitError('Please migrate your account to Passkey Self-Custody first.');
      return;
    }
    submittingRef.current = true;
    setSubmitError(null);
    setIsSubmitting(true);
    setProgressStep('authorizing');
    setStepMessage('Preparing self-custody swap…');
    setElapsedSeconds(0);

    try {
      const isMax =
        selectedToken.balance &&
        amount.trim() === selectedToken.balance.trim();

      const sourceId =
        selectedToken.id && selectedToken.id.startsWith('nep')
          ? selectedToken.id
          : selectedToken.nearContractId
          ? `nep141:${selectedToken.nearContractId}`
          : selectedToken.id || selectedToken.symbol;

      const res = await api.stabilizeAssetSelfCustody(
        {
          sourceAsset: sourceId,
          targetAsset,
          amount: isMax ? 'all' : amount.trim(),
        },
        (stage, message) => {
          setProgressStep(stage === 'submitting' ? 'submitting' : 'authorizing');
          if (message) setStepMessage(message);
        }
      );

      setIsConfirmOpen(false);

      const finishShieldIfNeeded = async (completedRes: StabilizeResult): Promise<StabilizeResult> => {
        if (completedRes.needsPostSwapShield) {
          setProgressStep('shielding');
          setStepMessage(`Confirm passkey to shield ${completedRes.targetSymbol} into private balance…`);
          await api.shieldPublicAssetSelfCustody({
            assetId: completedRes.targetAsset,
            expectedAmountAtomic: completedRes.minAmountOutAtomic || completedRes.amountOutAtomic,
            sourceSwapDepositAddress: completedRes.depositAddress,
            initialShieldPrepare: completedRes.shieldPrepare,
            onProgress: (_stage, message) => {
              setProgressStep('shielding');
              if (message) setStepMessage(message);
            },
          });
          return { ...completedRes, confidential: true, needsPostSwapShield: false };
        }
        return completedRes;
      };

      if (res.status === 'SUCCESS') {
        const finalRes = await finishShieldIfNeeded(res);
        setProgressStep('success');
        setStepMessage(null);
        setResult(finalRes);
        setIsSubmitting(false);
        toast(`Stabilized ${finalRes.grossAmount} ${finalRes.sourceSymbol} → ${finalRes.amountOut} ${finalRes.targetSymbol} (Confidential)`);
        onSuccess?.(finalRes);
        return;
      }

      // Enter settling mode with live polling against 1Click execution status
      setProgressStep('settling');
      setStepMessage(`Matching liquidity route for ${res.amountOut} ${res.targetSymbol}…`);
      const pollStart = Date.now();
      const depositAddress = res.depositAddress;

      let settled = false;
      while (Date.now() - pollStart < 60_000) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const statusRes = await api.getStabilizeStatus(depositAddress);
          const upper = (statusRes.status || '').toUpperCase();
          if (upper === 'SUCCESS') {
            settled = true;
            const completedResult = await finishShieldIfNeeded({ ...res, status: 'SUCCESS' });
            setProgressStep('success');
            setStepMessage(null);
            setResult(completedResult);
            setIsSubmitting(false);
            toast(`Stabilized ${completedResult.grossAmount} ${completedResult.sourceSymbol} → ${completedResult.amountOut} ${completedResult.targetSymbol} (Confidential)`);
            onSuccess?.(completedResult);
            break;
          }
          if (upper === 'FAILED' || upper === 'REFUNDED') {
            settled = true;
            setProgressStep('idle');
            setStepMessage(null);
            setIsSubmitting(false);
            setSubmitError(`1Click reported swap as ${upper.toLowerCase()}. Funds were safely refunded to your vault.`);
            break;
          }
        } catch {}
      }

      if (!settled) {
        // Safe timeout: intent was submitted and will finish asynchronously
        setProgressStep('success');
        setStepMessage(null);
        setResult(res);
        setIsSubmitting(false);
        toast(`Swap submitted! 1Click is settling ${res.amountOut} ${res.targetSymbol} in background.`);
        onSuccess?.(res);
      }
    } catch (err: any) {
      setProgressStep('idle');
      setStepMessage(null);
      setIsSubmitting(false);
      setIsConfirmOpen(false);
      setSubmitError(err?.message || 'Stabilization swap failed.');
    } finally {
      submittingRef.current = false;
    }
  };

  const handleCopyHash = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {}
  };

  return (
    <>
      <ModalSheet
        isOpen={isOpen}
        onClose={onClose}
        canClose={!isSubmitting && !isConfirmOpen}
        zIndexClass="z-[110]"
        maxWidthClass="sm:max-w-md"
        panelClassName="p-0"
        showCloseButton
        closeLabel="Close stabilize modal"
        ariaLabelledBy="stabilize-modal-title"
      >
        <div className="p-5 pt-2 sm:p-6">
            {result ? (
              /* ── SUCCESS RECEIPT ── */
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                    <CheckCircle weight="fill" className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-extrabold text-stone-950 tracking-tight">
                      Stabilized to {result.targetSymbol}
                    </h3>
                    <p className="text-[11px] font-mono text-stone-500">
                      Credited to your UPRAIL Intents balance
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 space-y-2.5 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">Converted</span>
                    <span className="font-bold text-stone-900">
                      {result.grossAmount} {result.sourceSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-stone-200/80">
                    <span className="text-stone-500">Credited to Vault</span>
                    <span className="text-sm font-extrabold text-emerald-700">
                      +{result.amountOut} {result.targetSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">Gas</span>
                    <span className="text-emerald-700 font-bold">
                      $0.00 Sponsored
                    </span>
                  </div>
                  {result.intentHash && (
                    <div className="flex items-center justify-between pt-2 border-t border-stone-200/80">
                      <span className="text-stone-500">Settlement Ref</span>
                      <button
                        type="button"
                        onClick={() => handleCopyHash(result.intentHash)}
                        className="inline-flex items-center gap-1 text-stone-800 hover:text-black font-bold cursor-pointer"
                      >
                        <span>
                          {result.intentHash.slice(0, 8)}…{result.intentHash.slice(-6)}
                        </span>
                        {copiedHash ? (
                          <Check weight="bold" className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy weight="fill" className="w-3 h-3 text-stone-400" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3.5 px-4 rounded-2xl bg-stone-950 hover:bg-black text-white text-xs font-display font-extrabold uppercase tracking-wider transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : isSubmitting && progressStep !== 'idle' ? (
              /* ── LIVE SETTLEMENT PROGRESS STEPPER ── */
              <div className="py-2 space-y-5 animate-fade-in">
                <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                      <ArrowsClockwise weight="bold" className="w-5 h-5 animate-spin text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-display font-bold text-stone-950">
                        {progressStep === 'authorizing'
                          ? 'Authorizing with Passkey...'
                          : progressStep === 'submitting'
                          ? 'Submitting Swap Intent...'
                          : progressStep === 'shielding'
                          ? `Shielding ${targetAsset} to Private Vault...`
                          : 'Settling with 1Click Solver...'}
                      </h3>
                      <p className="text-xs text-stone-500 font-mono mt-0.5 truncate">
                        {quote?.grossAmount} {selectedToken?.symbol} → {quote?.amountOut} {targetAsset}
                      </p>
                    </div>
                  </div>
                  {(progressStep === 'settling' || progressStep === 'shielding') && (
                    <Badge tone="ok">{elapsedSeconds}s</Badge>
                  )}
                </div>

                {stepMessage && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-2xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-mono text-emerald-900 flex items-center gap-2"
                  >
                    <ArrowsClockwise weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    <span>{stepMessage}</span>
                  </div>
                )}

                {/* Progress Steps */}
                <div className="space-y-3.5 px-1">
                  {/* Step 1: Passkey Authorization */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        progressStep === 'authorizing'
                          ? 'bg-emerald-500 text-white animate-pulse'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {progressStep === 'authorizing' ? (
                        <Fingerprint weight="bold" className="w-3.5 h-3.5" />
                      ) : (
                        <Check weight="bold" className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <span className="text-xs font-mono font-medium text-stone-800">
                      Passkey Transaction Signature
                    </span>
                  </div>

                  {/* Step 2: Intent Submission */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        progressStep === 'authorizing'
                          ? 'bg-stone-200 text-stone-400'
                          : progressStep === 'submitting'
                          ? 'bg-emerald-500 text-white animate-pulse'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {progressStep === 'authorizing' ? (
                        '2'
                      ) : progressStep === 'submitting' ? (
                        <ArrowsClockwise weight="bold" className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check weight="bold" className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <span
                      className={`text-xs font-mono font-medium ${
                        progressStep === 'authorizing' ? 'text-stone-400' : 'text-stone-800'
                      }`}
                    >
                      Intent Submitted to 1Click Relay (Gas Sponsored)
                    </span>
                  </div>

                  {/* Step 3: Solver Match & Settlement */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        progressStep === 'settling'
                          ? 'bg-emerald-500 text-white ring-4 ring-emerald-100'
                          : progressStep === 'shielding'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-stone-200 text-stone-400'
                      }`}
                    >
                      {progressStep === 'settling' ? (
                        <ArrowsClockwise weight="bold" className="w-3 h-3 animate-spin" />
                      ) : progressStep === 'shielding' ? (
                        <Check weight="bold" className="w-3.5 h-3.5" />
                      ) : (
                        '3'
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-xs font-mono font-medium ${
                          progressStep === 'settling'
                            ? 'text-stone-950 font-bold'
                            : progressStep === 'shielding'
                            ? 'text-stone-800'
                            : 'text-stone-400'
                        }`}
                      >
                        Solver Matching &amp; Settling {targetAsset}
                      </span>
                      {progressStep === 'settling' && (
                        <p className="text-[11px] font-mono text-stone-500 mt-0.5">
                          Defuser solvers matching liquidity route. Safe to leave open.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Step 4: Post-swap Shielding (only shown when active) */}
                  {progressStep === 'shielding' && (
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-emerald-500 text-white ring-4 ring-emerald-100">
                        <Fingerprint weight="bold" className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono font-bold text-stone-950">
                          Shielding {targetAsset} into Confidential Vault
                        </span>
                        <p className="text-[11px] font-mono text-stone-500 mt-0.5">
                          Confirm passkey once more to move settled {targetAsset} into private balance.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3 text-[11px] font-mono text-stone-500 flex items-center gap-2">
                  <Shield weight="fill" className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Confidential Intents swap. Your vault balances update automatically once filled.</span>
                </div>
              </div>
            ) : (
              /* ── MINIMAL STABILIZE FORM ── */
              <form onSubmit={handleOpenConfirm} className="space-y-4">
                {/* Header */}
                <div className="flex items-center gap-3 pr-6">
                  <div className="w-10 h-10 rounded-2xl bg-stone-950 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                    <ArrowsLeftRight weight="bold" className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      id="stabilize-modal-title"
                      className="text-lg font-display font-extrabold text-stone-950 tracking-tight"
                    >
                      Stabilize
                    </h3>
                    <p className="text-[11px] font-mono text-stone-500 truncate">
                      Convert held crypto to USDC or USDT · Gas sponsored
                    </p>
                  </div>
                </div>

                {heldTokens.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 p-6 text-center space-y-1.5">
                    <p className="text-xs font-display font-bold text-stone-800">
                      No non-stable crypto in your account
                    </p>
                    <p className="text-[11px] font-mono text-stone-500">
                      Deposit or receive crypto into your UPRAIL account to stabilize into USDC or USDT.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Held Crypto Pills (only what the user actually holds) */}
                    <div className="flex flex-wrap gap-1.5">
                      {heldTokens.map((t) => {
                        const isSelected =
                          t.id.toLowerCase() === selectedToken?.id?.toLowerCase() ||
                          t.symbol.toUpperCase() === selectedToken?.symbol?.toUpperCase();
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedToken(t);
                              setSubmitError(null);
                              setAmount(t.balance || '');
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-stone-950 text-white border-stone-950 font-bold shadow-xs'
                                : 'bg-stone-50 text-stone-800 border-stone-200 hover:border-stone-400'
                            }`}
                          >
                            <TokenIcon symbol={t.symbol} iconUrl={t.iconUrl} size="sm" />
                            <span>{t.symbol}</span>
                            <span
                              className={`text-[10px] ${
                                isSelected ? 'text-stone-300' : 'text-stone-400'
                              }`}
                            >
                              {formatTokenAmount(t.balance)}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Amount Input Box */}
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 space-y-2.5 focus-within:border-stone-900 focus-within:ring-1 focus-within:ring-stone-900/10 focus-within:bg-white transition-all shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => {
                            let v = e.target.value.replace(/[^0-9.]/g, '');
                            if (v.startsWith('.')) v = '0' + v;
                            if ((v.match(/\./g) || []).length <= 1) {
                              setAmount(v);
                              setSubmitError(null);
                            }
                          }}
                          placeholder="0.00"
                          className="w-full bg-transparent text-2xl sm:text-3xl font-display font-extrabold text-stone-950 placeholder:text-stone-400 focus:outline-none tabular-nums"
                        />
                        {selectedToken && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-mono font-bold text-stone-900 flex-shrink-0">
                            <TokenIcon
                              symbol={selectedToken.symbol}
                              iconUrl={selectedToken.iconUrl}
                              size="sm"
                            />
                            <span>{selectedToken.symbol}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-200/80">
                        <span className="text-xs font-mono text-stone-500">
                          {quote?.amountOutUsd
                            ? `≈ ${formatUsd(parseFloat(quote.amountOutUsd))} USD`
                            : estimatedInputUsd !== null
                            ? `≈ ${formatUsd(estimatedInputUsd)} USD`
                            : '—'}
                        </span>
                        <div className="flex items-center gap-1">
                          {[
                            { label: '25%', pct: 0.25 },
                            { label: '50%', pct: 0.5 },
                            { label: 'MAX', pct: 1 },
                          ].map((btn) => (
                            <button
                              key={btn.label}
                              type="button"
                              onClick={() => handleSelectPercentage(btn.pct)}
                              className="px-2 py-0.5 rounded-lg bg-stone-200/70 hover:bg-stone-900 hover:text-white text-[10px] font-mono font-bold text-stone-700 transition-colors cursor-pointer"
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Target Stablecoin Selector (USDC vs USDT) */}
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-2.5">
                      <div className="flex items-center gap-2 pl-1">
                        <div className="w-6 h-6 rounded-lg bg-stone-200/80 text-stone-700 flex items-center justify-center">
                          <ArrowDown weight="bold" className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
                          To
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {(['USDC', 'USDT'] as const).map((sym) => {
                          const active = targetAsset === sym;
                          return (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => setTargetAsset(sym)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                                active
                                  ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                                  : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400'
                              }`}
                            >
                              <TokenIcon symbol={sym} size="sm" />
                              <span>{sym}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Minimal Quote Summary */}
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">You Receive (Est.)</span>
                        {isQuoting ? (
                          <span className="inline-flex items-center gap-1.5 text-stone-500">
                            <ArrowsClockwise weight="bold" className="w-3 h-3 animate-spin" />
                            <span>Calculating…</span>
                          </span>
                        ) : quote ? (
                          <span className="text-sm font-extrabold text-stone-950">
                            {quote.amountOut} {quote.targetSymbol}
                          </span>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </div>

                      {quote && (
                        <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-stone-200/70">
                          <span className="text-stone-500">Min. Received (5% slippage)</span>
                          <span className="text-stone-700 font-medium">
                            {quote.minAmountOut} {quote.targetSymbol}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-stone-200/70">
                        <span className="text-stone-500">Gas</span>
                        <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                          <Shield weight="fill" className="w-3 h-3" />
                          $0.00 Sponsored
                        </span>
                      </div>
                    </div>

                    {/* Error Feedback */}
                    {(exceedsBalance || belowMinimum || quoteError || submitError) && (
                      <div className="max-w-full overflow-hidden rounded-xl bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2 text-[11px] font-mono text-red-700">
                        <WarningCircle weight="fill" className="w-3.5 h-3.5 text-red-600 mt-0.5 flex-shrink-0" />
                        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                          {exceedsBalance
                            ? `Insufficient ${selectedToken?.symbol} balance. Available: ${formatTokenAmount(
                                selectedToken?.balance || '0'
                              )} ${selectedToken?.symbol}`
                            : minimumErrorMessage || submitError || quoteError}
                        </span>
                      </div>
                    )}

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={
                        !selectedToken ||
                        numericAmount <= 0 ||
                        exceedsBalance ||
                        belowMinimum ||
                        isQuoting ||
                        !quote ||
                        isSubmitting
                      }
                      className="relative overflow-hidden w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 border border-emerald-700/80 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm group"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none select-none absolute inset-0 overflow-hidden font-mono text-[7px] leading-[8.5px] tracking-[0.14em] text-white/15 group-hover:text-white/25 whitespace-pre flex flex-col justify-between py-0.5 transition-colors"
                      >
                        <span>╔══╬░▒▓█═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░╬══╗</span>
                        <span>║░▒▓█╬──┼──1CLICK──┼──INTENTS──┼──USDC/USDT──┼──╬█▓▒░▒▓║</span>
                        <span>╠══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓═╣</span>
                        <span>║▓▒░╬──┼──SHIELDED──┼──0.00 GAS──┼──STABILIZE──┼──╬░▒▓█║</span>
                        <span>╚══╬░▒▓█═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░╬══╝</span>
                      </span>
                      {isSubmitting ? (
                        <span className="relative z-10 inline-flex items-center gap-2 drop-shadow-xs">
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>{stepMessage || 'Stabilizing…'}</span>
                        </span>
                      ) : (
                        <span className="relative z-10 inline-flex items-center gap-2 drop-shadow-xs">
                          <Fingerprint weight="bold" className="w-4 h-4" />
                          <span>
                            Stabilize to {targetAsset}
                            {quote ? ` (${quote.amountOut} ${targetAsset})` : ''}
                          </span>
                        </span>
                      )}
                    </button>
                  </>
                )}
              </form>
            )}
        </div>
      </ModalSheet>

      {/* Passkey Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        tone="financial"
        title={`Confirm Stabilize to ${targetAsset}`}
        description="Confirming will prompt your device passkey."
        details={[
          {
            label: 'Convert',
            value: `${quote?.grossAmount || amount} ${selectedToken?.symbol || ''}`,
            emphasis: true,
          },
          {
            label: 'Estimated Receive',
            value: `${quote?.amountOut || '—'} ${targetAsset} (min. ${quote?.minAmountOut || '—'} ${targetAsset})`,
            emphasis: true,
          },
          {
            label: 'Network Gas',
            value: '$0.00 (Sponsored)',
          },
        ]}
        confirmLabel="Confirm with Passkey"
        cancelLabel="Back"
        isLoading={isSubmitting}
        loadingLabel={stepMessage}
        onConfirm={handleExecuteStabilize}
        onCancel={() => {
          if (!isSubmitting) setIsConfirmOpen(false);
        }}
      />
    </>
  );
};
