'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Edit3,
  ExternalLink,
  Fingerprint,
  Lock,
  Shield,
  Sparkles,
  X,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { Portal } from './Portal';
import { ConfirmDialog } from './ConfirmDialog';
import { AssetPicker } from './AssetPicker';
import { TokenIcon } from './TokenIcon';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useToast } from './Toast';
import {
  api,
  cleanMemeSymbol,
  formatTokenAmount,
  formatUsd,
  tokenUsdPrice,
} from '../lib/api';
import type {
  NearcomDestination,
  NearcomWithdrawResponse,
  Token,
} from '../types';

interface NearcomWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  onSuccess?: () => void;
}

const ETH_IMPLICIT_RE = /^0x[0-9a-f]{40}$/;
const NEAR_IMPLICIT_RE = /^[0-9a-f]{64}$/;
const NEAR_NAMED_RE =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)+$/;

const NON_INTENTS_CONTRACT_HINTS = [
  'meme-cooking',
  'nearlytrade',
  'nearlytrader',
  'nearlypad',
  'cookinglabs',
  'launchpad.justhoot',
];

/** Filters tokens to assets supported by NEAR Intents (excluding native-only launchpad contracts). */
export function isIntentsSupportedToken(token: Token): boolean {
  const contract = (token.nearContractId || token.id || '').toLowerCase();
  if (!contract) return false;
  return !NON_INTENTS_CONTRACT_HINTS.some((hint) => contract.includes(hint));
}

/** Client-side validator matching worker/src/services/nearcomWithdraw.ts */
export function validateNearcomAddressInput(raw: string): {
  valid: boolean;
  nearcomAddress: string;
  intentsAccountId: string;
  error: string | null;
} {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      nearcomAddress: '',
      intentsAccountId: '',
      error: null,
    };
  }

  const withoutScheme = trimmed.replace(/^nearcom:/i, '').trim();
  if (!withoutScheme || withoutScheme.includes(':')) {
    return {
      valid: false,
      nearcomAddress: '',
      intentsAccountId: '',
      error: 'Invalid format. Copy your internal address from near.com (e.g. nearcom:0x…).',
    };
  }

  const lower = withoutScheme.toLowerCase();
  const isEth = ETH_IMPLICIT_RE.test(lower);
  const isHex64 = NEAR_IMPLICIT_RE.test(lower);
  const isNamed = lower.length >= 2 && lower.length <= 64 && NEAR_NAMED_RE.test(lower);

  if (!isEth && !isHex64 && !isNamed) {
    return {
      valid: false,
      nearcomAddress: '',
      intentsAccountId: '',
      error: 'Expected nearcom:0x… (42 chars), a 64-character hex address, or a .near account.',
    };
  }

  if (
    lower === 'intents.near' ||
    lower === 'escrow.uprail.near' ||
    lower === 'uprail.near' ||
    lower.endsWith('.escrow.uprail.near') ||
    lower.endsWith('.uprail.near')
  ) {
    return {
      valid: false,
      nearcomAddress: '',
      intentsAccountId: '',
      error: 'That is an internal UPRAIL vault address — paste your personal near.com address instead.',
    };
  }

  return {
    valid: true,
    nearcomAddress: `nearcom:${lower}`,
    intentsAccountId: lower,
    error: null,
  };
}

function shortenNearcomAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 24) return addr;
  const prefix = addr.startsWith('nearcom:') ? 'nearcom:' : '';
  const body = prefix ? addr.slice(prefix.length) : addr;
  if (body.length <= 16) return addr;
  return `${prefix}${body.slice(0, 6)}…${body.slice(-4)}`;
}

type ModalMode = 'loading' | 'setup' | 'edit' | 'withdraw' | 'success';

