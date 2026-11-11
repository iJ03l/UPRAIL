/**
 * Earn Vault Catalog & Per-Item Custody Service (`worker/src/services/earnVaults.ts`).
 *
 * Powers both UPRAIL Circles (multi-member quota Earn vaults) and 1-to-1 Timelocked
 * Earn Vault Gifting:
 *   1. Server-side allowlist of 1Click Earn receipt tokens (TLO, gtUSDCp, kV-gtSOLb)
 *      enriched with live 1Click token registry prices and decimals.
 *   2. Deterministic per-item custody keypair derivation (`HMAC-SHA256(escrowPrivKey, "earn_custody:" + itemId)`).
 *      Uses 64-hex implicit NEAR account IDs on `intents.near`, which are natively
 *      authorized for NEP-413 intents without on-chain sub-account registration races.
 *   3. Exact BigInt atomic share valuation, 1% protocol fee split, and gas-sponsored
 *      NEP-413 transfers out of custody upon gift claim or circle settlement/refund.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import type { Env } from '../types';
import * as nearRpc from './nearRpc';
import { getOneClickTokens, type OneClickToken } from './stabilize';
import { formatAtomic } from './confidentialRail';

export class EarnVaultError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'EarnVaultError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface EarnVaultDescriptor {
  symbol: string;
  name: string;
  protocol: string;
  chain: string;
  chainName: string;
  underlyingSymbol: string;
  assetId: string;
  decimals: number;
  estimatedApyPct: number;
  minDepositUsd: number;
  priceUsd: number;
  available: boolean;
}

export interface EarnCustodyKey {
  itemId: string;
  accountId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyB58: string;
}

export interface VaultPositionValuation {
  sharesAtomic: string;
  sharesFormatted: string;
  sharePriceUsd: number;
  principalUsdCents: number;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  yieldPct: number;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  let num = BigInt('0x' + hex);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    out = BASE58_ALPHABET[rem] + out;
    num /= 58n;
  }
  return '1'.repeat(zeroes) + out;
}

function base58Decode(str: string): Uint8Array {
  const clean = str.trim().replace(/^ed25519:/, '');
  if (!clean) return new Uint8Array(0);
  let zeroes = 0;
  while (zeroes < clean.length && clean[zeroes] === '1') zeroes++;
  let num = 0n;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE58_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error(`Invalid base58 character: ${clean[i]}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num === 0n ? '' : num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const rawBytes = new Uint8Array(zeroes + hex.length / 2);
  for (let i = 0; i < hex.length / 2; i++) {
    rawBytes[zeroes + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return rawBytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Authoritative allowlist of 1Click Earn receipt tokens.
 * Server never accepts an arbitrary client-supplied `vault_asset_id` outside this list.
 */
