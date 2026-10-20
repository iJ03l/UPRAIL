'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Wallet,
  AtSign,
  Fingerprint,
} from 'lucide-react';
import { HandleInput } from '../components/HandleInput';
import { AmountInput } from '../components/AmountInput';
import { BackBar } from '../components/BackBar';
import { ShareModal } from '../components/ShareModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WalletShareModal, WalletSendReceipt } from '../components/WalletShareModal';
import { usePayments } from '../hooks/usePayments';
import { PROTOCOL_FEE_RATE, formatUsd, api } from '../lib/api';
import { addressFamily, familyLabel, WithdrawChain } from '../lib/withdrawChains';
import { PaymentIntent } from '../types';

export const SendPage: React.FC = () => {
  const {
    tokens,
    selectedToken,
    setSelectedToken,
    quote,
    isSubmitting,
    error,
    sendPayment,
    sendToWallet,
    updateQuote,
    clearError,
    balancesError,
    refreshBalances,
  } = usePayments();

  const [sendMode, setSendMode] = useState<'handle' | 'wallet'>('handle');
  const [recipient, setRecipient] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [destinationChain, setDestinationChain] = useState('');
  const [destinationChainTouched, setDestinationChainTouched] = useState(false);
  const [withdrawChains, setWithdrawChains] = useState<WithdrawChain[]>([]);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [walletReceipt, setWalletReceipt] = useState<WalletSendReceipt | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Recalculate quote on token or amount changes
  useEffect(() => {
    updateQuote(selectedToken.id, amount);
  }, [selectedToken.id, amount, updateQuote]);

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

  const isFormValid =
    (sendMode === 'handle' ? recipient.trim().length >= 2 : walletAddress.trim().length >= 5) &&
    parseFloat(amount) > 0 &&
    !chainFamilyMismatch &&
    !isSubmitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    clearError();
    setSuccessToast(null);
    setShowConfirm(true);
  };

  const submitPayment = async () => {
    setShowConfirm(false);
    clearError();
    setSuccessToast(null);

    const target = sendMode === 'handle' ? recipient : walletAddress;
    if (!target.trim()) return;
    if (!amount || parseFloat(amount) <= 0) return;

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
      setCreatedPayment(payment);
      // Every X-handle send produces a shareable link now — a claim link for
      // new recipients, a receipt link for already-registered ones — so the
      // modal opens either way and the sender can notify the recipient.
      setShowShareModal(true);
      if (payment.isDirect || payment.status === 'claimed') {
        setSuccessToast(
          `Successfully sent ${payment.amount} ${payment.token.symbol} directly to @${payment.recipientHandle}'s vault!`
        );
      } else {
        setSuccessToast(
          `Successfully escrowed ${payment.amount} ${payment.token.symbol} for @${payment.recipientHandle}!`
        );
      }
      setRecipient('');
      setWalletAddress('');
      setAmount('');
      setMemo('');
    } catch {
      // Error is tracked in hook
    }
  };

  const confirmAmountLabel = `${amount || '0'} ${selectedToken.symbol}`;
  const confirmReceiveLabel =
    sendMode === 'handle'
      ? `${quote?.recipientAmount ?? amount} ${quote?.token.symbol ?? selectedToken.symbol}`
      : `${quote?.amount ?? amount} ${quote?.token.symbol ?? selectedToken.symbol}`;
  const confirmDestination =
    sendMode === 'handle'
      ? `@${recipient.replace(/^@/, '').trim()}`
      : walletAddress.trim();

  return (
    <div className="w-full space-y-6">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Home" />

      {/* Success Notification */}
      {successToast && (
        <div className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-stone-900 flex-shrink-0" />
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
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary Payment Card */}
      <div className="rounded-3xl p-4 sm:p-6 md:p-8 shadow-sm bg-white border border-stone-200 relative space-y-5 sm:space-y-6">

        {/* Destination Mode Selector (𝕏 Handle vs Wallet Address via Intents) */}
        <div className="flex p-1 rounded-2xl bg-stone-100 border border-stone-200 text-xs font-mono font-bold">
          <button
            type="button"
            onClick={() => setSendMode('handle')}
            className={`flex-1 py-2.5 px-2 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              sendMode === 'handle'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            <AtSign className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
            <span className="hidden sm:inline">Send to 𝕏 Handle</span>
            <span className="sm:hidden">𝕏 Handle</span>
          </button>
          <button
            type="button"
            onClick={() => setSendMode('wallet')}
            className={`flex-1 py-2.5 px-2 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              sendMode === 'wallet'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
            <span className="hidden sm:inline">
              {quote?.rail === 'native' ? 'Send to Wallet' : 'Send to Wallet via Intents'}
            </span>
            <span className="sm:hidden">
              {quote?.rail === 'native' ? 'Wallet' : 'Wallet Intents'}
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Mode 1: 𝕏 Handle Input */}
          {sendMode === 'handle' ? (
            <HandleInput
              value={recipient}
              onChange={setRecipient}
              disabled={isSubmitting}
              placeholder="username"
            />
          ) : (
            /* Mode 2: Wallet Address Input (EVM, Solana, NEAR) */
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                    Recipient Wallet Address
                  </label>
                  <span className="text-xs text-stone-700 font-mono font-bold">
                    Cross-Chain Solver
                  </span>
                </div>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value.trim())}
                  disabled={isSubmitting}
                  placeholder="0x... (EVM), Solana base58, or .near"
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
            disabled={isSubmitting}
          />

          {/* Optional Memo */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Private Note (Optional)
              </label>
              <span className="text-[11px] font-mono text-stone-700 font-semibold">Encrypted</span>
            </div>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. bounty, consulting, dinner ☕"
              maxLength={120}
              className="w-full rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 text-base sm:text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
            />
          </div>

          {/* Quote & Execution Telemetry */}
          {quote && parseFloat(amount) > 0 && (
            <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3.5 sm:p-4 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between gap-2 text-stone-500">
                <span>Recipient Receives</span>
                <span className="text-stone-900 font-bold text-right">
                  {/* Wallet withdrawals take no fee — the destination gets the
                      full amount. The quote's net figure is for handle sends. */}
                  {sendMode === 'handle' ? quote.recipientAmount : quote.amount} {quote.token.symbol} (
                  {formatUsd(sendMode === 'handle' ? quote.recipientAmountUsd : quote.amountUsd)})
                </span>
              </div>
              {/* Wallet withdrawals take no platform fee — only handle sends
                  carve one out of the amount. Rendering it in wallet mode
                  understated what the destination would receive. */}
              {sendMode === 'handle' && (
                <div className="flex items-center justify-between gap-2 text-stone-500">
                  <span>Platform Fee ({feePercentLabel})</span>
                  <span className="text-stone-900 font-bold text-right">
                    {quote.protocolFee} {quote.token.symbol} ({formatUsd(quote.protocolFeeUsd)})
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-stone-500">
                <span>{sendMode === 'handle' ? 'Settlement Rail' : 'Withdrawal Rail'}</span>
                <span className="text-stone-900 flex items-center font-bold text-right">
                  <Zap className="w-3 h-3 text-stone-900 mr-1 flex-shrink-0" />
                  <span>
                    {quote.rail === 'native'
                      ? 'NEAR Native Transfer'
                      : sendMode === 'handle'
                        ? 'NEAR Intent'
                        : 'NEAR Intent Withdrawal'}
                  </span>
                </span>
              </div>
              <div className="pt-2 border-t border-stone-200 flex items-center justify-between gap-2 font-bold text-stone-900 text-sm">
                <span>Total to Send</span>
                <span className="text-stone-950 font-bold text-right">
                  {quote.totalAmount} {quote.token.symbol} ({formatUsd(quote.totalUsd)})
                </span>
              </div>
            </div>
          )}

          {/* Send CTA Button — Authorized by Device Passkey */}
          <button
            type="submit"
            disabled={!isFormValid}
            className={`w-full py-4 px-4 sm:px-6 rounded-2xl font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all duration-200 shadow-xs ${
              isFormValid
                ? 'bg-black hover:bg-stone-800 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                : 'bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span>Authorizing with Passkey...</span>
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">
                  {sendMode === 'handle'
                    ? recipient
                      ? `Authorize & Send to @${recipient.replace(/^@/, '')}`
                      : 'Enter Handle to Send'
                    : walletAddress
                      ? quote?.rail === 'native'
                        ? `Authorize & Send to Wallet`
                        : `Authorize & Route via Intents`
                      : 'Enter Wallet Address'}
                </span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </>
            )}
          </button>
        </form>
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={() => void submitPayment()}
        tone="financial"
        title={sendMode === 'handle' ? 'Confirm payment' : 'Confirm withdrawal'}
        description={
          sendMode === 'handle'
            ? 'Review the payment before authorizing it with your device passkey.'
            : 'This moves funds out of your UPRAIL vault to an external address.'
        }
        confirmLabel={sendMode === 'handle' ? 'Authorize & send' : 'Authorize & withdraw'}
        warning={
          sendMode === 'handle'
            ? 'The recipient will be able to claim these funds immediately. If they have not joined UPRAIL yet, you will get a claim link to share.'
            : 'Withdrawals are irreversible. Confirm the destination address and network before continuing.'
        }
        details={[
          { label: 'To', value: confirmDestination, mono: false, emphasis: true },
          ...(sendMode === 'wallet' && selectedChainName
            ? [{ label: 'Network', value: selectedChainName, mono: false }]
            : []),
          { label: 'Amount', value: confirmAmountLabel, emphasis: true },
          ...(sendMode === 'handle'
            ? [
                {
                  label: 'Platform fee',
                  value: `${quote?.protocolFee ?? '0'} ${quote?.token.symbol ?? selectedToken.symbol}`,
                },
              ]
            : []),
          { label: 'Recipient receives', value: confirmReceiveLabel },
          {
            label: 'Rail',
            value:
              quote?.rail === 'native'
                ? 'NEAR native transfer'
                : sendMode === 'handle'
                  ? 'NEAR intent'
                  : 'NEAR intent withdrawal',
            mono: false,
          },
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
