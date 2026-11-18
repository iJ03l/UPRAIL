'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle,
  Clock,
  WarningCircle,
  ArrowSquareOut,
  CircleNotch,
} from '@phosphor-icons/react';
import { Link } from '../lib/router';
import { api, formatTokenAmount, cleanMemeSymbol } from '../lib/api';
import { GlitchLogo } from '../components/GlitchLogo';
import { Badge, type BadgeTone } from '../components/Badge';
import type { WithdrawalReceipt } from '../types';

function shortenAddress(addr: string): string {
  if (!addr) return '';
  if (addr.startsWith('nearcom:')) {
    const raw = addr.slice(8);
    if (raw.length <= 16) return addr;
    return `nearcom:${raw.slice(0, 6)}…${raw.slice(-4)}`;
  }
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface ReceiptPageProps {
  id: string;
}

export const ReceiptPage: React.FC<ReceiptPageProps> = ({ id }) => {
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api
      .getWithdrawalReceipt(id)
      .then((r) => {
        if (!cancelled) setReceipt(r);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const statusBadge: { label: string; tone: BadgeTone; Icon: typeof CheckCircle } = (() => {
    const status = (receipt?.status || '').toUpperCase();
    if (status === 'COMPLETED')
      return { label: 'Completed', tone: 'ok', Icon: CheckCircle };
    if (status === 'PENDING')
      return { label: 'Pending', tone: 'warn', Icon: Clock };
    if (status === 'FAILED')
      return { label: 'Failed', tone: 'danger', Icon: WarningCircle };
    return { label: 'Confirmed', tone: 'neutral', Icon: CheckCircle };
  })();

  const explorerUrl = receipt?.txHash ? `https://nearblocks.io/txns/${receipt.txHash}` : null;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-12 bg-surface">
      <div className="mb-6">
        <GlitchLogo href="/" size="md" />
      </div>

      <div className="w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-sm p-6 sm:p-8 space-y-5">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-stone-400">
            <CircleNotch weight="bold" className="w-6 h-6 animate-spin" />
            <span className="text-xs font-mono">Loading receipt…</span>
          </div>
        ) : !receipt ? (
          <div className="py-14 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-500">
              <WarningCircle weight="fill" className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-extrabold text-stone-950 font-display">
              Receipt not found
            </h3>
            <p className="text-xs text-stone-500 max-w-xs">
              This receipt link is invalid or has expired.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-sm">
                  <ArrowUpRight weight="bold" className="w-7 h-7" />
                </div>
              </div>
              <Badge tone={statusBadge.tone} icon={<statusBadge.Icon className="w-3 h-3" />}>
                {statusBadge.label}
              </Badge>
              <h3 className="text-xl font-extrabold text-stone-950 font-display">
                {statusBadge.label === 'Failed' ? 'Withdrawal Failed' : 'Payment Sent'}
              </h3>
              <div className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight font-mono break-words px-2">
                {formatTokenAmount(receipt.amount)} {cleanMemeSymbol(receipt.asset) || receipt.asset}
              </div>
            </div>

            {statusBadge.label === 'Failed' && receipt.failureReason && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-xs">
                <WarningCircle weight="fill" className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-red-800 leading-relaxed break-words">{receipt.failureReason}</p>
              </div>
            )}

            <div className="rounded-2xl bg-stone-50 border border-stone-200 divide-y divide-stone-200 text-xs font-mono">
              {receipt.fromHandle && (
                <div className="flex items-center justify-between px-4 py-3 gap-2">
                  <span className="text-stone-500 flex-shrink-0">From</span>
                  <span className="font-bold text-stone-900 truncate">@{receipt.fromHandle}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="text-stone-500 flex-shrink-0">To</span>
                <span
                  className="font-bold text-stone-900 truncate max-w-[200px] sm:max-w-[240px] text-right"
                  title={receipt.destinationAddress}
                >
                  {shortenAddress(receipt.destinationAddress)}
                </span>
              </div>
              {receipt.txHash && (
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <span className="text-stone-500">Transaction</span>
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-stone-900 underline underline-offset-2 hover:text-black flex items-center space-x-1"
                    >
                      <span>{receipt.txHash.slice(0, 10)}…</span>
                      <ArrowSquareOut weight="fill" className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="font-bold text-stone-900">
                      {receipt.txHash.slice(0, 12)}…
                    </span>
                  )}
                </div>
              )}
              {receipt.createdAt && (
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-stone-500">Date</span>
                  <span className="font-bold text-stone-900">{formatDate(receipt.createdAt)}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-stone-500 text-center">
              Confidential cross-chain settlement on UPRAIL. This receipt proves the transfer
              happened — it never grants access to funds.
            </p>
          </>
        )}

        <div className="pt-1 flex items-center justify-center gap-2">
          <Link
            to="/app/send"
            className="px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center space-x-1.5"
          >
            Send on UPRAIL
            <ArrowUpRight weight="bold" className="w-3.5 h-3.5" />
          </Link>
          <Link
            to="/"
            className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 font-bold text-xs uppercase tracking-wider transition-colors"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
};