export const CURATED_EARN_VAULTS: ReadonlyArray<Omit<EarnVaultDescriptor, 'available'>> = [
  {
    symbol: 'TLO',
    name: 'Taler USDC Vault',
    protocol: 'Taler',
    chain: 'eth',
    chainName: 'Ethereum',
    underlyingSymbol: 'USDC',
    assetId: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    decimals: 8,
    estimatedApyPct: 6.2,
    minDepositUsd: 10,
    priceUsd: 1.028245,
  },
  {
    symbol: 'gtUSDCp',
    name: 'Gauntlet USDC Prime',
    protocol: 'Morpho (Gauntlet)',
    chain: 'base',
    chainName: 'Base',
    underlyingSymbol: 'USDC',
    assetId: 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near',
    decimals: 18,
    estimatedApyPct: 7.4,
    minDepositUsd: 25,
    priceUsd: 0.0000011178,
  },
  {
    symbol: 'kV-gtSOLb',
    name: 'Kamino Gauntlet SOL',
    protocol: 'Kamino',
    chain: 'sol',
    chainName: 'Solana',
    underlyingSymbol: 'SOL',
    assetId: 'nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near',
    decimals: 9,
    estimatedApyPct: 8.1,
    minDepositUsd: 10,
    priceUsd: 89.52,
  },
  {
    symbol: 'stNEAR',
    name: 'Meta Pool Staked NEAR',
    protocol: 'Meta Pool',
    chain: 'near',
    chainName: 'NEAR',
    underlyingSymbol: 'NEAR',
    assetId: 'nep141:meta-pool.near',
    decimals: 24,
    estimatedApyPct: 9.2,
    minDepositUsd: 5,
    priceUsd: 5.71,
  },
  {
    symbol: 'cNEAR',
    name: 'Compounding NEAR Vault',
    protocol: 'Assetize / Linear',
    chain: 'near',
    chainName: 'NEAR',
    underlyingSymbol: 'NEAR',
    assetId: 'nep141:cnear.assetize.near',
    decimals: 24,
    estimatedApyPct: 8.8,
    minDepositUsd: 5,
    priceUsd: 3.75,
  },
  {
    symbol: 'wstETH',
    name: 'Lido Wrapped Staked ETH',
    protocol: 'Lido',
    chain: 'eth',
    chainName: 'Ethereum',
    underlyingSymbol: 'ETH',
    assetId: 'nep141:eth-0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0.omft.near',
    decimals: 18,
    estimatedApyPct: 3.4,
    minDepositUsd: 15,
    priceUsd: 2590.0,
  },
];

/**
 * Returns the live Earn vault catalog enriched with current 1Click token registry
 * prices and decimals.
 */
export async function getEarnVaults(
  env: Env,
  preloadedTokens?: OneClickToken[]
): Promise<EarnVaultDescriptor[]> {
  const tokens =
    preloadedTokens || (await getOneClickTokens(env).catch(() => [] as OneClickToken[]));
  const byAssetId = new Map<string, OneClickToken>();
  for (const t of tokens) {
    byAssetId.set(t.assetId.toLowerCase(), t);
  }

  return CURATED_EARN_VAULTS.map((vault) => {
    const live = byAssetId.get(vault.assetId.toLowerCase());
    const livePrice =
      typeof live?.price === 'number' && Number.isFinite(live.price) && live.price > 0
        ? live.price
        : vault.priceUsd;
    const liveDecimals =
      typeof live?.decimals === 'number' && Number.isFinite(live.decimals)
        ? live.decimals
        : vault.decimals;
    return {
      ...vault,
      decimals: liveDecimals,
      priceUsd: livePrice,
      available: tokens.length === 0 ? true : Boolean(live),
    };
  });
}

/**
 * Strictly resolves a vault by symbol or assetId against the server allowlist.
 * Throws `UNSUPPORTED_EARN_VAULT` (400) if not found.
 */
export async function resolveEarnVault(
  env: Env,
  vaultSymbolOrAssetId: string,
  preloadedTokens?: OneClickToken[]
): Promise<EarnVaultDescriptor> {
  const raw = (vaultSymbolOrAssetId || '').trim();
  if (!raw) {
    throw new EarnVaultError('MISSING_EARN_VAULT', 'Select an Earn vault asset.', 400);
  }
  const lower = raw.toLowerCase();
  const vaults = await getEarnVaults(env, preloadedTokens);
  const match = vaults.find(
    (v) => v.symbol.toLowerCase() === lower || v.assetId.toLowerCase() === lower
  );
  if (!match) {
    throw new EarnVaultError(
      'UNSUPPORTED_EARN_VAULT',
      `"${raw}" is not a supported 1Click Earn vault asset.`,
      400
    );
  }
  return match;
}

/**
 * Deterministically derives a dedicated Ed25519 custody keypair and 64-hex implicit
 * NEAR account ID for a specific Gift (`gft_...`) or Circle (`circ_...`).
 *
 * Because implicit account IDs equal the 32-byte Ed25519 public key in hex,
 * `intents.near` natively recognizes the key (`has_public_key === true`) without
 * needing an on-chain `add_public_key` transaction.
 */
