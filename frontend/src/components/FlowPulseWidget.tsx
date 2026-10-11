'use client';

import React, { useMemo } from 'react';
import { Link } from '../lib/router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
  Send,
  Lock,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import type { PaymentIntent } from '../types';

interface FlowPulseWidgetProps {
  history?: PaymentIntent[];
  transactions?: any[];
}

export const FlowPulseWidget: React.FC<FlowPulseWidgetProps> = ({
  history = [],
  transactions = [],
}) => {
  const { user } = useXAuth();

  // Compute strictly authentic per-user Inflow & Egress data
  const stats = useMemo(() => {
    const userHandle = user?.handle?.trim().toLowerCase();
    const nearAccount = user?.nearAccount?.trim().toLowerCase();

    let inflowCount = 0;
    let inflowUsd = 0;
    let egressCount = 0;
    let egressUsd = 0;

    // 1. Calculate from user payment intents
    if (Array.isArray(history)) {
      for (const item of history) {
        const amt = parseFloat(item.amount) || 0;
        const price = item.token?.priceUsd;
        const usd =
          typeof item.amountUsd === 'number' && item.amountUsd > 0
            ? item.amountUsd
            : typeof price === 'number' && price > 0
              ? amt * price
              : 0;

        const isRecipient =
          Boolean(userHandle) &&
          Boolean(item.recipientHandle) &&
          item.recipientHandle.toLowerCase() === userHandle;
        const isSender =
          Boolean(userHandle) &&
          Boolean(item.senderHandle) &&
          item.senderHandle.toLowerCase() === userHandle;

        if (isRecipient) {
          inflowCount++;
          inflowUsd += usd;
        } else if (isSender) {
          egressCount++;
          egressUsd += usd;
        } else if (!userHandle) {
          // If session is still hydrating, default to outflow if item exists
          egressCount++;
          egressUsd += usd;
        }
      }
    }

    // 2. Calculate from onchain transactions (deposits / withdrawals)
    if (Array.isArray(transactions)) {
      for (const tx of transactions) {
        const amt =
          parseFloat(
            tx.amount ||
            tx.amountFormatted ||
            tx.amount_in ||
            tx.amount_out ||
            '0'
          ) || 0;
        const isDeposit =
          tx.type === 'deposit' ||
          tx.type === 'receive' ||
          tx.intent_type === 'deposit';
        const isReceiver =
          Boolean(nearAccount) &&
          Boolean(tx.receiver_id) &&
          tx.receiver_id.toLowerCase() === nearAccount;
        const isSender =
          Boolean(nearAccount) &&
          Boolean(tx.sender_id) &&
          tx.sender_id.toLowerCase() === nearAccount;

        if (isDeposit || isReceiver) {
          inflowCount++;
          inflowUsd += amt;
        } else if (
          isSender ||
          tx.type === 'send' ||
          tx.type === 'withdraw' ||
          tx.intent_type === 'transfer'
        ) {
          egressCount++;
          egressUsd += amt;
        }
      }
    }

    return {
      inflowCount,
      inflowUsd,
      egressCount,
      egressUsd,
    };
  }, [history, transactions, user]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
      {/* ── CARD 1: Shielded Inflow (Receive) ── */}
      <div className="relative rounded-3xl bg-white border border-stone-200/90 shadow-xs hover:shadow-sm transition-all p-6 sm:p-7 flex flex-col justify-between overflow-hidden group">
        <div className="space-y-4">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h4 className="text-sm font-display font-bold text-stone-950 flex items-center space-x-1.5">
                  <span>Shielded Inflow</span>
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                </h4>
                <p className="text-[11px] font-mono text-stone-400">
                  Cross-chain confidential receipts
                </p>
              </div>
            </div>

            {/* Real TX Count Badge */}
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs font-mono font-bold tracking-tight">
              {stats.inflowCount} {stats.inflowCount === 1 ? 'tx' : 'txs'}
            </span>
          </div>

          {/* Big Dollar Amount */}
          <div className="space-y-1 pt-1">
            <div className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
              ${stats.inflowUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-xs text-stone-500 font-sans flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Zero mempool exposure · Settled via NEAR Intents</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-6 border-t border-stone-100 flex items-center justify-between">
          <span className="text-[11px] font-mono text-stone-400">
            Ephemeral 1-time ingress addresses
          </span>
          <Link
            to="/app/receive"
            className="px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Receive</span>
            <ArrowDownLeft className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* ── CARD 2: Confidential Egress (Send) ── */}
      <div className="relative rounded-3xl bg-white border border-stone-200/90 shadow-xs hover:shadow-sm transition-all p-6 sm:p-7 flex flex-col justify-between overflow-hidden group">
        <div className="space-y-4">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-orange-50 text-orange-700 border border-orange-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h4 className="text-sm font-display font-bold text-stone-950 flex items-center space-x-1.5">
                  <span>Confidential Egress</span>
                  <Lock className="w-3.5 h-3.5 text-orange-600" />
                </h4>
                <p className="text-[11px] font-mono text-stone-400">
                  Hardware passkey-authorized outlays
                </p>
              </div>
            </div>

            {/* Real TX Count Badge */}
            <span className="px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200/80 text-orange-800 text-xs font-mono font-bold tracking-tight">
              {stats.egressCount} {stats.egressCount === 1 ? 'tx' : 'txs'}
            </span>
          </div>

          {/* Big Dollar Amount */}
          <div className="space-y-1 pt-1">
            <div className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
              ${stats.egressUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-xs text-stone-500 font-sans flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              <span>Biometric passkey signature required · 5% protocol fee</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-6 border-t border-stone-100 flex items-center justify-between">
          <span className="text-[11px] font-mono text-stone-400">
            Send to any 𝕏 handle or wallet
          </span>
          <Link
            to="/app/send"
            className="px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-black text-white font-display font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Send</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
