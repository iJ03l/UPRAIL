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
import { formatUsd } from '../lib/api';
import type { PaymentIntent, Token } from '../types';

interface FlowPulseWidgetProps {
  history?: PaymentIntent[];
  transactions?: any[];
  /**
   * Registry used to price raw onchain amounts. An asset with no live price
   * contributes nothing to the total and is reported separately — a token
   * amount is never added as if it were dollars, and a total we cannot compute
   * renders as an em dash rather than a confident $0.00.
   */
  tokens?: Token[];
}

const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'FRAX', 'USDD', 'USDE', 'USDG', 'FDUSD',
]);

/**
 * A payment only counts once it settled. A pending deposit never left the
 * sender's balance, and a cancelled, expired or refunded one came back —
 * counting any of them as flow invents money that never moved.
 */
const SETTLED_STATUSES = new Set(['claimed', 'ready']);

/**
 * The window these cards report on. All-time numbers on a dashboard read as
 * a current figure; a week that rolls is what a "how much moved lately"
 * card is actually asked for.
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Best-known instant a row represents money that actually moved, in epoch ms.
 * Prefers the moment it settled (claimedAt) over the moment it was created —
 * a payment claimed six days ago and created eight days ago is this week's
 * flow, not last week's. Returns null when no usable instant exists, so an
 * undated row is excluded rather than counted as "now".
 */
const settledAtMs = (item: PaymentIntent): number | null => {
  const raw = item.claimedAt || item.createdAt;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
};

