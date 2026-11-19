'use client';

import React from 'react';
import { Check } from '@phosphor-icons/react';
import type { EarnVaultDescriptor, EarnVaultSymbol } from '../types';

export interface NormalizedVaultRisk {
  principalType: 'usd_stable' | 'volatile_crypto';
  riskTier: 'core' | 'moderate' | 'elevated';
  requiresRiskAck: boolean;
  underlyingSymbol: string;
}

const FALLBACK_RISK_BY_SYMBOL: Record<string, Partial<NormalizedVaultRisk>> = {
  gtUSDCp: {
    principalType: 'usd_stable',
    riskTier: 'core',
    requiresRiskAck: false,
    underlyingSymbol: 'USDC',
  },
  TLO: {
    principalType: 'usd_stable',
    riskTier: 'moderate',
    requiresRiskAck: false,
    underlyingSymbol: 'USDC',
  },
  wstETH: {
    principalType: 'volatile_crypto',
    riskTier: 'core',
    requiresRiskAck: true,
    underlyingSymbol: 'ETH',
  },
  stNEAR: {
    principalType: 'volatile_crypto',
    riskTier: 'moderate',
    requiresRiskAck: true,
    underlyingSymbol: 'NEAR',
  },
  cNEAR: {
    principalType: 'volatile_crypto',
    riskTier: 'elevated',
    requiresRiskAck: true,
    underlyingSymbol: 'NEAR',
  },
  'kV-gtSOLb': {
    principalType: 'volatile_crypto',
    riskTier: 'elevated',
    requiresRiskAck: true,
    underlyingSymbol: 'SOL',
  },
};

export function getVaultRiskMeta(
  vault?: Partial<EarnVaultDescriptor> | null
): NormalizedVaultRisk {
  const sym = vault?.symbol || '';
  const fb = FALLBACK_RISK_BY_SYMBOL[sym] || {};
  const underlyingSymbol = vault?.underlyingSymbol || fb.underlyingSymbol || 'USDC';
  const principalType: 'usd_stable' | 'volatile_crypto' =
    vault?.principalType ||
    fb.principalType ||
    (underlyingSymbol.toUpperCase() === 'USDC' || underlyingSymbol.toUpperCase() === 'USDT'
      ? 'usd_stable'
      : 'volatile_crypto');
  const riskTier: 'core' | 'moderate' | 'elevated' =
    vault?.riskTier || fb.riskTier || (principalType === 'usd_stable' ? 'moderate' : 'elevated');
  const requiresRiskAck =
    typeof vault?.requiresRiskAck === 'boolean'
      ? vault.requiresRiskAck
      : typeof fb.requiresRiskAck === 'boolean'
      ? fb.requiresRiskAck
      : principalType === 'volatile_crypto' || riskTier === 'elevated';

  return {
    principalType,
    riskTier,
    requiresRiskAck,
    underlyingSymbol,
  };
}

export function formatSignedUsdChange(
  netChangeUsdCents: number | undefined | null,
  yieldUsdCents: number | undefined | null,
  formatCentsUsd: (cents: number | undefined | null) => string
): { label: string; isNegative: boolean; isPositive: boolean } {
  const cents =
    typeof netChangeUsdCents === 'number' && Number.isFinite(netChangeUsdCents)
      ? netChangeUsdCents
      : typeof yieldUsdCents === 'number' && Number.isFinite(yieldUsdCents)
      ? yieldUsdCents
      : 0;
  if (cents < 0) {
    return {
      label: `-${formatCentsUsd(Math.abs(cents))}`,
      isNegative: true,
      isPositive: false,
    };
  }
  return {
    label: `+${formatCentsUsd(cents)}`,
    isNegative: false,
    isPositive: cents > 0,
  };
}

export const VaultRiskBadges: React.FC<{
  vault?: Partial<EarnVaultDescriptor> | null;
  compact?: boolean;
}> = ({ vault, compact = false }) => {
  const risk = getVaultRiskMeta(vault);

  return (
    <span
      className={`font-mono font-bold rounded border ${
        compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-1.5 py-0.5'
      } ${
        risk.principalType === 'usd_stable'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-800 border-amber-200'
      }`}
    >
      {risk.principalType === 'usd_stable' ? 'Stable' : 'Volatile'}
    </span>
  );
};

export const VaultPickerCardList: React.FC<{
  vaults: EarnVaultDescriptor[];
  value: EarnVaultSymbol;
  onChange: (symbol: EarnVaultSymbol) => void;
  disabled?: boolean;
}> = ({ vaults, value, onChange, disabled = false }) => {
  return (
    <div className="rounded-xl border border-stone-200 divide-y divide-stone-200 overflow-hidden bg-white">
      {vaults.map((v) => {
        const isSelected = v.symbol === value;
        return (
          <div
            key={v.assetId}
            onClick={() => {
              if (!disabled) onChange(v.symbol as EarnVaultSymbol);
            }}
            className={`px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
              disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            } ${isSelected ? 'bg-stone-950/[0.04]' : 'hover:bg-stone-50'}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? 'bg-stone-950 border-stone-950 text-white'
                    : 'border-stone-300 bg-white'
                }`}
              >
                {isSelected && <Check weight="bold" className="w-2.5 h-2.5" />}
              </div>
              <span className="font-display font-extrabold text-xs text-stone-950">
                {v.symbol}
              </span>
              <VaultRiskBadges vault={v} compact />
            </div>

            <span className="text-[11px] font-mono font-bold text-emerald-700 whitespace-nowrap">
              {v.estimatedApyPct.toFixed(1)}% APY
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const VaultRiskAckBox: React.FC<{
  vault?: EarnVaultDescriptor | null;
  acknowledged: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ vault, acknowledged, onToggle, disabled = false }) => {
  if (!vault) return null;
  const risk = getVaultRiskMeta(vault);
  if (!risk.requiresRiskAck) return null;

  return (
    <label
      className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-medium text-amber-950 select-none ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={acknowledged}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-amber-400 accent-stone-950 flex-shrink-0"
      />
      <span>
        I understand <strong>{vault.symbol}</strong> is volatile.
      </span>
    </label>
  );
};
