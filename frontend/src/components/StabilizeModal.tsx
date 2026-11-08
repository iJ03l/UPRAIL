'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Copy,
  Fingerprint,
  Lock,
  RefreshCw,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import { Portal } from './Portal';
import { ConfirmDialog } from './ConfirmDialog';
import { AssetPicker } from './AssetPicker';
import { TokenIcon } from './TokenIcon';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useToast } from './Toast';
import {
  api,
  formatTokenAmount,
  formatUsd,
  tokenUsdPrice,
} from '../lib/api';
import { isIntentsSupportedToken } from './NearcomWithdrawModal';
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
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();

  // Filter to Intents/1Click-supported non-stablecoin tokens
  const convertibleTokens = useMemo(() => {
    const nonStables = tokens.filter(
      (t) => isIntentsSupportedToken(t) && !isStablecoinSymbol(t.symbol)
    );
    return nonStables.length > 0
      ? nonStables
      : tokens.filter((t) => !isStablecoinSymbol(t.symbol));
  }, [tokens]);

  // Quick-select pills: held non-stable tokens first, then NEAR / ETH / BTC / SOL
  const quickTokens = useMemo(() => {
    const out: Token[] = [];
    const seen = new Set<string>();

    for (const t of convertibleTokens) {
      const bal = parseFloat(t.balance || '0') || 0;
      const key = t.symbol.toUpperCase();
      if (bal > 0 && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }

    for (const sym of ['NEAR', 'ETH', 'SOL', 'BTC', 'ZEC']) {
      if (out.length >= 5) break;
      if (seen.has(sym)) continue;
      const match = convertibleTokens.find((t) => t.symbol.toUpperCase() === sym);
      if (match) {
        seen.add(sym);
        out.push(match);
      }
    }

    return out.slice(0, 5);
  }, [convertibleTokens]);

  const pickDefaultToken = (): Token | undefined => {
    if (initialToken && !isStablecoinSymbol(initialToken.symbol)) {
      const matched = convertibleTokens.find(
        (t) =>
          t.id.toLowerCase() === initialToken.id.toLowerCase() ||
          t.symbol.toUpperCase() === initialToken.symbol.toUpperCase()
      );
      if (matched) return matched;
      return initialToken;
    }
    const heldNonStable = convertibleTokens.find(
      (t) => (parseFloat(t.balance || '0') || 0) > 0
    );
    if (heldNonStable) return heldNonStable;
    return (
      convertibleTokens.find((t) => t.symbol.toUpperCase() === 'NEAR') ||
      convertibleTokens[0]
    );
  };

  const [selectedToken, setSelectedToken] = useState<Token | undefined>(pickDefaultToken);
  const [targetAsset, setTargetAsset] = useState<StabilizeTargetSymbol>('USDC');
  const [amount, setAmount] = useState<string>('');
  const [quote, setQuote] = useState<StabilizeQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [result, setResult] = useState<StabilizeResult | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  // Sync selectedToken with latest balances when modal opens or token list updates
  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setSubmitError(null);
    setQuoteError(null);

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
  }, [isOpen, initialToken?.id, initialAmount]);

  useEffect(() => {
    if (!selectedToken) return;
    const updated = convertibleTokens.find(
      (t) =>
        t.id.toLowerCase() === selectedToken.id.toLowerCase() ||
        t.symbol.toUpperCase() === selectedToken.symbol.toUpperCase()
    );
    if (updated && updated.balance !== selectedToken.balance) {
      setSelectedToken(updated);
    }
  }, [convertibleTokens, selectedToken]);

  const numericAmount = parseFloat(amount) || 0;
  const availableBalance = parseFloat(selectedToken?.balance || '0') || 0;
  const exceedsBalance = numericAmount > 0 && numericAmount > availableBalance + 1e-12;

  const estimatedInputUsd = useMemo(() => {
    if (!selectedToken || numericAmount <= 0) return null;
    const price = tokenUsdPrice(selectedToken);
    return price !== null ? numericAmount * price : null;
  }, [selectedToken, numericAmount]);

  // Live debounced 1Click quote calculation
  useEffect(() => {
    if (!isOpen || !selectedToken || numericAmount <= 0 || result) {
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
        const q = await api.getStabilizeQuote({
          sourceAsset: selectedToken.id || selectedToken.symbol,
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
        setQuoteError(err?.message || 'Could not calculate live 1Click quote.');
      } finally {
        if (!controller.signal.aborted) {
          setIsQuoting(false);
        }
      }
    }, 260);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, selectedToken?.id, selectedToken?.symbol, targetAsset, amount, numericAmount, result]);

  if (!isOpen) return null;

  const handleSelectPercentage = (pct: number) => {
    if (!selectedToken) return;
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
    if (!quote) {
      setSubmitError('Waiting for live 1Click quote calculation.');
      return;
    }
    setIsConfirmOpen(true);
  };

  const handleExecuteStabilize = async () => {
    if (!selectedToken || !quote) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const assertion = await authorizeWithPasskey(
        `Stabilize ${quote.grossAmount} ${selectedToken.symbol} to ${targetAsset}`
      );

      const isMax =
        selectedToken.balance &&
        amount.trim() === selectedToken.balance.trim();

      const res = await api.stabilizeAsset({
        sourceAsset: selectedToken.id || selectedToken.symbol,
        targetAsset,
        amount: isMax ? 'all' : amount.trim(),
        passkeyAssertion: assertion,
      });

      setIsConfirmOpen(false);
      setResult(res);
      toast(`Stabilized ${res.grossAmount} ${res.sourceSymbol} → ${res.amountOut} ${res.targetSymbol}`);
      onSuccess?.(res);
    } catch (err: any) {
      setIsConfirmOpen(false);
      setSubmitError(err?.message || 'Stabilization swap failed.');
    } finally {
      setIsSubmitting(false);
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
    <Portal>
      <div
        className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-fade-in"
        onClick={() => {
          if (!isSubmitting && !isAuthorizing) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stabilize-modal-title"
          className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl overflow-hidden animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isAuthorizing}
            className="absolute top-4 right-4 z-10 p-2 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-5 sm:p-6">
            {result ? (
              /* ── SUCCESS RECEIPT ── */
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-extrabold text-stone-950 tracking-tight">
                      Stabilized to {result.targetSymbol}
                    </h3>
                    <p className="text-[11px] font-mono text-stone-500">
                      Settled confidentially into your UPRAIL vault
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
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">Protocol Fee ({result.feePercent}%)</span>
                    <span className="text-stone-700">
                      {result.protocolFee} {result.sourceSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-stone-200/80">
                    <span className="text-stone-500">Credited to Vault</span>
                    <span className="text-sm font-extrabold text-emerald-700">
                      +{result.amountOut} {result.targetSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">Gas & Privacy</span>
                    <span className="text-emerald-700 font-bold">
                      $0.00 Sponsored · Confidential
                    </span>
                  </div>
                  {result.intentHash && (
                    <div className="flex items-center justify-between pt-2 border-t border-stone-200/80">
                      <span className="text-stone-500">Intent Hash</span>
                      <button
                        type="button"
                        onClick={() => handleCopyHash(result.intentHash)}
                        className="inline-flex items-center gap-1 text-stone-800 hover:text-black font-bold cursor-pointer"
                      >
                        <span>
                          {result.intentHash.slice(0, 8)}…{result.intentHash.slice(-6)}
                        </span>
                        {copiedHash ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-stone-400" />
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
            ) : (
              /* ── STABILIZE FORM ── */
              <form onSubmit={handleOpenConfirm} className="space-y-4">
                {/* Header */}
                <div className="flex items-center gap-3 pr-6">
                  <div className="w-10 h-10 rounded-2xl bg-stone-950 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                    <Sparkles className="w-5 h-5 text-orange-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        id="stabilize-modal-title"
                        className="text-lg font-display font-extrabold text-stone-950 tracking-tight"
                      >
                        Stabilize
                      </h3>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono font-bold text-stone-700">
                        <Lock className="w-2.5 h-2.5" />
                        1Click Confidential
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-stone-500 truncate">
                      Convert any token to USDC or USDT · Gas sponsored
                    </p>
                  </div>
                </div>

                {/* Source Token Quick Pills */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                      From Token
                    </span>
                    {selectedToken && (
                      <span className="text-[11px] font-mono text-stone-500">
                        Available:{' '}
                        <span className="font-bold text-stone-900">
                          {formatTokenAmount(selectedToken.balance || '0')} {selectedToken.symbol}
                        </span>
                      </span>
                    )}
                  </div>

                  {quickTokens.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {quickTokens.map((t) => {
                        const isSelected =
                          t.id.toLowerCase() === selectedToken?.id?.toLowerCase() ||
                          t.symbol.toUpperCase() === selectedToken?.symbol?.toUpperCase();
                        const bal = parseFloat(t.balance || '0') || 0;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedToken(t);
                              setSubmitError(null);
                              if ((parseFloat(t.balance || '0') || 0) > 0) {
                                setAmount(t.balance || '');
                              }
                            }}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-stone-950 text-white border-stone-950 font-bold shadow-xs'
                                : 'bg-stone-50 text-stone-800 border-stone-200 hover:border-stone-400'
                            }`}
                          >
                            <TokenIcon symbol={t.symbol} iconUrl={t.iconUrl} size="sm" />
                            <span>{t.symbol}</span>
                            {bal > 0 && (
                              <span
                                className={`text-[10px] ${
                                  isSelected ? 'text-stone-300' : 'text-stone-400'
                                }`}
                              >
                                {formatTokenAmount(t.balance)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Amount Input Box with AssetPicker */}
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 space-y-3 focus-within:border-stone-900 focus-within:ring-1 focus-within:ring-stone-900/10 focus-within:bg-white transition-all shadow-xs">
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
                      <AssetPicker
                        tokens={convertibleTokens}
                        selectedToken={selectedToken}
                        onSelectToken={(t) => {
                          setSelectedToken(t);
                          setSubmitError(null);
                          if ((parseFloat(t.balance || '0') || 0) > 0) {
                            setAmount(t.balance || '');
                          }
                        }}
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-stone-200">
                    <span className="text-xs font-mono text-stone-500">
                      {quote?.amountInUsd
                        ? `≈ ${formatUsd(parseFloat(quote.amountInUsd) / 0.99)} USD`
                        : estimatedInputUsd !== null
                        ? `≈ ${formatUsd(estimatedInputUsd)} USD`
                        : '—'}
                    </span>
                    <div className="flex items-center gap-1">
                      {[
                        { label: '25%', pct: 0.25 },
                        { label: '50%', pct: 0.5 },
                        { label: '75%', pct: 0.75 },
                        { label: 'MAX', pct: 1 },
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => handleSelectPercentage(btn.pct)}
                          className="px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-900 hover:text-white border border-stone-200 text-[10px] font-mono font-bold text-stone-700 transition-colors cursor-pointer"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Target Stablecoin Selector (1-Click Toggle: USDC vs USDT) */}
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-2.5">
                  <div className="flex items-center gap-2 pl-1">
                    <div className="w-6 h-6 rounded-lg bg-stone-200/80 text-stone-700 flex items-center justify-center">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
                      To Stablecoin
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

                {/* Live Accurate 1Click Quote Breakdown */}
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">You Receive (Est.)</span>
                    {isQuoting ? (
                      <span className="inline-flex items-center gap-1.5 text-stone-500">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Calculating 1Click route…</span>
                      </span>
                    ) : quote ? (
                      <span className="text-sm font-extrabold text-stone-950">
                        {quote.amountOut} {quote.targetSymbol}
                        {quote.amountOutUsd ? (
                          <span className="text-stone-400 font-normal text-[11px] ml-1">
                            (${Number(quote.amountOutUsd).toFixed(2)})
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </div>

                  {quote && (
                    <>
                      <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-stone-200/70">
                        <span className="text-stone-500">Rate</span>
                        <span className="text-stone-800 font-medium">
                          1 {quote.sourceSymbol} ≈ {quote.exchangeRate} {quote.targetSymbol}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-stone-500">Protocol Fee ({quote.feePercent}%)</span>
                        <span className="text-stone-800">
                          {quote.protocolFee} {quote.sourceSymbol}
                          {quote.protocolFeeUsd ? ` ($${quote.protocolFeeUsd})` : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-stone-500">Net Swapped (99%)</span>
                        <span className="text-stone-800">
                          {quote.netAmountIn} {quote.sourceSymbol}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-stone-500">Min. Received (1% slippage)</span>
                        <span className="text-stone-700">
                          {quote.minAmountOut} {quote.targetSymbol}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-stone-200/70">
                    <span className="text-stone-500">Gas & Execution</span>
                    <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      $0.00 Sponsored · Confidential
                    </span>
                  </div>
                </div>

                {/* Error Feedback */}
                {(exceedsBalance || quoteError || submitError) && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2 text-[11px] font-mono text-red-700">
                    <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 flex-shrink-0" />
                    <span>
                      {exceedsBalance
                        ? `Insufficient ${selectedToken?.symbol} balance. Available: ${formatTokenAmount(
                            selectedToken?.balance || '0'
                          )} ${selectedToken?.symbol}`
                        : submitError || quoteError}
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
                    isQuoting ||
                    !quote ||
                    isSubmitting ||
                    isAuthorizing
                  }
                  className="w-full py-3.5 px-4 rounded-2xl bg-stone-950 hover:bg-black text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {isSubmitting || isAuthorizing ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Stabilizing Confidentially…</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      <span>
                        Stabilize to {targetAsset}
                        {quote ? ` (${quote.amountOut} ${targetAsset})` : ''}
                      </span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Passkey Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        tone="financial"
        title="Confirm Confidential Stabilize"
        description="Review details below. Confirming will prompt your device passkey."
        details={[
          {
            label: 'Convert',
            value: `${quote?.grossAmount || amount} ${selectedToken?.symbol || ''}`,
            emphasis: true,
          },
          {
            label: `Protocol Fee (${quote?.feePercent ?? 1}%)`,
            value: `${quote?.protocolFee || '—'} ${selectedToken?.symbol || ''}`,
          },
          {
            label: 'Estimated Receive',
            value: `${quote?.amountOut || '—'} ${targetAsset} (min. ${quote?.minAmountOut || '—'} ${targetAsset})`,
            emphasis: true,
          },
          {
            label: 'Network Gas & Rail',
            value: '$0.00 (Sponsored · Confidential Intents)',
          },
        ]}
        confirmLabel="Confirm with Passkey"
        cancelLabel="Back"
        isLoading={isSubmitting || isAuthorizing}
        onConfirm={handleExecuteStabilize}
        onCancel={() => {
          if (!isSubmitting && !isAuthorizing) setIsConfirmOpen(false);
        }}
      />
    </Portal>
  );
};
