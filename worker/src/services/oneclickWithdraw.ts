/**
 * 1Click Cross-Chain Withdrawal Service
 *
 * Bridges funds held in confidential NEAR escrow out to destination chains
 * (EVM, Solana, Bitcoin) via 1Click Swap API (https://1click.chaindefuser.com).
 *
 * Fail-closed design:
 *   - Live quotes are requested from 1Click
 *   - The 1Click depositAddress (intents solver route on NEAR) is obtained
 *   - Escrow executes an intent transfer to the 1Click depositAddress
 *   - The deposit tx hash is reported to 1Click for solver settlement
 *   - No dummy transaction hashes or synthetic success states
 */

import type { Env } from '../types';

export interface CrossChainQuoteParams {
  destinationAddress: string;
  asset: string;
  amount: number;
}

export interface CrossChainQuoteResult {
  depositAddress: string;
  quoteId?: string;
  amountIn: string;
  amountOut?: string;
  destinationAsset: string;
  originAsset: string;
}

// Regex patterns for supported address formats
export const NEAR_ACCOUNT_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)*$/;
export const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BITCOIN_ADDRESS_REGEX = /^(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

export function isValidDestinationAddress(address: string): boolean {
  const clean = address.trim();
  if (!clean || clean.length > 100) return false;
  if (EVM_ADDRESS_REGEX.test(clean)) return true;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return true;
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return true;
  if (clean.length <= 64 && NEAR_ACCOUNT_REGEX.test(clean)) return true;
  return false;
}

export function isNearAccountAddress(address: string): boolean {
  const clean = address.trim();
  // Solana addresses are base58 without dots, EVM starts with 0x, BTC starts with bc1/1/3
  if (EVM_ADDRESS_REGEX.test(clean)) return false;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return false;
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) {
    // If it contains uppercase letters or doesn't end in .near, it is Solana
    if (/[A-Z]/.test(clean) || clean.length !== 64) return false;
  }
  return clean.length <= 64 && NEAR_ACCOUNT_REGEX.test(clean);
}

function resolveAssetPair(asset: string, destinationAddress: string): {
  originAsset: string;
  destinationAsset: string;
  decimals: number;
} {
  const cleanAsset = asset.toLowerCase();
  const isEvm = EVM_ADDRESS_REGEX.test(destinationAddress);
  const isSol = !destinationAddress.includes('.') && SOLANA_ADDRESS_REGEX.test(destinationAddress);
  const isBtc = BITCOIN_ADDRESS_REGEX.test(destinationAddress);

  if (cleanAsset === 'btc' || isBtc) {
    return {
      originAsset: 'nep141:btc.omft.near',
      destinationAsset: 'nep141:btc.omft.near',
      decimals: 8,
    };
  }

  if (cleanAsset === 'usdt') {
    let dest = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
    if (isSol) dest = 'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near';
    return {
      originAsset: 'nep141:usdt.tether-token.near',
      destinationAsset: dest,
      decimals: 6,
    };
  }

  if (cleanAsset === 'near') {
    return {
      originAsset: 'wrap.near',
      destinationAsset: 'wrap.near',
      decimals: 24,
    };
  }

  // Default: USDC
  let dest = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'; // Base USDC default for EVM
  if (isSol) {
    dest = 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near';
  }
  return {
    originAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    destinationAsset: dest,
    decimals: 6,
  };
}

function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const d = Math.max(0, Math.min(Math.trunc(decimals), 30));
  // Never multiply a float by 10**decimals: that loses precision at large
  // magnitudes and for 8/24-decimal assets. `toFixed` emits a plain decimal
  // string, so shifting the point by string surgery is exact for the
  // precision the input number actually carries.
  const [whole, frac = ''] = amount.toFixed(d).split('.');
  const padded = (frac + '0'.repeat(d)).slice(0, d);
  return BigInt(whole + padded).toString();
}

/**
 * Requests a live cross-chain withdrawal quote from 1Click.
 * Returns the intents deposit address on NEAR where escrow funds must be deposited.
 */
export async function get1ClickWithdrawalQuote(
  env: Env,
  params: CrossChainQuoteParams
): Promise<CrossChainQuoteResult> {
  const { originAsset, destinationAsset, decimals } = resolveAssetPair(params.asset, params.destinationAddress);
  const amountInBaseUnits = toBaseUnits(params.amount, decimals);
  const apiBase = (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/$/, '');
  const escrowAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const body = {
    dry: false,
    swapType: 'EXACT_INPUT',
    originAsset,
    destinationAsset,
    amount: amountInBaseUnits,
    recipient: params.destinationAddress,
    recipientType: 'DESTINATION_CHAIN',
    refundTo: escrowAccount,
    refundType: 'INTENTS',
    depositType: 'INTENTS',
    slippageTolerance: 100, // 1%
    deadline,
  };

  const resp = await fetch(`${apiBase}/v0/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`1Click quote failed (${resp.status}): ${errText}`);
  }

  const data = (await resp.json()) as any;
  const depositAddress = data?.quote?.depositAddress;
  if (!depositAddress || typeof depositAddress !== 'string') {
    throw new Error('1Click quote returned no depositAddress for cross-chain settlement');
  }

  return {
    depositAddress,
    quoteId: data?.quote?.quoteId || data?.correlationId,
    amountIn: data?.quote?.amountIn || amountInBaseUnits,
    amountOut: data?.quote?.amountOut,
    destinationAsset,
    originAsset,
  };
}

/**
 * Notifies 1Click that the escrow transfer has been submitted to the deposit address.
 */
export async function submit1ClickDeposit(
  env: Env,
  txHash: string,
  depositAddress: string
): Promise<void> {
  const apiBase = (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/$/, '');
  try {
    const resp = await fetch(`${apiBase}/v0/deposit/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        txHash,
        depositAddress,
      }),
    });
    if (!resp.ok) {
      console.warn(`[1Click] submit deposit non-200 (${resp.status}) for ${depositAddress}`);
    }
  } catch (err) {
    console.warn('[1Click] submit deposit network notice:', err);
  }
}