export const FlowPulseWidget: React.FC<FlowPulseWidgetProps> = ({
  history = [],
  transactions = [],
  tokens = [],
}) => {
  const { user } = useXAuth();

  // Compute per-user Inflow & Egress for the last 7 days only
  const stats = useMemo(() => {
    const userHandle = user?.handle?.trim().toLowerCase();
    const nearAccount = user?.nearAccount?.trim().toLowerCase();
    const weekAgo = Date.now() - WEEK_MS;

    const priceById = new Map<string, number>();
    const priceBySymbol = new Map<string, number>();
    const tokenByKey = new Map<string, Token>();
    for (const t of tokens || []) {
      for (const k of [t.id, t.nearContractId]) {
        if (k) tokenByKey.set(k.toLowerCase(), t);
      }
      if (typeof t.priceUsd !== 'number' || !(t.priceUsd > 0)) continue;
      if (t.id) priceById.set(t.id.toLowerCase(), t.priceUsd);
      if (t.nearContractId) priceById.set(t.nearContractId.toLowerCase(), t.priceUsd);
      if (t.symbol) priceBySymbol.set(t.symbol.toUpperCase(), t.priceUsd);
    }

    const assetKeys = (tx: any): string[] => {
      const raw = [
        tx?.defuse_asset_id_in,
        tx?.defuse_asset_id_out,
        tx?.defuse_asset_id,
        tx?.asset_in,
        tx?.asset_out,
        tx?.nearContractId,
        tx?.contract_id,
      ].filter(Boolean) as string[];
      const keys = new Set<string>();
      for (const v of raw) {
        const s = String(v).toLowerCase();
        keys.add(s);
        // `nep141:<contract>` also indexes by the bare contract id.
        if (s.startsWith('nep141:')) keys.add(s.slice(7));
      }
      return [...keys];
    };

    /** `null` = "no live price for this asset", never a silent zero. */
    const usdFor = (keys: string[], symbol?: string): number | null => {
      for (const k of keys) {
        const p = priceById.get(k);
        if (typeof p === 'number' && p > 0) return p;
      }
      const sym = (symbol || '').toUpperCase();
      if (sym) {
        const p = priceBySymbol.get(sym);
        if (typeof p === 'number' && p > 0) return p;
        // A dollar is a dollar even when the feed is rate-limiting.
        if (STABLE_SYMBOLS.has(sym)) return 1;
      }
      return null;
    };

    const symbolFor = (tx: any): string => {
      const keys = assetKeys(tx);
      for (const k of keys) {
        const t = tokenByKey.get(k);
        if (t?.symbol) return t.symbol;
      }
      return String(tx?.symbol || tx?.token_symbol || '').toUpperCase();
    };

    let inflowCount = 0;
    let inflowPriced = 0;
    let inflowUnpriced = 0;
    let egressCount = 0;
    let egressPriced = 0;
    let egressUnpriced = 0;

    const add = (dir: 'in' | 'out', usd: number | null): void => {
      if (dir === 'in') {
        inflowCount++;
        if (usd === null) inflowUnpriced++;
        else inflowPriced += usd;
      } else {
        egressCount++;
        if (usd === null) egressUnpriced++;
        else egressPriced += usd;
      }
    };

    // 1. Calculate from user payment intents
    if (Array.isArray(history)) {
      for (const item of history) {
        if (!SETTLED_STATUSES.has(item.status)) continue;
        // Settled before the window opened: real flow, but last week's.
        const settledAt = settledAtMs(item);
        if (settledAt === null || settledAt < weekAgo) continue;
        const amt = parseFloat(item.amount) || 0;
        let usd: number | null = null;
        if (typeof item.amountUsd === 'number' && item.amountUsd > 0) {
          usd = item.amountUsd;
        } else if (typeof item.token?.priceUsd === 'number' && item.token.priceUsd > 0 && amt > 0) {
          usd = amt * item.token.priceUsd;
        } else {
          const p = usdFor([], item.token?.symbol);
          if (p !== null && amt > 0) usd = amt * p;
        }

        const isRecipient =
          Boolean(userHandle) &&
          Boolean(item.recipientHandle) &&
          item.recipientHandle.toLowerCase() === userHandle;
        const isSender =
          Boolean(userHandle) &&
          Boolean(item.senderHandle) &&
          item.senderHandle.toLowerCase() === userHandle;

        if (isRecipient) {
          add('in', usd);
        } else if (isSender) {
          add('out', usd);
        } else if (!userHandle) {
          // If session is still hydrating, default to outflow if item exists
          add('out', usd);
        }
      }
    }

    // 2. Calculate from onchain transactions (deposits / withdrawals)
    if (Array.isArray(transactions)) {
      for (const tx of transactions) {
        // A failed transaction moved nothing, so it is not flow. Counting
        // failed withdrawals as outflows is what made one UPTOBER send look
        // like three egress events.
        if (tx.status === 'failed') continue;
        // Outside the window: this week's cards must not sum all-time flow.
        // block_timestamp is epoch ms; an undated row is excluded, not
        // counted as "now".
        const ts = Number(tx.block_timestamp);
        if (!Number.isFinite(ts) || ts < weekAgo) continue;
        const amt =
          parseFloat(
            tx.amount ||
            tx.amountFormatted ||
            tx.amount_in ||
            tx.amount_out ||
            '0'
          ) || 0;
        // Upstream intent rows report raw NEP-141 base units — yocto for NEAR,
        // micro for USDC — with no human figure attached. Multiplying those by a
        // USD price is what turned a handful of small sends into $476,901.98.
        // Only rows this worker built from its own D1 records (marked 'human')
        // may be priced; everything else is reported as unpriced.
        const humanReadable = tx.amount_source === 'human';
        const price = humanReadable ? usdFor(assetKeys(tx), symbolFor(tx)) : null;
        const usd = price !== null && amt > 0 ? amt * price : null;
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
          add('in', usd);
        } else if (
          isSender ||
          tx.type === 'send' ||
          tx.type === 'withdraw' ||
          tx.intent_type === 'transfer'
        ) {
          add('out', usd);
        }
      }
    }

    return {
      inflowCount,
      // Nothing priceable at all -> unknown, not "$0.00".
      inflowUsd: inflowUnpriced > 0 && inflowPriced === 0 ? null : inflowPriced,
      inflowUnpriced,
      egressCount,
      egressUsd: egressUnpriced > 0 && egressPriced === 0 ? null : egressPriced,
      egressUnpriced,
    };
  }, [history, transactions, tokens, user]);

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
                  <span>Received this week</span>
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                </h4>
                <p className="text-[11px] font-mono text-stone-400">
                  Money in · Last 7 days
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
              {formatUsd(stats.inflowUsd)}
            </div>
            <div className="text-xs text-stone-500 font-sans flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Deposits and payments you received</span>
            </div>
            {stats.inflowUnpriced > 0 && (
              <div className="text-[11px] font-mono text-amber-600">
                Subtotal · {stats.inflowUnpriced} of {stats.inflowCount} txs unpriced
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-6 border-t border-stone-100 flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-stone-400 truncate">
            Add funds from any wallet or chain
          </span>
          <Link
            to="/app/receive"
            className="px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95 flex-shrink-0"
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
                  <span>Sent this week</span>
                  <Lock className="w-3.5 h-3.5 text-orange-600" />
                </h4>
                <p className="text-[11px] font-mono text-stone-400">
                  Money out · Last 7 days
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
              {formatUsd(stats.egressUsd)}
            </div>
            <div className="text-xs text-stone-500 font-sans flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              <span>Sends and withdrawals you made</span>
            </div>
            {stats.egressUnpriced > 0 && (
              <div className="text-[11px] font-mono text-amber-600">
                Subtotal · {stats.egressUnpriced} of {stats.egressCount} txs unpriced
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-6 border-t border-stone-100 flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-stone-400 truncate">
            Send to any 𝕏 handle or wallet
          </span>
          <Link
            to="/app/send"
            className="px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-black text-white font-display font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95 flex-shrink-0"
          >
            <span>Send</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
