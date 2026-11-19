'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Lightning,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  Wallet,
  At,
  Fingerprint,
  Lock,
} from '@phosphor-icons/react';
import { HandleInput } from '../components/HandleInput';
import { AmountInput } from '../components/AmountInput';
import { BackBar } from '../components/BackBar';
import { Badge } from '../components/Badge';
import { ShareModal } from '../components/ShareModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WalletShareModal, WalletSendReceipt } from '../components/WalletShareModal';
import { PeopleYouPay } from '../components/PeopleYouPay';
import { usePayments } from '../hooks/usePayments';
import { PROTOCOL_FEE_RATE, formatTokenAmount, formatUsd, api } from '../lib/api';
import { addressFamily, familyLabel, WithdrawChain } from '../lib/withdrawChains';
import { useSearchParams, useNavigate } from '../lib/router';
import { PaymentIntent } from '../types';

export const SendPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get('mode');
  const requestedRecipient =
    searchParams.get('recipient') || searchParams.get('to') || searchParams.get('handle');
  const requestedAsset = searchParams.get('asset') || searchParams.get('token');
  const requestedAmount = searchParams.get('amount');

  const {
    tokens,
    selectedToken,
    setSelectedToken,
    quote,
    isSubmitting,
    txStage,
    txStepMsg,
    error,
    sendPayment,
    sendToWallet,
    updateQuote,
    clearError,
    balancesError,
    refreshBalances,
  } = usePayments();

  const submittingRef = useRef(false);

  const [sendMode, setSendMode] = useState<'handle' | 'wallet'>(
    requestedMode === 'wallet' ? 'wallet' : 'handle'
  );
  const [recipient, setRecipient] = useState(
    requestedRecipient ? requestedRecipient.replace(/^@+/, '') : ''
  );
  const [walletAddress, setWalletAddress] = useState('');
  const [destinationChain, setDestinationChain] = useState('');
  const [destinationChainTouched, setDestinationChainTouched] = useState(false);
  const [withdrawChains, setWithdrawChains] = useState<WithdrawChain[]>([]);
  const [amount, setAmount] = useState(
    requestedAmount && parseFloat(requestedAmount) > 0 ? requestedAmount : ''
  );
  const [memo, setMemo] = useState('');
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [walletReceipt, setWalletReceipt] = useState<WalletSendReceipt | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isHandleValid, setIsHandleValid] = useState<boolean | null>(null);

  // Sync recipient and amount if searchParams change
  useEffect(() => {
    if (requestedRecipient) {
      setRecipient(requestedRecipient.replace(/^@+/, ''));
      setSendMode('handle');
    }
  }, [requestedRecipient]);

  useEffect(() => {
    if (requestedAmount && parseFloat(requestedAmount) > 0) {
      setAmount(requestedAmount);
    }
  }, [requestedAmount]);

  useEffect(() => {
    if (!requestedAsset || tokens.length === 0) return;
    const match = tokens.find(
      (t) =>
        t.symbol.toLowerCase() === requestedAsset.toLowerCase() ||
        t.id.toLowerCase() === requestedAsset.toLowerCase()
    );
    if (match) setSelectedToken(match);
  }, [requestedAsset, tokens, setSelectedToken]);

  // Recalculate quote on token or amount changes
  useEffect(() => {
    updateQuote(selectedToken.id, amount);
  }, [selectedToken.id, amount, updateQuote]);

  useEffect(() => {
    if (requestedMode === 'wallet') setSendMode('wallet');
  }, [requestedMode]);

  const feePercentLabel = useMemo(() => {
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(quote?.protocolFee ?? '');
    if (amountNum > 0 && feeNum > 0) {
      const pct = Math.round((feeNum / amountNum) * 10000) / 100;
      return `${pct}%`;
    }
    return `${PROTOCOL_FEE_RATE * 100}%`;
  }, [amount, quote?.protocolFee]);

  // Live destination networks for the selected asset (from 1Click via the
  // worker), so the picker can never fall behind what the solver supports.
  useEffect(() => {
    if (sendMode !== 'wallet') return;
    let cancelled = false;
    void api.getWithdrawChains(selectedToken.id).then((chains) => {
      if (!cancelled) setWithdrawChains(chains);
    });
    return () => {
      cancelled = true;
    };
  }, [sendMode, selectedToken.id]);

  // Reset any manual pick when the asset changes so a fresh default is chosen.
  useEffect(() => {
    setDestinationChainTouched(false);
  }, [selectedToken.id]);

  const showChainSelector = sendMode === 'wallet' && withdrawChains.length > 0;
  const detectedFamily = addressFamily(walletAddress);
  const selectedChain = withdrawChains.find((chain) => chain.key === destinationChain);
  const selectedChainName = selectedChain?.name || '';
  // Only flag a conflict when the network's family is known and clearly differs
  // from the address; opaque families are validated by 1Click on submit.
  const chainFamilyMismatch =
    showChainSelector &&
    !!detectedFamily &&
    !!selectedChain &&
    selectedChain.family !== null &&
    selectedChain.family !== detectedFamily;

  // Default to the network the address implies, but never override a manual
  // choice — the network is the user's to pick.
  useEffect(() => {
    if (!showChainSelector) return;
    const current = withdrawChains.find((chain) => chain.key === destinationChain);
    const currentOk =
      !!current &&
      (destinationChainTouched ||
        !detectedFamily ||
        current.family === null ||
        current.family === detectedFamily);
    if (currentOk) return;
    const preferred =
      (detectedFamily && withdrawChains.find((chain) => chain.family === detectedFamily)) ||
      withdrawChains[0];
    setDestinationChain(preferred?.key || '');
  }, [showChainSelector, withdrawChains, destinationChain, destinationChainTouched, detectedFamily]);

  const availableBalanceNum = parseFloat(selectedToken.balance || '0') || 0;
  const enteredAmountNum = parseFloat(amount) || 0;
  const estimatedTotalDebitNum =
    sendMode === 'handle'
      ? quote?.totalAmount
        ? parseFloat(quote.totalAmount) || enteredAmountNum * (1 + PROTOCOL_FEE_RATE)
        : enteredAmountNum * (1 + PROTOCOL_FEE_RATE)
      : enteredAmountNum;
  const insufficientBalanceForFee =
    selectedToken.balance !== undefined &&
    enteredAmountNum > 0 &&
    estimatedTotalDebitNum > availableBalanceNum + 0.0001;

  const isFormValid =
    (sendMode === 'handle' ? (recipient.trim().length >= 1 && isHandleValid !== false) : walletAddress.trim().length >= 5) &&
    enteredAmountNum > 0 &&
    !insufficientBalanceForFee &&
    !chainFamilyMismatch &&
    !isSubmitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || submittingRef.current) return;
    clearError();
    setSuccessToast(null);
    setShowConfirm(true);
  };

  const submitPayment = async () => {
    if (submittingRef.current || isSubmitting) return;
    const target = sendMode === 'handle' ? recipient : walletAddress;
    if (!target.trim()) return;
    if (!amount || parseFloat(amount) <= 0) return;

    submittingRef.current = true;
    clearError();
    setSuccessToast(null);

    try {
      if (sendMode === 'wallet') {
        // Withdraw own shielded balance to the destination chain — never a
        // payment row, which no one would be able to claim.
        const result = await sendToWallet(
          target,
          amount,
          selectedToken.id,
          showChainSelector ? destinationChain : undefined
        );
        setShowConfirm(false);
        setCreatedPayment(null);
        // Wallet sends now produce a public receipt link too, so the sender can
        // share proof of payment the same way an X-handle send works.
        if (result.shareLink) {
          setWalletReceipt({
            shareLink: result.shareLink,
            amount,
            symbol: selectedToken.symbol,
            iconUrl: selectedToken.iconUrl,
            destinationAddress: result.destinationAddress,
            txHash: result.txHash,
            amountUsd: quote?.amountUsd ?? null,
          });
          setShowWalletModal(true);
        }
        setSuccessToast(
          `Sent ${amount} ${selectedToken.symbol} to ${target.slice(0, 12)}… · tx ${result.txHash.slice(0, 10)}…`
        );
        setRecipient('');
        setWalletAddress('');
        setAmount('');
        setMemo('');
        return;
      }

      const payment = await sendPayment(target, amount, memo);
      setShowConfirm(false);
      setCreatedPayment(payment);
      // Every X-handle send produces a shareable link now — a claim link for
      // new recipients, a receipt link for already-registered ones — so the
      // modal opens either way and the sender can notify the recipient.
      setShowShareModal(true);
      if (payment.isDirect || payment.status === 'claimed') {
        setSuccessToast(
          `Successfully sent ${formatTokenAmount(payment.amount)} ${payment.token.symbol} directly to @${payment.recipientHandle}'s UPRAIL account!`
        );
      } else {
        setSuccessToast(
          `Payment sent to @${payment.recipientHandle} · ${formatTokenAmount(payment.amount)} ${payment.token.symbol} waiting.`
        );
      }
      setRecipient('');
      setWalletAddress('');
      setAmount('');
      setMemo('');
    } catch {
      // Close dialog so the user immediately sees the error banner
      setShowConfirm(false);
    } finally {
      submittingRef.current = false;
    }
  };

  const confirmTotalLabel =
    sendMode === 'handle'
      ? `${quote ? formatTokenAmount(quote.totalAmount) : formatTokenAmount(String(estimatedTotalDebitNum))} ${quote?.token.symbol ?? selectedToken.symbol}`
      : `${formatTokenAmount(amount || '0')} ${selectedToken.symbol}`;
  const confirmReceiveLabel =
    sendMode === 'handle'
      ? `${quote ? formatTokenAmount(quote.recipientAmount) : formatTokenAmount(amount || '0')} ${quote?.token.symbol ?? selectedToken.symbol}`
      : `${quote?.amount ?? amount} ${quote?.token.symbol ?? selectedToken.symbol}`;
  const confirmDestination =
    sendMode === 'handle'
      ? `@${recipient.replace(/^@/, '').trim()}`
      : walletAddress.trim();

  const liveProgressText =
    txStepMsg ||
    (txStage === 'authorizing'
      ? 'Waiting for your passkey…'
      : 'Broadcasting confidential payment…');

  return (
    <div className="w-full space-y-6">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Home" />

      {/* Success Notification */}
      {successToast && (
        <div className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <CheckCircle weight="fill" className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <span className="font-medium">{successToast}</span>
          </div>
          {(createdPayment || walletReceipt) && (
            <button
              onClick={() =>
                walletReceipt ? setShowWalletModal(true) : setShowShareModal(true)
              }
              className="ml-3 font-bold text-stone-900 underline hover:text-black cursor-pointer"
            >
              Share Link
            </button>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2.5 animate-fade-in">
          <WarningCircle weight="fill" className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary Payment Card */}
      <div className="rounded-3xl p-4 sm:p-6 md:p-8 shadow-sm bg-white border border-stone-200 relative space-y-5 sm:space-y-6">

        {/* Destination Mode Selector (𝕏 Handle vs Wallet Address via Intents) */}
        <div className="flex gap-1.5 p-1.5 rounded-2xl bg-stone-200/75 dark:bg-stone-900 border border-stone-300/80 dark:border-stone-700 text-xs font-mono font-bold">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setSendMode('handle')}
            className={`flex-1 py-2.5 px-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed ${
              sendMode === 'handle'
                ? 'bg-stone-950 dark:bg-white text-white dark:text-stone-950 border-stone-950 dark:border-white shadow-sm'
                : 'bg-white/85 dark:bg-stone-800/70 hover:bg-white dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white border-stone-300/90 dark:border-stone-700 shadow-2xs'
            }`}
          >
            <At weight="bold" className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Send to 𝕏 Handle</span>
            <span className="sm:hidden">𝕏 Handle</span>
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setSendMode('wallet')}
            className={`flex-1 py-2.5 px-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed ${
              sendMode === 'wallet'
                ? 'bg-stone-950 dark:bg-white text-white dark:text-stone-950 border-stone-950 dark:border-white shadow-sm'
                : 'bg-white/85 dark:bg-stone-800/70 hover:bg-white dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white border-stone-300/90 dark:border-stone-700 shadow-2xs'
            }`}
          >
            <Wallet weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">
              {quote?.rail === 'native' ? 'Send to Wallet' : 'Send to Wallet via Intents'}
            </span>
            <span className="sm:hidden">Via Wallet</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Mode 1: 𝕏 Handle Input */}
          {sendMode === 'handle' ? (
            <div className="space-y-4">
              <PeopleYouPay
                onSelectRecipient={(handle, asset, prefAmount) => {
                  if (isSubmitting) return;
                  setRecipient(handle.replace(/^@+/, ''));
                  if (prefAmount) setAmount(prefAmount);
                  if (asset) {
                    const match = tokens.find(
                      (t) =>
                        t.symbol.toLowerCase() === asset.toLowerCase() ||
                        t.id.toLowerCase() === asset.toLowerCase()
                    );
                    if (match) setSelectedToken(match);
                  }
                }}
                onRequestMoney={(handle, asset) => {
                  if (isSubmitting) return;
                  const q = new URLSearchParams();
                  q.set('handle', handle.replace(/^@+/, ''));
                  if (asset) q.set('asset', asset);
                  navigate(`/app/request?${q.toString()}`);
                }}
              />
              <HandleInput
                value={recipient}
                onChange={(val) => {
                  setRecipient(val);
                  if (!val) setIsHandleValid(null);
                }}
                onResolved={(_acc, isValid) => setIsHandleValid(isValid)}
                disabled={isSubmitting}
                placeholder="username"
                label="Recipient (𝕏 Handle)"
                mode="send"
              />
            </div>
          ) : (
            /* Mode 2: Wallet Address Input (EVM, Solana, NEAR) */
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                    Recipient Wallet Address
                  </label>
                  <span className="text-xs text-stone-700 font-mono font-medium">
                    Cross-Chain Solver
                  </span>
                </div>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value.trim())}
                  disabled={isSubmitting}
                  placeholder="0x... (EVM), Solana base58, or .near"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3.5 text-base sm:text-xs text-stone-900 font-mono placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
                />
              </div>

              {/* Destination network — an EVM address is valid on every EVM
                  chain, so the network has to be chosen explicitly. The list
                  is the full live set 1Click supports for this token. */}
              {showChainSelector && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                      Destination Network
                    </label>
                    <span className="text-[11px] text-stone-500 font-mono">{selectedChainName}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {withdrawChains.map((chain) => (
                      <button
                        key={chain.key}
                        type="button"
                        onClick={() => {
                          setDestinationChainTouched(true);
                          setDestinationChain(chain.key);
                        }}
                        disabled={isSubmitting}
                        className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer disabled:opacity-60 ${
                          destinationChain === chain.key
                            ? 'bg-stone-900 text-white border-stone-900'
                            : 'bg-stone-50 text-stone-600 border-stone-200 hover:border-stone-400 hover:text-black'
                        }`}
                      >
                        {chain.name}
                      </button>
                    ))}
                  </div>
                  {chainFamilyMismatch && (
                    <p className="text-[11px] font-mono text-amber-600">
                      This looks like a {familyLabel(detectedFamily)} address. Choose a {familyLabel(detectedFamily)} network.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* A failed balance read must never look like an empty wallet. */}
          {balancesError && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-xs font-medium text-amber-900 min-w-0 flex-1 basis-44">
                {balancesError.endsWith('.') ? balancesError : `${balancesError}.`}{' '}
                Balances shown may be out of date.
              </p>
              <button
                type="button"
                onClick={() => void refreshBalances()}
                className="text-xs font-bold text-amber-900 underline underline-offset-2 hover:text-amber-700 shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* Amount and Asset Picker */}
          <AmountInput
            amount={amount}
            onChangeAmount={setAmount}
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            feeRate={sendMode === 'handle' ? PROTOCOL_FEE_RATE : 0}
            disabled={isSubmitting}
          />

          {insufficientBalanceForFee && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-mono text-amber-900">
              {sendMode === 'handle'
                ? `Insufficient ${selectedToken.symbol} balance for amount + 1% fee (${formatTokenAmount(String(estimatedTotalDebitNum))} needed, ${selectedToken.balance} available).`
                : `Insufficient ${selectedToken.symbol} balance (${selectedToken.balance} available).`}
            </div>
          )}

          {/* Optional Memo */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                Note <span className="font-normal lowercase tracking-normal">optional</span>
              </label>
              <Badge tone="neutral" icon={<Lock weight="fill" className="w-3 h-3" />}>
                Encrypted
              </Badge>
            </div>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={isSubmitting}
              enterKeyHint="send"
              placeholder="e.g. bounty, consulting, dinner ☕"
              maxLength={120}
              className="w-full rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 text-base sm:text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
            />
          </div>

          {/* Quote & Execution Telemetry */}
          {quote && parseFloat(amount) > 0 && (
            <div className="rounded-2xl bg-[var(--bg-subtle)] border border-[var(--line)] p-3.5 sm:p-4 space-y-2 text-sm font-sans">
              <div className="flex items-center justify-between gap-2 text-[var(--fg-muted)]">
                <span className="truncate">
                  {sendMode === 'handle'
                    ? `@${recipient.replace(/^@+/, '') || 'handle'} gets`
                    : 'Recipient gets'}
                </span>
                <span className="text-[var(--fg)] font-semibold text-right whitespace-nowrap">
                  {formatTokenAmount(sendMode === 'handle' ? quote.recipientAmount : quote.amount)} {quote.token.symbol}
                  <span className="text-[var(--fg-muted)] font-normal">
                    {' · '}
                    {formatUsd(sendMode === 'handle' ? quote.recipientAmountUsd : quote.amountUsd)}
                  </span>
                </span>
              </div>
              {/* Wallet withdrawals take no platform fee — only handle sends
                  charge a 1% fee on top from the sender's balance. */}
              {sendMode === 'handle' && (
                <div className="flex items-center justify-between gap-2 text-[var(--fg-muted)]">
                  <span>Fee ({feePercentLabel})</span>
                  <span className="text-[var(--fg)] font-semibold text-right whitespace-nowrap">
                    {quote.protocolFee} {quote.token.symbol}
                    <span className="text-[var(--fg-muted)] font-normal">
                      {' · '}
                      {formatUsd(quote.protocolFeeUsd)}
                    </span>
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between gap-2 font-bold text-[var(--fg)]">
                <span>You send</span>
                <span className="font-bold text-right whitespace-nowrap">
                  {sendMode === 'handle' ? formatTokenAmount(quote.totalAmount) : quote.amount} {quote.token.symbol}
                  <span className="text-[var(--fg-muted)] font-normal">
                    {' · '}
                    {formatUsd(sendMode === 'handle' ? quote.totalUsd : quote.amountUsd)}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Send CTA Button — sticky above mobile keyboard */}
          <div className="sticky bottom-[max(0.5rem,env(keyboard-inset-height,0px))] z-10 -mx-1 px-1 pt-1 sm:static sm:mx-0 sm:px-0 sm:pt-0">
            <button
              type="submit"
              disabled={!isFormValid}
              className={`w-full min-h-12 py-3.5 px-4 sm:px-6 rounded-2xl font-display font-extrabold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-xs ${
                isFormValid
                  ? 'bg-black hover:bg-stone-800 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-[var(--bg-muted)] text-[var(--fg-muted)] border border-[var(--line)] cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="truncate">{liveProgressText}</span>
                </>
              ) : isFormValid ? (
                <>
                  <Fingerprint weight="bold" className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">
                    {sendMode === 'handle'
                      ? `Review & send to @${recipient.replace(/^@/, '')}`
                      : 'Review & send'}
                  </span>
                  <ArrowRight weight="bold" className="w-4 h-4 flex-shrink-0" />
                </>
              ) : (
                <span className="truncate">
                  {sendMode === 'handle'
                    ? 'Add a handle and amount'
                    : 'Add an address and amount'}
                </span>
              )}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        onCancel={() => {
          if (!isSubmitting) setShowConfirm(false);
        }}
        onConfirm={() => void submitPayment()}
        isLoading={isSubmitting}
        loadingLabel={liveProgressText}
        tone="financial"
        title={sendMode === 'handle' ? 'Confirm payment' : 'Confirm withdrawal'}
        description={
          sendMode === 'handle'
            ? 'Confirm with your passkey next.'
            : 'This moves money out of your UPRAIL account to an external address.'
        }
        confirmLabel={
          sendMode === 'handle'
            ? `Send ${amount.trim() || '0'} ${selectedToken.symbol}`
            : `Withdraw ${amount.trim() || '0'} ${selectedToken.symbol}`
        }
        warning={
          sendMode === 'handle'
            ? 'Not on UPRAIL yet? Share the payment link with them.'
            : 'Withdrawals are irreversible. Confirm the destination address and network before continuing.'
        }
        details={[
          { label: 'To', value: confirmDestination, mono: false, emphasis: true },
          ...(sendMode === 'wallet' && selectedChainName
            ? [{ label: 'Network', value: selectedChainName, mono: false }]
            : []),
          {
            label: sendMode === 'handle' ? `@${recipient.replace(/^@+/, '') || 'handle'} gets` : 'Recipient gets',
            value: confirmReceiveLabel,
            emphasis: true,
          },
          ...(sendMode === 'handle'
            ? [
                {
                  label: 'Fee (1%)',
                  value: `${quote?.protocolFee ?? '0'} ${quote?.token.symbol ?? selectedToken.symbol}`,
                },
                { label: 'You send', value: confirmTotalLabel, emphasis: true },
              ]
            : []),
          ...(memo.trim() ? [{ label: 'Note', value: memo.trim(), mono: false }] : []),
        ]}
      />

      {/* Share Modal Dialog */}
      {createdPayment && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          payment={createdPayment}
        />
      )}

      {/* Wallet-send receipt Modal Dialog */}
      <WalletShareModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        receipt={walletReceipt}
      />
    </div>
  );
};