export async function deriveEarnCustodyKey(
  env: Env,
  itemId: string
): Promise<EarnCustodyKey> {
  const cleanId = (itemId || '').trim();
  if (!/^(gft|circ)_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new EarnVaultError('INVALID_CUSTODY_ID', 'Invalid gift or circle identifier.', 400);
  }
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) {
    throw new EarnVaultError(
      'CUSTODY_KEY_UNCONFIGURED',
      'Server custody key is not configured.',
      503
    );
  }
  const escrowRaw = base58Decode(privKeyStr);
  const masterSeed = escrowRaw.slice(0, 32);
  if (masterSeed.length !== 32) {
    throw new EarnVaultError('CUSTODY_KEY_INVALID', 'Invalid server master key.', 503);
  }

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    masterSeed,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const domainMsg = new TextEncoder().encode(`uprail_earn_custody_v1:${cleanId}`);
  const derivedPriv = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, domainMsg));
  const derivedPub = ed25519.getPublicKey(derivedPriv);
  const accountId = bytesToHex(derivedPub);

  return {
    itemId: cleanId,
    accountId,
    publicKey: derivedPub,
    privateKey: derivedPriv,
    publicKeyB58: `ed25519:${base58Encode(derivedPub)}`,
  };
}

/**
 * Generates a cryptographically strong 128-bit hex ID with prefix (`gft_` or `circ_` or `cmem_` or `ccon_`).
 */
