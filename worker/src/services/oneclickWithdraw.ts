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
  /**
   * Explicit destination network for an EVM address, which is otherwise
   * ambiguous (one 0x address lives on every EVM chain). When omitted, the
   * chain is inferred from the address shape exactly as before.
   */
  destinationChain?: string;
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

/** Chain family used to sanity-check a chosen network against the address. */
export const WITHDRAW_CHAIN_FAMILY: Record<string, 'evm' | 'sol' | 'btc' | 'near'> = {
  eth: 'evm',
  base: 'evm',
  arbitrum: 'evm',
  op: 'evm',
  pol: 'evm',
  avax: 'evm',
  bsc: 'evm',
  sol: 'sol',
  btc: 'btc',
  near: 'near',
};

/**
 * NEAR-side (intents) source assets, keyed by canonical symbol. The withdraw
 * path receives a full defuse asset id, so these are the exact origin assets
 * 1Click must be told escrow is depositing — a mismatch strands the transfer.
 */
const ORIGIN_ASSETS: Record<string, { originAsset: string; decimals: number }> = {
  usdc: {
    originAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: 6,
  },
  usdt: { originAsset: 'nep141:usdt.tether-token.near', decimals: 6 },
  near: { originAsset: 'wrap.near', decimals: 24 },
  btc: { originAsset: 'nep141:btc.omft.near', decimals: 8 },
  eth: { originAsset: 'nep141:eth.bridge.near', decimals: 18 },
  sol: { originAsset: 'nep141:sol.omft.near', decimals: 9 },
  doge: { originAsset: 'nep141:doge.omft.near', decimals: 8 },
};

/**
 * Destination-chain asset ids 1Click understands, per canonical symbol. A
 * symbol/chain pair absent here fails closed rather than guessing a network.
 */
const DESTINATION_ASSETS: Record<string, Record<string, string>> = {
  usdc: {
    base: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    arbitrum: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    eth: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    op: 'nep141:op-0x0b2c639c533813f4aa9d7837caf62653d097ff85.omft.near',
    avax: 'nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omft.near',
    pol: 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L',
    sol: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    near: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  },
  usdt: {
    eth: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
    sol: 'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near',
    near: 'nep141:usdt.tether-token.near',
    bsc: 'nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g',
  },
  eth: {
    eth: 'nep141:eth.omft.near',
    base: 'nep141:base.omft.near',
    arbitrum: 'nep141:arb.omft.near',
  },
  near: { near: 'wrap.near' },
  btc: { btc: 'nep141:btc.omft.near' },
  sol: { sol: 'nep141:sol.omft.near' },
  doge: { doge: 'nep141:doge.omft.near' },
};

/** Normalizes a defuse asset id (or bare symbol) to a canonical symbol. */
function canonicalAssetSymbol(asset: string): string {
  const a = (asset || '').trim().toLowerCase();
  if (a.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')) return 'usdc';
  if (a.includes('usdt.tether-token.near')) return 'usdt';
  if (a.includes('wrap.near') || a === 'near' || a === 'native') return 'near';
  if (a.includes('btc.omft.near') || a.includes('2260fac5e5542a773aa44fbcfedf7c193bc2c599')) return 'btc';
  if (a.includes('eth.bridge.near') || a === 'eth') return 'eth';
  if (a.includes('sol.omft.near') || a === 'sol') return 'sol';
  if (a.includes('doge.omft.near')) return 'doge';
  return a;
}

/** Best-guess chain when the caller did not choose one. EVM defaults to Base. */
export function inferChainFromAddress(address: string): string {
  const clean = address.trim();
  if (EVM_ADDRESS_REGEX.test(clean)) return 'base';
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return 'btc';
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return 'sol';
  return 'near';
}

/** True when `address` is valid for the requested chain's family. */
export function chainMatchesAddress(chain: string, address: string): boolean {
  const family = WITHDRAW_CHAIN_FAMILY[chain];
  if (!family) return false;
  const clean = address.trim();
  if (family === 'evm') return EVM_ADDRESS_REGEX.test(clean);
  if (family === 'btc') return BITCOIN_ADDRESS_REGEX.test(clean);
  if (family === 'sol') {
    return (
      !EVM_ADDRESS_REGEX.test(clean) &&
      !BITCOIN_ADDRESS_REGEX.test(clean) &&
      !clean.includes('.') &&
      SOLANA_ADDRESS_REGEX.test(clean)
    );
  }
  return isNearAccountAddress(clean);
}

function resolveAssetPair(
  asset: string,
  destinationAddress: string,
  destinationChain?: string
): {
  originAsset: string;
  destinationAsset: string;
  decimals: number;
} {
  const symbol = canonicalAssetSymbol(asset);
  const origin = ORIGIN_ASSETS[symbol];
  if (!origin) {
    throw new Error(`Withdrawals are not supported for this asset yet`);
  }

  const chain =
    (destinationChain && destinationChain.trim().toLowerCase()) ||
    inferChainFromAddress(destinationAddress);

  const destinationAsset = (DESTINATION_ASSETS[symbol] || {})[chain];
  if (!destinationAsset) {
    throw new Error(
      `Sending ${symbol.toUpperCase()} to ${chain} is not supported yet — choose another network`
    );
  }

  return {
    originAsset: origin.originAsset,
    destinationAsset,
    decimals: origin.decimals,
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
  const { originAsset, destinationAsset, decimals } = resolveAssetPair(
    params.asset,
    params.destinationAddress,
    params.destinationChain
  );
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