export const NearcomWithdrawModal: React.FC<NearcomWithdrawModalProps> = ({
  isOpen,
  onClose,
  tokens,
  onSuccess,
}) => {
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<ModalMode>('loading');
  const [destination, setDestination] = useState<NearcomDestination | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  // Strictly show only Intents-supported tokens that the user actually holds
  const intentsTokens = useMemo(() => {
    const out: Token[] = [];
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!isIntentsSupportedToken(t)) continue;
      const bal = parseFloat(t.balance || '0') || 0;
      if (bal <= 0) continue;
      const key = `${t.id.toLowerCase()}|${t.symbol.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [tokens]);

  const quickTokens = intentsTokens;

  const [selectedToken, setSelectedToken] = useState<Token | undefined>(() => {
    const usdc = intentsTokens.find(
      (t) => t.symbol.toUpperCase() === 'USDC' && (parseFloat(t.balance || '0') || 0) > 0
    );
    return usdc || intentsTokens[0];
  });

  const [amount, setAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [receipt, setReceipt] = useState<NearcomWithdrawResponse | null>(null);
  const [copiedDest, setCopiedDest] = useState(false);

  // Sync selectedToken with fresh balance updates from parent
  useEffect(() => {
    const updated = intentsTokens.find(
      (t) =>
        t.id.toLowerCase() === selectedToken?.id?.toLowerCase() ||
        t.symbol.toUpperCase() === selectedToken?.symbol?.toUpperCase()
    );
    if (updated) {
      setSelectedToken(updated);
    } else if (intentsTokens.length > 0) {
      setSelectedToken(intentsTokens[0]);
    } else {
      setSelectedToken(undefined);
    }
  }, [intentsTokens]);

  // Load saved near.com destination when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setAddressError(null);
    setWithdrawError(null);
    setShowConfirm(false);
    setReceipt(null);

    if (destination) {
      setMode('withdraw');
    } else {
      setMode('loading');
    }

    api
      .getNearcomDestination()
      .then((res) => {
        if (cancelled) return;
        if (res.configured && res.destination) {
          setDestination(res.destination);
          setAddressInput(res.destination.nearcomAddress);
          setMode('withdraw');
        } else {
          setDestination(null);
          setAddressInput('');
          setMode('setup');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[NearcomWithdrawModal] load destination error:', err);
        setMode(destination ? 'withdraw' : 'setup');
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Close on Escape when not busy or in confirmation dialog
  useEffect(() => {
    if (!isOpen || showConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSavingAddress && !isWithdrawing && !isAuthorizing) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, showConfirm, isSavingAddress, isWithdrawing, isAuthorizing, onClose]);

  const parsedInput = useMemo(
    () => validateNearcomAddressInput(addressInput),
    [addressInput]
  );

  const availableBalance = useMemo(() => {
    const raw = parseFloat(selectedToken?.balance || '0');
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }, [selectedToken]);

  const numericAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const amountUsd = useMemo(() => {
    if (numericAmount <= 0) return null;
    const price = tokenUsdPrice(selectedToken);
    if (price !== null) return numericAmount * price;
    if (['USDC', 'USDT', 'DAI', 'FRAX'].includes((selectedToken?.symbol || '').toUpperCase())) {
      return numericAmount;
    }
    return null;
  }, [numericAmount, selectedToken]);

  const exceedsBalance = numericAmount > availableBalance + 1e-9;
  const canReviewWithdraw =
    Boolean(destination) &&
    Boolean(selectedToken) &&
    numericAmount > 0 &&
    !exceedsBalance &&
    !isWithdrawing &&
    !isAuthorizing;

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setAddressInput(text.trim());
        setAddressError(null);
      }
    } catch {
      toast('Paste manually with Ctrl+V or long-press');
    }
  };

  const handleSaveDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddressError(null);
    if (!parsedInput.valid) {
      setAddressError(parsedInput.error || 'Enter a valid near.com internal address.');
      return;
    }

    setIsSavingAddress(true);
    try {
      const assertion = await authorizeWithPasskey(
        `Set near.com withdrawal address to ${parsedInput.nearcomAddress}`
      );
      const res = await api.saveNearcomDestination({
        address: parsedInput.nearcomAddress,
        passkeyAssertion: assertion,
      });
      setDestination(res.destination);
      setAddressInput(res.destination.nearcomAddress);
      toast(
        mode === 'edit'
          ? 'near.com withdrawal address updated'
          : 'near.com internal withdrawal set up!'
      );
      setMode('withdraw');
    } catch (err: any) {
      setAddressError(err?.message || 'Could not save near.com withdrawal address');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleSelectPercentage = (pct: number) => {
    setWithdrawError(null);
    if (availableBalance <= 0) {
      setAmount('0');
      return;
    }
    if (pct >= 1) {
      // Exact string balance from token to avoid float rounding
      const exact = (selectedToken?.balance || '').trim();
      setAmount(exact && parseFloat(exact) > 0 ? exact : String(availableBalance));
      return;
    }
    const raw = availableBalance * pct;
    const decimals = Math.min(selectedToken?.decimals || 6, 8);
    const formatted = raw.toFixed(decimals).replace(/\.?0+$/, '');
    setAmount(formatted || '0');
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    if (!canReviewWithdraw) return;
    setShowConfirm(true);
  };

  const handleExecuteWithdraw = async () => {
    if (!destination || !selectedToken || numericAmount <= 0) return;
    setWithdrawError(null);
    setIsWithdrawing(true);

    try {
      const assertion = await authorizeWithPasskey(
        `Withdraw ${amount} ${selectedToken.symbol} to ${destination.nearcomAddress}`
      );
      const result = await api.withdrawToNearcom({
        asset: selectedToken.id || selectedToken.symbol,
        amount: amount.trim(),
        expectedDestination: destination.nearcomAddress,
        passkeyAssertion: assertion,
      });
      setShowConfirm(false);
      setReceipt(result);
      setMode('success');
      setAmount('');
      toast(`Withdrew ${result.amount} ${result.asset} to near.com`);
      onSuccess?.();
    } catch (err: any) {
      setShowConfirm(false);
      setWithdrawError(err?.message || 'Withdrawal to near.com failed');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleCopyDestination = () => {
    if (!destination) return;
    navigator.clipboard.writeText(destination.nearcomAddress);
    setCopiedDest(true);
    toast('Copied near.com address');
    setTimeout(() => setCopiedDest(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <>
      <Portal>
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md"
          onMouseDown={(e) => {
            if (
              e.target === e.currentTarget &&
              !isSavingAddress &&
              !isWithdrawing &&
              !isAuthorizing &&
              !showConfirm
            ) {
              onClose();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nearcom-modal-title"
            className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 animate-fade-in max-h-[92vh] overflow-y-auto"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              disabled={isSavingAddress || isWithdrawing || isAuthorizing}
              aria-label="Close modal"
              className="absolute top-4 right-4 p-1.5 rounded-full text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            {/* ── MODE: LOADING ── */}
            {mode === 'loading' && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
                <div className="w-10 h-10 rounded-2xl bg-stone-100 flex items-center justify-center">
                  <span className="w-4 h-4 border-2 border-stone-900 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-xs font-mono text-stone-500">
                  Checking near.com internal withdrawal setup…
                </p>
              </div>
            )}

            {/* ── MODE: FIRST-TIME SETUP or EDIT DESTINATION ── */}
            {(mode === 'setup' || mode === 'edit') && (
              <form onSubmit={handleSaveDestination} className="space-y-4">
                <div className="flex items-center gap-3 pr-6">
                  {mode === 'edit' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAddressError(null);
                        setAddressInput(destination?.nearcomAddress || '');
                        setMode('withdraw');
                      }}
                      className="w-10 h-10 rounded-2xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-800 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                      title="Back to Withdraw"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  ) : (
                    <div className="w-10 h-10 rounded-2xl bg-stone-900 text-white flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3
                      id="nearcom-modal-title"
                      className="text-lg font-display font-extrabold text-stone-950 tracking-tight"
                    >
                      {mode === 'edit'
                        ? 'Edit near.com Address'
                        : 'near.com Withdrawal Address'}
                    </h3>
                    <p className="text-xs text-stone-500">
                      Paste your internal address from near.com
                    </p>
                  </div>
                </div>

                {/* Compact Instructions */}
                <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3 text-[11px] text-stone-600 space-y-1">
                  <div className="font-mono font-bold text-stone-800 uppercase tracking-wider text-[10px]">
                    How to find it:
                  </div>
                  <p>
                    On <span className="font-semibold text-stone-900">near.com</span>, go to <span className="font-semibold text-stone-900">Account Menu → My address</span> and copy your internal address (<span className="font-mono text-stone-800">nearcom:0x…</span>).
                  </p>
                </div>

                {/* Address input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="nearcom-address-input"
                      className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500"
                    >
                      Internal Address
                    </label>
                    <button
                      type="button"
                      onClick={handlePasteClipboard}
                      className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-stone-700 hover:text-black px-2 py-0.5 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
                    >
                      <ClipboardPaste className="w-3 h-3" />
                      <span>Paste</span>
                    </button>
                  </div>

                  <input
                    id="nearcom-address-input"
                    type="text"
                    value={addressInput}
                    onChange={(e) => {
                      setAddressInput(e.target.value);
                      setAddressError(null);
                    }}
                    placeholder="nearcom:0xb137a2f1054b5de422a8df801613d6722701163c"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full px-3.5 py-2.5 rounded-2xl border border-stone-200 bg-stone-50/50 text-xs font-mono text-stone-950 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:bg-white transition-colors"
                  />

                  {/* Live validation feedback */}
                  {parsedInput.valid && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 flex items-center gap-2 text-[11px] font-mono text-emerald-900">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="truncate">Valid near.com address</span>
                    </div>
                  )}

                  {(addressError || (addressInput.trim() && parsedInput.error)) && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-1.5 flex items-start gap-2 text-[11px] font-mono text-red-700">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 flex-shrink-0" />
                      <span className="break-words">{addressError || parsedInput.error}</span>
                    </div>
                  )}
                </div>

                {/* Submit button */}
                <div className="pt-1 flex items-center gap-2">
                  {mode === 'edit' && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddressError(null);
                        setAddressInput(destination?.nearcomAddress || '');
                        setMode('withdraw');
                      }}
                      disabled={isSavingAddress || isAuthorizing}
                      className="py-3 px-4 rounded-2xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-display font-bold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!parsedInput.valid || isSavingAddress || isAuthorizing}
                    className="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingAddress || isAuthorizing ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Verifying…</span>
                      </>
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        <span>{mode === 'edit' ? 'Update Address' : 'Save Address'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ── MODE: WITHDRAW ── */}
            {mode === 'withdraw' && destination && (
              <form onSubmit={handleOpenConfirm} className="space-y-4">
                {/* Header */}
                <div className="flex items-center gap-3 pr-6">
                  <div className="w-10 h-10 rounded-2xl bg-stone-950 text-white flex items-center justify-center flex-shrink-0">
                    <ArrowUpRight className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      id="nearcom-modal-title"
                      className="text-lg font-display font-extrabold text-stone-950 tracking-tight"
                    >
                      Withdraw to near.com
                    </h3>
                  </div>
                </div>

                {/* Saved Destination Card + Edit Button */}
                <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                      Destination
                    </div>
                    <div
                      className="text-xs font-mono font-bold text-stone-950 truncate"
                      title={destination.nearcomAddress}
                    >
                      {shortenNearcomAddress(destination.nearcomAddress)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyDestination}
                      className="p-1.5 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
                      title="Copy address"
                    >
                      {copiedDest ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddressError(null);
                        setAddressInput(destination.nearcomAddress);
                        setMode('edit');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-stone-200 bg-white hover:border-stone-900 text-[11px] font-mono font-bold text-stone-800 hover:text-black transition-all cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>

                {quickTokens.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 p-6 text-center space-y-1.5">
                    <p className="text-xs font-display font-bold text-stone-800">
                      No Intents balance available
                    </p>
                    <p className="text-[11px] font-mono text-stone-500">
                      Stabilize native tokens into USDC/USDT first or receive funds into your UPRAIL account.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Held Asset Pills */}
                    <div className="flex flex-wrap gap-1.5">
                      {quickTokens.map((t) => {
                        const isSelected =
                          t.id.toLowerCase() === selectedToken?.id?.toLowerCase() ||
                          t.symbol.toUpperCase() === selectedToken?.symbol?.toUpperCase();
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedToken(t);
                              setWithdrawError(null);
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
                              setWithdrawError(null);
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
                          {amountUsd !== null ? `≈ ${formatUsd(amountUsd)} USD` : '—'}
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

                    {/* Concise Summary */}
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 flex items-center justify-between text-xs font-mono">
                      <span className="text-stone-500">
                        Gas: <strong className="text-emerald-700 font-bold">$0.00 Sponsored</strong>
                      </span>
                      {numericAmount > 0 && (
                        <span className="text-stone-900 font-bold">
                          Receive: {amount} {selectedToken?.symbol}
                        </span>
                      )}
                    </div>

                    {/* Error Feedback */}
                    {(exceedsBalance || withdrawError) && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2 text-[11px] font-mono text-red-700">
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 flex-shrink-0" />
                        <span>
                          {exceedsBalance
                            ? `Insufficient ${selectedToken?.symbol} balance. Available: ${formatTokenAmount(
                                selectedToken?.balance || '0'
                              )} ${selectedToken?.symbol}`
                            : withdrawError}
                        </span>
                      </div>
                    )}

                    {/* Review Withdrawal CTA (Opens Confirmation Modal) */}
                    <button
                      type="submit"
                      disabled={!canReviewWithdraw}
                      className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Fingerprint className="w-4 h-4" />
                      <span>Withdraw to near.com</span>
                    </button>
                  </>
                )}
              </form>
            )}

            {/* ── MODE: SUCCESS RECEIPT ── */}
            {mode === 'success' && receipt && (
              <div className="space-y-5 py-2">
                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-display font-extrabold text-stone-950">
                    {receipt.status === 'COMPLETED'
                      ? 'Withdrawn to near.com!'
                      : 'Withdrawal Submitted!'}
                  </h3>
                  <p className="text-xs text-stone-500 font-mono break-all px-2">
                    {receipt.amount} {cleanMemeSymbol(receipt.asset) || receipt.asset} → {shortenNearcomAddress(receipt.destinationAddress)}
                  </p>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-stone-50 divide-y divide-stone-200 text-xs font-mono">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-stone-500">Amount</span>
                    <span className="font-bold text-stone-950">
                      {receipt.amount} {cleanMemeSymbol(receipt.asset) || receipt.asset}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <span className="text-stone-500 flex-shrink-0">Destination</span>
                    <span className="font-semibold text-stone-800 truncate max-w-[200px] text-right" title={receipt.destinationAddress}>
                      {shortenNearcomAddress(receipt.destinationAddress)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-stone-500">Status</span>
                    <span className="font-bold text-emerald-700">{receipt.status}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {receipt.shareLink && (
                    <a
                      href={receipt.shareLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-3 px-4 rounded-2xl border border-stone-200 hover:border-stone-900 text-stone-800 text-xs font-display font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>View Receipt</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-3 px-4 rounded-2xl bg-stone-950 hover:bg-black text-white text-xs font-display font-extrabold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Portal>

      {/* ── CONFIRMATION MODAL (Passkey Gated) ── */}
      {destination && selectedToken && (
        <ConfirmDialog
          isOpen={showConfirm}
          tone="financial"
          title="Confirm near.com Withdrawal"
          description="Review details below. Confirming will prompt your device passkey."
          details={[
            {
              label: 'Withdraw',
              value: `${amount} ${selectedToken.symbol}${
                amountUsd !== null ? ` (≈ ${formatUsd(amountUsd)})` : ''
              }`,
              emphasis: true,
            },
            {
              label: 'Destination',
              value: destination.nearcomAddress,
            },
            {
              label: 'Network Fee',
              value: '0.00 (Sponsored)',
            },
          ]}
          confirmLabel="Confirm with Passkey"
          cancelLabel="Back"
          isLoading={isWithdrawing || isAuthorizing}
          onConfirm={handleExecuteWithdraw}
          onCancel={() => {
            if (!isWithdrawing && !isAuthorizing) setShowConfirm(false);
          }}
        />
      )}
    </>
  );
};
