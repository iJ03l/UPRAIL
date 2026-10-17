/**
 * x402 (v2) + Machine Payments Protocol (MPP) wire helpers for UPRAIL.
 *
 * UPRAIL acts as both a resource server (gating its own paid endpoints) and a
 * facilitator/settlement layer for merchants: a 402 challenge carries a
 * single-use 1Click deposit address, the client pays on any supported chain,
 * and settlement is confirmed by polling 1Click for the deposit. This is the
 * `nearintents` payment method used by MPP, expressed in x402 v2 headers.
 *
 * Wire format (HTTP):
 *   server → client  402 + PAYMENT-REQUIRED: <base64 PaymentRequired>
 *   client → server  PAYMENT-SIGNATURE: <base64 PaymentPayload>
 *   server → client  PAYMENT-RESPONSE: <base64 SettlementResponse>
 * MPP equivalents (accepted on the way in): WWW-Authenticate: Payment /
 * Authorization: Payment.
 */

import type { Env } from '../types';

export const X402_VERSION = 2 as const;
/** CAIP-2 identifier for NEAR mainnet. */
export const NEAR_MAINNET = 'near:mainnet';
export const NEAR_INTENTS_METHOD = 'nearintents';

export interface X402ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface X402Accept {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource: X402ResourceInfo;
  accepts: X402Accept[];
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
}

export interface X402SettlementResponse {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  amount?: string;
  errorReason?: string;
  errorDetail?: string;
}

// ─── Base64 (UTF-8 safe) ─────────────────────────────────────────────────────

export function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64Decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodePaymentRequired(req: X402PaymentRequired): string {
  return base64Encode(JSON.stringify(req));
}

export function decodePaymentPayload(header: string | null | undefined): X402PaymentPayload | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(base64Decode(header.trim()));
    if (parsed && typeof parsed === 'object') return parsed as X402PaymentPayload;
    return null;
  } catch {
    return null;
  }
}

export function encodeSettlement(res: X402SettlementResponse): string {
  return base64Encode(JSON.stringify(res));
}

// ─── Asset decimals for atomic-amount display ────────────────────────────────

const ASSET_DECIMALS: Record<string, number> = {
  NEAR: 24,
  WNEAR: 24,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  ETH: 18,
  BTC: 8,
  SOL: 9,
  RHEA: 18,
  NEARLY: 18,
};

/** Decimals for a symbol/contract, defaulting to 6 (stablecoin-like). */
export function assetDecimals(asset: string): number {
  const upper = (asset || '').toUpperCase();
  if (ASSET_DECIMALS[upper] !== undefined) return ASSET_DECIMALS[upper];
  if (upper.startsWith('NEP141:')) {
    const tail = upper.slice(7).toLowerCase();
    // Match a symbol label of the contract, ignoring the trailing TLD-ish
    // label ("usdc.token.near" → usdc, not the ".near" parent domain).
    const labels = tail.split(/[.\-:]/).filter(Boolean);
    const inner = labels.slice(0, -1);
    for (const [sym, dec] of Object.entries(ASSET_DECIMALS)) {
      if (inner.includes(sym.toLowerCase())) return dec;
    }
    if (tail === 'near' || tail === 'wrapped.near' || tail.endsWith('.wrap.near') || tail === 'wrap.near') {
      return ASSET_DECIMALS.NEAR;
    }
  }
  return 6;
}

/** Converts a human decimal amount to atomic units (string). */
export function toAtomic(amount: string, decimals: number): string {
  const [intPart, fracPartRaw = ''] = String(amount).trim().split('.');
  const fracPart = (fracPartRaw + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${intPart || '0'}${fracPart}`.replace(/^0+/, '');
  return combined || '0';
}

// ─── 1Click deposit probe (settlement confirmation) ──────────────────────────

export interface DepositProbe {
  status: string;
  isSettled: boolean;
  txHashes: string[];
  depositedAmount: string;
  depositedAmountFormatted: string;
  depositedAmountUsd: string;
  payer?: string;
  error?: string;
}

/**
 * Reads the 1Click status of a deposit address. Mirrors the deposit-status
 * route: a non-OK upstream response is surfaced as an error rather than being
 * silently collapsed into "pending", so a caller can distinguish "not paid"
 * from "settlement service is down".
 */
export async function probeDeposit(env: Env, depositAddress: string): Promise<DepositProbe> {
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(
      `${apiBase}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible) UPRAIL/1.0',
          Accept: 'application/json',
        },
      }
    );
    if (!resp.ok) {
      return emptyProbe('UNKNOWN', `1Click status returned ${resp.status}`);
    }
    const data = (await resp.json()) as any;
    const swap = data.swapDetails || data.quoteResponse?.swapDetails || {};
    const txHashes: string[] = [
      ...(swap.nearTxHashes || []),
      ...(swap.originChainTxHashes || []),
      ...(swap.destinationChainTxHashes || []),
    ].filter((h: unknown): h is string => typeof h === 'string');

    const depAmt = parseFloat(swap.depositedAmountFormatted || '0') || 0;
    const status = String(data.status || 'PENDING_DEPOSIT');
    return {
      status,
      isSettled: status === 'SUCCESS' || depAmt > 0,
      txHashes,
      depositedAmount: swap.depositedAmount || '0',
      depositedAmountFormatted: swap.depositedAmountFormatted || '0',
      depositedAmountUsd: swap.depositedAmountUsd || '0',
      payer: swap.senderAddress || data.senderAddress || undefined,
    };
  } catch (err: any) {
    return emptyProbe('UNKNOWN', err?.message || 'deposit probe failed');
  } finally {
    clearTimeout(timeoutId);
  }
}

function emptyProbe(status: string, error: string): DepositProbe {
  return {
    status,
    isSettled: false,
    txHashes: [],
    depositedAmount: '0',
    depositedAmountFormatted: '0',
    depositedAmountUsd: '0',
    error,
  };
}

// ─── Replay guard (KV) ───────────────────────────────────────────────────────

/** Marks a settlement proof as spent; returns false if it was already used. */
export async function consumeSettlementProof(env: Env, key: string): Promise<boolean> {
  if (!env.CACHE) return true; // no KV → cannot dedupe; fail open (best effort)
  const kvKey = `x402:used:${key}`;
  try {
    const existing = await env.CACHE.get(kvKey);
    if (existing) return false;
    await env.CACHE.put(kvKey, '1', { expirationTtl: 24 * 3600 });
    return true;
  } catch {
    return true;
  }
}
