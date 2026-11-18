'use client';

import React, { useState, useEffect } from 'react';
import { BackBar } from '../components/BackBar';
import { HandleInput } from '../components/HandleInput';
import { AssetPicker } from '../components/AssetPicker';
import { PeopleYouPay } from '../components/PeopleYouPay';
import { RequestShareModal } from '../components/RequestShareModal';
import { usePayments } from '../hooks/usePayments';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { api, tokenUsdPrice, formatUsd } from '../lib/api';
import { useSearchParams, useNavigate } from '../lib/router';
import type { PaymentRequest, Token } from '../types';
import { ArrowDownLeft, WarningCircle, Clock, ShieldCheck, Fingerprint } from '@phosphor-icons/react';

export const RequestMoneyPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillHandle = searchParams.get('handle') || searchParams.get('to') || '';
  const prefillAsset = searchParams.get('asset') || '';

  const { tokens, selectedToken, setSelectedToken } = usePayments();
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const [recipientHandle, setRecipientHandle] = useState(prefillHandle);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRequest, setCreatedRequest] = useState<PaymentRequest | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isHandleValid, setIsHandleValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (prefillHandle) setRecipientHandle(prefillHandle.replace(/^@+/, ''));
  }, [prefillHandle]);

  useEffect(() => {
    if (prefillAsset && tokens.length > 0) {
      const match = tokens.find(
        (t) =>
          t.symbol.toLowerCase() === prefillAsset.toLowerCase() ||
          t.id.toLowerCase() === prefillAsset.toLowerCase()
      );
      if (match) setSelectedToken(match);
    }
  }, [prefillAsset, tokens, setSelectedToken]);

  const handleSelectFromPeople = (handle: string, asset?: string, prefAmount?: string) => {
    setRecipientHandle(handle.replace(/^@+/, ''));
    if (prefAmount) setAmount(prefAmount);
    if (asset && tokens.length > 0) {
      const match = tokens.find(
        (t) =>
          t.symbol.toLowerCase() === asset.toLowerCase() ||
          t.id.toLowerCase() === asset.toLowerCase()
      );
      if (match) setSelectedToken(match);
    }
  };

  const numericAmount = parseFloat(amount) || 0;
  const price = tokenUsdPrice(selectedToken);
  const estimatedUsd = price !== null && numericAmount > 0 ? numericAmount * price : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHandle = recipientHandle.trim().replace(/^@+/, '').toLowerCase();
    if (!cleanHandle) {
      setError('Please enter a valid 𝕏 handle');
      return;
    }
    if (numericAmount <= 0) {
      setError('Please enter an amount greater than 0');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Prompt biometric passkey verification
      let passkeyAssertion: unknown = undefined;
      try {
        passkeyAssertion = await authorizeWithPasskey(
          `Request ${amount} ${selectedToken.symbol} from @${cleanHandle}`
        );
      } catch (authErr: any) {
        setError(authErr?.message || 'Passkey authorization cancelled');
        setIsSubmitting(false);
        return;
      }

      const req = await api.createPaymentRequest({
        requestedHandle: cleanHandle,
        asset: selectedToken.symbol || selectedToken.id,
        amount,
        memo: memo.trim() || undefined,
        expiresInDays,
        passkeyAssertion,
      });

      setCreatedRequest(req);
      setShowShareModal(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to create payment request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6 pb-12 animate-fade-in">
      <BackBar to="/app" label="Back to Dashboard" />

      {/* Title */}
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-950 dark:text-white font-display tracking-tight flex items-center space-x-2">
          <span>Request Money</span>
        </h1>
        <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 font-sans">
          Request payment from anyone on 𝕏. If they aren’t on UPRAIL yet, they can join and pay in one tap.
        </p>
      </div>

      {/* People You Pay Picker */}
      <PeopleYouPay
        onSelectRecipient={(h, a, amt) => {
          const q = new URLSearchParams();
          q.set('recipient', h.replace(/^@+/, ''));
          if (a) q.set('asset', a);
          if (amt) q.set('amount', amt);
          navigate(`/app/send?${q.toString()}`);
        }}
        onRequestMoney={(h, a) => handleSelectFromPeople(h, a)}
        className="my-2"
      />

      {/* Form Card */}
      <div className="rounded-3xl p-4 sm:p-6 md:p-8 shadow-sm bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 relative space-y-5 sm:space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 flex items-start space-x-2">
              <WarningCircle weight="fill" className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Payer Handle */}
          <HandleInput
            value={recipientHandle}
            onChange={(val) => {
              setRecipientHandle(val);
              if (!val) setIsHandleValid(null);
            }}
            onResolved={(_acc, isValid) => setIsHandleValid(isValid)}
            disabled={isSubmitting}
            placeholder="username"
            label="Request From (𝕏 Handle)"
            mode="request"
          />

          {/* Amount & Asset Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400">
              Amount & Asset
            </label>
            <div className="flex items-center space-x-2 p-2 rounded-2xl bg-stone-50 border border-stone-200 transition-colors">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  let val = e.target.value;
                  if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                    if (val.startsWith('.')) val = '0' + val;
                    setAmount(val);
                  }
                }}
                placeholder="0.00"
                disabled={isSubmitting}
                style={{ outline: 'none', boxShadow: 'none' }}
                className="w-full min-w-0 border-0 bg-transparent px-3 text-2xl font-mono font-bold text-stone-950 focus:outline-none focus-visible:outline-none focus:ring-0 outline-none"
              />
              <div className="flex-shrink-0">
                <AssetPicker
                  tokens={tokens}
                  selectedToken={selectedToken}
                  onSelectToken={setSelectedToken}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            {estimatedUsd !== null && (
              <div className="text-[11px] font-mono text-stone-400 dark:text-stone-500 px-1">
                ≈ {formatUsd(estimatedUsd)} USD
              </div>
            )}
          </div>

          {/* Memo / Purpose */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400">
              Note (Optional)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Lunch reimbursement, freelance design, etc."
              maxLength={280}
              disabled={isSubmitting}
              style={{ outline: 'none', boxShadow: 'none' }}
              className="w-full p-3 rounded-2xl bg-stone-50 border border-stone-200 text-base sm:text-xs font-sans text-stone-900 placeholder-stone-400 focus:outline-none focus-visible:outline-none transition-colors"
            />
          </div>

          {/* Expiry Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400 flex items-center space-x-1">
              <Clock weight="fill" className="w-3.5 h-3.5" />
              <span>Expires In</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { days: 3, label: '3 Days' },
                { days: 7, label: '7 Days' },
                { days: 30, label: '30 Days' },
              ].map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => setExpiresInDays(opt.days)}
                  className={`py-2 px-3 rounded-xl text-xs font-mono font-bold transition-all border ${
                    expiresInDays === opt.days
                      ? 'bg-stone-900 dark:bg-white text-white dark:text-stone-900 border-stone-900 dark:border-white shadow-xs'
                      : 'bg-stone-50 dark:bg-stone-800/60 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Trust Banner */}
          <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800 text-[11px] font-sans text-stone-500 dark:text-stone-400 flex items-start space-x-2">
            <ShieldCheck weight="fill" className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              The payer will receive a secure UPRAIL request link. They can accept or decline anytime voluntarily.
            </span>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || isAuthorizing || !recipientHandle || isHandleValid === false || numericAmount <= 0}
            className="w-full py-4 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-display font-bold uppercase tracking-wider text-xs transition-all flex items-center justify-center space-x-2 shadow-xs hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isAuthorizing ? (
              <Fingerprint weight="bold" className="w-4 h-4 animate-pulse text-white" />
            ) : (
              <ArrowDownLeft weight="bold" className="w-4 h-4" />
            )}
            <span>
              {isAuthorizing
                ? 'Confirming with Passkey...'
                : isSubmitting
                ? 'Creating Request...'
                : 'Create Payment Request'}
            </span>
          </button>
        </form>
      </div>

      {/* Share Modal */}
      <RequestShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        request={createdRequest}
      />
    </div>
  );
};