export function generateSecureId(prefix: 'gft' | 'circ' | 'cmem' | 'ccon'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${bytesToHex(bytes)}`;
}

/**
 * Queries `intents.near.mt_balance_of` for a custody account and vault asset ID.
 * Returns `null` on transport error so callers never confuse an RPC hiccup with 0 balance.
 */
export async function getCustodyVaultBalance(
  env: Env,
  custodyAccount: string,
  vaultAssetId: string
): Promise<bigint | null> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const argsBase64 = btoa(
    JSON.stringify({
      account_id: custodyAccount,
      token_id: vaultAssetId,
    })
  );

  for (const url of [rpcUrl, 'https://free.rpc.fastnear.com']) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: contractId,
            method_name: 'mt_balance_of',
            args_base64: argsBase64,
          },
        }),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;
      if (data?.result?.result) {
        const text = new TextDecoder().decode(new Uint8Array(data.result.result));
        const parsed = JSON.parse(text);
        return BigInt(String(parsed ?? '0'));
      }
    } catch {
      // try fallback
    }
  }
  return null;
}

/**
 * Signs and relays a gas-sponsored NEP-413 `transfer` intent on `intents.near`
 * out of a Gift or Circle's dedicated custody account to one or more recipients.
 */
export async function transferBatchFromEarnCustody(
  env: Env,
  itemId: string,
  transfers: ReadonlyArray<{ recipientAccount: string; assetId: string; amountAtomic: bigint }>
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  const nonZero = transfers.filter((t) => t.amountAtomic > 0n && t.recipientAccount);
  if (nonZero.length === 0) {
    return { success: false, error: 'No positive transfer amounts specified.' };
  }

  try {
    const custody = await deriveEarnCustodyKey(env, itemId);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600_000).toISOString();
    const intents = nonZero.map((leg) => ({
      intent: 'transfer',
      receiver_id: leg.recipientAccount,
      tokens: {
        [leg.assetId]: leg.amountAtomic.toString(),
      },
    }));

    const messageStr = JSON.stringify({
      signer_id: custody.accountId,
      deadline,
      intents,
    });

    const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const nep413Bytes = nearRpc.nep413Serialize(messageStr, nonceBytes, contractId);
    const digest = await crypto.subtle.digest('SHA-256', nep413Bytes);
    const sigBytes = ed25519.sign(new Uint8Array(digest), custody.privateKey);

    const signedPayload = {
      standard: 'nep413',
      payload: {
        message: messageStr,
        nonce: nonceB64,
        recipient: contractId,
      },
      public_key: custody.publicKeyB58,
      signature: `ed25519:${base58Encode(sigBytes)}`,
    };

    return await nearRpc.executeIntentsRelayed(env, signedPayload);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Single-recipient convenience wrapper around `transferBatchFromEarnCustody`.
 */
export async function transferFromEarnCustody(
  env: Env,
  itemId: string,
  recipientAccount: string,
  assetId: string,
  amountAtomic: bigint
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  return transferBatchFromEarnCustody(env, itemId, [
    { recipientAccount, assetId, amountAtomic },
  ]);
}

/**
 * Computes the live USD valuation and accrued yield of a vault share balance.
 * Uses BigInt arithmetic for share units and integer cents for USD values.
 */
export function computeVaultPositionValuation(params: {
  sharesAtomic: string | bigint | null | undefined;
  vaultDecimals: number;
  sharePriceUsd: number;
  principalUsdCents: number;
}): VaultPositionValuation {
  let atomic = 0n;
  try {
    if (params.sharesAtomic !== null && params.sharesAtomic !== undefined) {
      const clean = String(params.sharesAtomic).trim();
      if (/^\d+$/.test(clean)) atomic = BigInt(clean);
    }
  } catch {
    atomic = 0n;
  }

  const sharesFormatted = formatAtomic(atomic.toString(), params.vaultDecimals);
  const sharesFloat = Number(sharesFormatted) || 0;
  const price =
    typeof params.sharePriceUsd === 'number' && Number.isFinite(params.sharePriceUsd) && params.sharePriceUsd > 0
      ? params.sharePriceUsd
      : 0;

  const rawValueCents = sharesFloat > 0 && price > 0 ? Math.round(sharesFloat * price * 100) : params.principalUsdCents;
  const currentValueUsdCents = atomic > 0n ? rawValueCents : params.principalUsdCents;
  const yieldUsdCents = Math.max(0, currentValueUsdCents - params.principalUsdCents);
  const yieldPct =
    params.principalUsdCents > 0
      ? Number(((yieldUsdCents / params.principalUsdCents) * 100).toFixed(2))
      : 0;

  return {
    sharesAtomic: atomic.toString(),
    sharesFormatted,
    sharePriceUsd: price,
    principalUsdCents: params.principalUsdCents,
    currentValueUsdCents,
    yieldUsdCents,
    yieldPct,
  };
}

/**
 * Reserved handles that must never be treated as user handles so routes like
 * `/gift/:id` and `/circles` can never collide with `uprail.world/<handle>`.
 */
export const RESERVED_HANDLES = new Set([
  'gift',
  'gifts',
  'circle',
  'circles',
  'app',
  'api',
  'og',
  'auth',
  'claim',
  'send',
  'receive',
  'history',
  'agents',
  'docs',
  'health',
  'system',
  'coffee',
  'stabilize',
  'earn',
]);

export function normalizeAndValidateHandle(rawHandle: string, fieldLabel = 'Handle'): string {
  const clean = (rawHandle || '').trim().replace(/^@+/, '').toLowerCase();
  if (!clean || !/^[a-z0-9_]{1,15}$/.test(clean)) {
    throw new EarnVaultError(
      'INVALID_HANDLE',
      `${fieldLabel} must be a valid 𝕏 handle (1–15 alphanumeric characters or underscores).`,
      400
    );
  }
  if (RESERVED_HANDLES.has(clean)) {
    throw new EarnVaultError(
      'RESERVED_HANDLE',
      `@${clean} is a reserved system path and cannot be used as a recipient handle.`,
      400
    );
  }
  return clean;
}

/**
 * Strips control characters and caps length on user-provided text (messages, circle names, notes).
 */
export function sanitizeUserText(raw: string | undefined | null, maxLength: number): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}
