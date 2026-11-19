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

export type VaultPrincipalType = 'usd_stable' | 'volatile_crypto';
export type VaultRiskTier = 'core' | 'moderate' | 'elevated';
export type VaultBridgeType = 'native_near' | 'omni_bridge';

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
  apyType: 'variable';
  minDepositUsd: number;
  priceUsd: number;
  available: boolean;
  principalType: VaultPrincipalType;
  riskTier: VaultRiskTier;
  riskTierLabel: 'Core' | 'Moderate' | 'Elevated';
  requiresRiskAck: boolean;
  bridgeType: VaultBridgeType;
  tvlBand: string;
  strategySummary: string;
  riskHighlights: string[];
  exitSummary: string;
  auditSummary: string;
  contractExplorerUrl: string;
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
  netChangeUsdCents: number;
  netChangePct: number;
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
 * Ordered with USD-stable Core vault (`gtUSDCp`) first as the conservative default.
 */
export const CURATED_EARN_VAULTS: ReadonlyArray<Omit<EarnVaultDescriptor, 'available'>> = [
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
    apyType: 'variable',
    minDepositUsd: 25,
    priceUsd: 0.0000011178,
    principalType: 'usd_stable',
    riskTier: 'core',
    riskTierLabel: 'Core',
    requiresRiskAck: false,
    bridgeType: 'omni_bridge',
    tvlBand: '$180M+ TVL',
    strategySummary:
      'Supplies USDC into isolated, overcollateralized Morpho lending markets on Base backed by blue-chip collateral (WETH, cbETH, cbBTC), curated by Gauntlet.',
    riskHighlights: [
      'Lending bad debt is possible if collateral drops faster than liquidations during extreme crashes.',
      'Cross-chain wrapper risk: receipt shares are bridged from Base via NEAR Omni Bridge (omft.near) and swapped via 1Click solvers.',
      'Yield fluctuates daily with borrower demand and carries USDC issuer/depeg risk.',
    ],
    exitSummary:
      'Swapped back to USDC via 1Click solvers upon unwrap or stabilization. High pool utilization can temporarily widen exit spreads.',
    auditSummary: 'Morpho core audited by OpenZeppelin, Spearbit & ChainSecurity · Risk curated by Gauntlet',
    contractExplorerUrl: 'https://basescan.org/address/0x0bb69b79bc829e1cfcc34a740110886d98d2bd14',
  },
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
    apyType: 'variable',
    minDepositUsd: 10,
    priceUsd: 1.028245,
    principalType: 'usd_stable',
    riskTier: 'moderate',
    riskTierLabel: 'Moderate',
    requiresRiskAck: false,
    bridgeType: 'omni_bridge',
    tvlBand: '~$4M TVL',
    strategySummary:
      'Algorithmically rebalances USDC across vetted Ethereum lending markets (Morpho/Aave-class venues) using permissioned execution guardrails and NAV checks.',
    riskHighlights: [
      'Newer protocol (~$4M TVL, launched 2026) with shorter production battle-testing than Morpho or Lido.',
      'Uses asynchronous epoch redemptions natively, so instant exit on UPRAIL depends on 1Click solver liquidity and spreads.',
      'Cross-chain Ethereum Omni Bridge (omft.near), strategy/NAV accounting, and USDC depeg risks apply.',
    ],
    exitSummary:
      'Instant exit relies on 1Click solver liquidity; if USDC conversion is unavailable during stress, unwrap delivers TLO vault shares directly.',
    auditSummary: 'Audited by Quantstamp (Mar–Apr 2026; medium & low findings resolved pre-launch)',
    contractExplorerUrl: 'https://etherscan.io/address/0x0f38f1ce62776d4a0038bc6cac66877a5687383b',
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
    apyType: 'variable',
    minDepositUsd: 15,
    priceUsd: 2590.0,
    principalType: 'volatile_crypto',
    riskTier: 'core',
    riskTierLabel: 'Core',
    requiresRiskAck: true,
    bridgeType: 'omni_bridge',
    tvlBand: '$1B+ TVL',
    strategySummary:
      'Non-rebasing receipt token representing staked Ethereum across Lido’s decentralized node operator set; staking rewards compound in ETH terms.',
    riskHighlights: [
      'Full ETH market price volatility: if ETH drops 25%, your USD value drops ~25% even while earning ETH staking yield.',
      'Ethereum validator slashing risk (mitigated by operator diversity and Lido slashing buffer) and withdrawal queue delays during stress.',
      'Cross-chain Ethereum Omni Bridge (omft.near) and 1Click solver spread risks apply.',
    ],
    exitSummary:
      'Swapped back to USDC via 1Click solvers at live ETH market price. USD payout reflects ETH price movement plus accrued staking yield.',
    auditSummary: 'Extensively audited & formally verified (Certora, Runtime Verification, Ackee) · Dual Governance active',
    contractExplorerUrl: 'https://etherscan.io/address/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
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
    apyType: 'variable',
    minDepositUsd: 5,
    priceUsd: 5.71,
    principalType: 'volatile_crypto',
    riskTier: 'moderate',
    riskTierLabel: 'Moderate',
    requiresRiskAck: true,
    bridgeType: 'native_near',
    tvlBand: 'Established NEAR LST',
    strategySummary:
      'Native NEAR liquid staking token delegating NEAR across 80+ validators; epoch staking rewards compound automatically into the stNEAR/NEAR rate.',
    riskHighlights: [
      'Full NEAR market price volatility: your USD value rises and falls directly with NEAR’s market price.',
      'NEAR protocol inflation reductions (2.5% cap tapering toward 1.6% under HSP-029) continue to compress baseline staking APY.',
      'Team security history: Meta Pool’s separate EVM mpETH contract suffered a June 2025 mint exploit (~56 ETH drained; NEAR stNEAR was unaffected).',
    ],
    exitSummary:
      'Native NEAR asset (no cross-chain bridge hop). Instant exit uses 1Click solver liquidity; native unstaking takes 48–72 hours.',
    auditSummary: 'NEAR contracts audited by BlockSec & Halborn · Native NEAR (no cross-chain bridge)',
    contractExplorerUrl: 'https://nearblocks.io/token/meta-pool.near',
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
    apyType: 'variable',
    minDepositUsd: 5,
    priceUsd: 3.75,
    principalType: 'volatile_crypto',
    riskTier: 'elevated',
    riskTierLabel: 'Elevated',
    requiresRiskAck: true,
    bridgeType: 'native_near',
    tvlBand: 'Specialized Pool',
    strategySummary:
      'Native NEAR staking wrapper managed via Assetize treasury pools that auto-compounds Proof-of-Stake epoch rewards.',
    riskHighlights: [
      'Full NEAR market price volatility plus shrinking baseline NEAR staking yields under HSP-029.',
      'Thinner secondary liquidity than stNEAR: exit swaps can face wider spreads or fall back to delivering cNEAR shares directly.',
      'Higher validator & wrapper concentration and less public DAO transparency than larger open LST protocols.',
    ],
    exitSummary:
      'Native NEAR asset (no cross-chain bridge hop), but relies on thinner 1Click solver liquidity for instant conversion back to USDC.',
    auditSummary: 'Specialized institutional wrapper (Assetize) · Verify on-chain treasury pools on NearBlocks',
    contractExplorerUrl: 'https://nearblocks.io/token/cnear.assetize.near',
  },
  {
    symbol: 'kV-gtSOLb',
    name: 'Kamino Gauntlet SOL',
    protocol: 'Kamino (Gauntlet)',
    chain: 'sol',
    chainName: 'Solana',
    underlyingSymbol: 'SOL',
    assetId: 'nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near',
    decimals: 9,
    estimatedApyPct: 8.1,
    apyType: 'variable',
    minDepositUsd: 10,
    priceUsd: 89.52,
    principalType: 'volatile_crypto',
    riskTier: 'elevated',
    riskTierLabel: 'Elevated',
    requiresRiskAck: true,
    bridgeType: 'omni_bridge',
    tvlBand: '~$1.8M TVL',
    strategySummary:
      'Kamino Lend V2 vault curated by Gauntlet (Balanced mandate) deploying SOL across whitelisted Solana lending and LST collateral markets.',
    riskHighlights: [
      'Stacks full SOL market price volatility on top of lending liquidation and Solana LST depeg risks.',
      'Smaller vault TVL (~$1.6M–$1.9M, launched late 2025) plus Solana cross-chain wrapper (omdep.near) and solver liquidity risk.',
      'Solana network congestion during crashes can delay liquidations or widen swap spreads.',
    ],
    exitSummary:
      'Swapped back to USDC via 1Click solvers at live SOL market price; smaller pool depth can widen spreads during volatility.',
    auditSummary: 'Kamino Lend V2 whitelisted reserves · Curated by Gauntlet (Balanced tier)',
    contractExplorerUrl: 'https://app.kamino.finance/lending',
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
  itemId: string,
  expectedAccountId?: string | null
): Promise<EarnCustodyKey> {
  const cleanId = (itemId || '').trim();
  if (
    !/^(gft|circ)_[a-f0-9]{16,64}$/.test(cleanId) &&
    !/^agent_pocket:[a-z0-9._-]{2,64}$/.test(cleanId)
  ) {
    throw new EarnVaultError('INVALID_CUSTODY_ID', 'Invalid gift or circle identifier.', 400);
  }
  const envAny = env as unknown as Record<string, string | undefined>;
  const candidates = [
    envAny.EARN_CUSTODY_MASTER_KEY,
    env.ESCROW_PRIVATE_KEY,
    envAny.PREVIOUS_ESCROW_PRIVATE_KEY,
  ].filter((k): k is string => Boolean(k && k.trim()));

  if (candidates.length === 0) {
    throw new EarnVaultError(
      'CUSTODY_KEY_UNCONFIGURED',
      'Server custody key is not configured.',
      503
    );
  }

  const domainMsg = new TextEncoder().encode(`uprail_earn_custody_v1:${cleanId}`);
  const cleanExpected = expectedAccountId ? expectedAccountId.trim().toLowerCase() : null;
  let firstValid: EarnCustodyKey | null = null;

  for (const keyStr of candidates) {
    const escrowRaw = base58Decode(keyStr);
    const masterSeed = escrowRaw.slice(0, 32);
    if (masterSeed.length !== 32) continue;

    const hmacKey = await crypto.subtle.importKey(
      'raw',
      masterSeed,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const derivedPriv = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, domainMsg));
    const derivedPub = ed25519.getPublicKey(derivedPriv);
    const accountId = bytesToHex(derivedPub);
    const derived: EarnCustodyKey = {
      itemId: cleanId,
      accountId,
      publicKey: derivedPub,
      privateKey: derivedPriv,
      publicKeyB58: `ed25519:${base58Encode(derivedPub)}`,
    };
    if (!firstValid) firstValid = derived;
    if (!cleanExpected || accountId.toLowerCase() === cleanExpected) {
      return derived;
    }
  }

  if (!firstValid) {
    throw new EarnVaultError('CUSTODY_KEY_INVALID', 'Invalid server master key.', 503);
  }
  return firstValid;
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
 * Signs and relays one or more gas-sponsored NEP-413 intents on `intents.near`
 * out of a Gift, Circle, or Agent Pocket's dedicated custody account.
 */
export async function executeCustodyIntents(
  env: Env,
  itemId: string,
  intents: ReadonlyArray<Record<string, unknown>>,
  expectedAccountId?: string | null
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  if (intents.length === 0) {
    return { success: false, error: 'No intents specified.' };
  }

  try {
    const custody = await deriveEarnCustodyKey(env, itemId, expectedAccountId);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600_000).toISOString();
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
 * Signs and relays a gas-sponsored NEP-413 `transfer` intent on `intents.near`
 * out of a Gift, Circle, or Agent Pocket's dedicated custody account to one or more recipients.
 */
export async function transferBatchFromEarnCustody(
  env: Env,
  itemId: string,
  transfers: ReadonlyArray<{ recipientAccount: string; assetId: string; amountAtomic: bigint }>,
  expectedAccountId?: string | null
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  const nonZero = transfers.filter((t) => t.amountAtomic > 0n && t.recipientAccount);
  if (nonZero.length === 0) {
    return { success: false, error: 'No positive transfer amounts specified.' };
  }
  const intents = nonZero.map((leg) => ({
    intent: 'transfer',
    receiver_id: leg.recipientAccount,
    tokens: {
      [leg.assetId]: leg.amountAtomic.toString(),
    },
  }));
  return executeCustodyIntents(env, itemId, intents, expectedAccountId);
}

/**
 * Single-recipient convenience wrapper around `transferBatchFromEarnCustody`.
 */
export async function transferFromEarnCustody(
  env: Env,
  itemId: string,
  recipientAccount: string,
  assetId: string,
  amountAtomic: bigint,
  expectedAccountId?: string | null
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  return transferBatchFromEarnCustody(
    env,
    itemId,
    [{ recipientAccount, assetId, amountAtomic }],
    expectedAccountId
  );
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

  const rawSharesFormatted = formatAtomic(atomic.toString(), params.vaultDecimals);
  const sharesFloat = Number(rawSharesFormatted) || 0;
  const sharesFormatted = (() => {
    const dot = rawSharesFormatted.indexOf('.');
    if (dot === -1) return rawSharesFormatted;
    const intPart = rawSharesFormatted.slice(0, dot);
    const fracPart = rawSharesFormatted.slice(dot + 1);
    if (fracPart.length <= 5) return rawSharesFormatted;
    const trimmed = fracPart.slice(0, 5).replace(/0+$/, '');
    return trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart;
  })();
  const price =
    typeof params.sharePriceUsd === 'number' && Number.isFinite(params.sharePriceUsd) && params.sharePriceUsd > 0
      ? params.sharePriceUsd
      : 0;

  const rawValueCents = sharesFloat > 0 && price > 0 ? Math.round(sharesFloat * price * 100) : params.principalUsdCents;
  const currentValueUsdCents = atomic > 0n ? rawValueCents : params.principalUsdCents;
  const netChangeUsdCents = currentValueUsdCents - params.principalUsdCents;
  const netChangePct =
    params.principalUsdCents > 0
      ? Number(((netChangeUsdCents / params.principalUsdCents) * 100).toFixed(2))
      : 0;
  const yieldUsdCents = Math.max(0, netChangeUsdCents);
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
    netChangeUsdCents,
    netChangePct,
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

/**
 * Deterministically derives a user's isolated 64-hex implicit `intents.near` Agent Allowance Pocket
 * from their `nearAccount` (`u_<hex>.escrow.uprail.near`).
 *
 * This pocket holds the pre-approved allowance that MCP / AI Agents can spend autonomously
 * without requiring a passkey prompt on every transaction, while `getIntentBalances` merges
 * the pocket's balance into the user's UPRAIL dashboard balance seamlessly.
 */
export async function deriveUserAgentPocket(
  env: Env,
  nearAccount: string
): Promise<EarnCustodyKey> {
  const clean = (nearAccount || '').trim().toLowerCase();
  if (!clean) {
    throw new EarnVaultError('INVALID_ACCOUNT', 'Missing user NEAR account for agent pocket.', 400);
  }
  return deriveEarnCustodyKey(env, `agent_pocket:${clean}`);
}

/**
 * Ensures the user's main `nearAccount` on `intents.near` has at least `requiredOnMainAtomic`
 * of `assetId` by automatically pulling any shortfall from their `agentPocket` on `intents.near`.
 *
 * This allows the user's UPRAIL web app (Send, Withdraw, near.com, Stabilize, Circles, Gifts)
 * to spend their unified balance as if nothing ever moved into the agent pocket.
 */
export const AGENT_POCKET_CORE_ASSETS: ReadonlyArray<{
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  nearContractId: string;
}> = [
  {
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  },
  {
    assetId: 'nep141:usdt.tether-token.near',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    nearContractId: 'usdt.tether-token.near',
  },
  {
    assetId: 'nep141:wrap.near',
    symbol: 'NEAR',
    name: 'Wrapped NEAR',
    decimals: 24,
    nearContractId: 'wrap.near',
  },
];

export const CIRCLE_GIFT_USDC_ASSET_ID =
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export function isUsdcOriginAsset(token: {
  assetId?: string | null;
  defuse_asset_id?: string | null;
  nearContractId?: string | null;
  symbol?: string | null;
}): boolean {
  const sym = (token.symbol || '').trim().toUpperCase();
  const aid = (token.assetId || token.defuse_asset_id || '').trim().toLowerCase();
  const contract = (token.nearContractId || '').trim().toLowerCase();
  return (
    sym === 'USDC' &&
    (aid === CIRCLE_GIFT_USDC_ASSET_ID ||
      contract === '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' ||
      aid.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'))
  );
}

function formatPocketUnits(atomic: bigint, decimals: number): string {
  if (decimals <= 0) return atomic.toString();
  const factor = 10n ** BigInt(decimals);
  const whole = atomic / factor;
  const frac = atomic % factor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Single-RPC batch query via `intents.near.mt_batch_balance_of`.
 * Returns `null` if RPC fails so callers never confuse transport errors with zero.
 */
export async function getCustodyBatchBalances(
  env: Env,
  accountId: string,
  tokenIds: ReadonlyArray<string>
): Promise<bigint[] | null> {
  if (!accountId || tokenIds.length === 0) return null;
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const argsBase64 = btoa(
    JSON.stringify({
      account_id: accountId,
      token_ids: tokenIds,
    })
  );

  for (const url of rpcUrl === 'https://free.rpc.fastnear.com'
    ? [rpcUrl]
    : [rpcUrl, 'https://free.rpc.fastnear.com']) {
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
            method_name: 'mt_batch_balance_of',
            args_base64: argsBase64,
          },
        }),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;
      if (data?.result?.result) {
        const text = new TextDecoder().decode(new Uint8Array(data.result.result));
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => {
            try {
              return BigInt(String(v ?? '0'));
            } catch {
              return 0n;
            }
          });
        }
      }
    } catch {
      // try fallback RPC
    }
  }
  return null;
}

export interface AgentPocketBalanceItem {
  defuse_asset_id: string;
  symbol: string;
  name: string;
  decimals: number;
  nearContractId: string;
  amount: string;
  amountAtomic: bigint;
  amountFormatted: string;
}

/**
 * Reads all non-zero core asset balances held in a user's isolated Agent Pocket
 * on `intents.near` using a single `mt_batch_balance_of` RPC call (1 subrequest).
 */
export async function getAgentPocketBalances(
  env: Env,
  nearAccount: string
): Promise<{
  pocketAccount: string | null;
  balances: AgentPocketBalanceItem[];
  rpcOk: boolean;
}> {
  const cleanAccount = (nearAccount || '').trim().toLowerCase();
  if (!cleanAccount || /^[0-9a-f]{64}$/i.test(cleanAccount)) {
    return { pocketAccount: null, balances: [], rpcOk: true };
  }
  try {
    const pocket = await deriveUserAgentPocket(env, cleanAccount);
    const raw = await getCustodyBatchBalances(
      env,
      pocket.accountId,
      AGENT_POCKET_CORE_ASSETS.map((a) => a.assetId)
    );
    if (!raw) {
      return { pocketAccount: pocket.accountId, balances: [], rpcOk: false };
    }
    const balances: AgentPocketBalanceItem[] = [];
    for (let i = 0; i < AGENT_POCKET_CORE_ASSETS.length; i++) {
      const meta = AGENT_POCKET_CORE_ASSETS[i];
      const atomic = raw[i] ?? 0n;
      if (atomic <= 0n) continue;
      balances.push({
        defuse_asset_id: meta.assetId,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        nearContractId: meta.nearContractId,
        amount: atomic.toString(),
        amountAtomic: atomic,
        amountFormatted: formatPocketUnits(atomic, meta.decimals),
      });
    }
    return { pocketAccount: pocket.accountId, balances, rpcOk: true };
  } catch {
    return { pocketAccount: null, balances: [], rpcOk: false };
  }
}

/**
 * Ensures the user's main `nearAccount` on `intents.near` has at least `requiredOnMainAtomic`
 * of `assetId` by automatically pulling any shortfall from their `agentPocket` on `intents.near`.
 *
 * This allows the user's UPRAIL web app (Send, Withdraw, near.com, Stabilize, Circles, Gifts)
 * to spend their unified balance as if nothing ever moved into the agent pocket.
 */
export async function ensureAgentPocketTopUpForMainAccount(
  env: Env,
  nearAccount: string,
  assetId: string,
  requiredOnMainAtomic: bigint,
  knownMainBalAtomic?: bigint
): Promise<bigint> {
  if (!nearAccount || !assetId || requiredOnMainAtomic <= 0n) {
    return knownMainBalAtomic ?? 0n;
  }
  const cleanAccount = nearAccount.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(cleanAccount)) {
    return knownMainBalAtomic ?? 0n;
  }

  try {
    const mainBal =
      knownMainBalAtomic !== undefined
        ? knownMainBalAtomic
        : (await getCustodyVaultBalance(env, cleanAccount, assetId)) ?? 0n;
    if (mainBal >= requiredOnMainAtomic) return mainBal;

    const shortfall = requiredOnMainAtomic - mainBal;
    const pocket = await deriveUserAgentPocket(env, cleanAccount);
    const pocketBal = (await getCustodyVaultBalance(env, pocket.accountId, assetId)) ?? 0n;
    if (pocketBal <= 0n) return mainBal;

    const pullAmount = pocketBal >= shortfall ? shortfall : pocketBal;
    const res = await transferFromEarnCustody(
      env,
      `agent_pocket:${cleanAccount}`,
      cleanAccount,
      assetId,
      pullAmount,
      pocket.accountId
    );
    return res.success ? mainBal + pullAmount : mainBal;
  } catch {
    return knownMainBalAtomic ?? 0n;
  }
}

/**
 * Recalls all positive balances from a user's `agentPocket` back to their main `nearAccount` on `intents.near`
 * (e.g. when revoking agent keys or on explicit user request).
 */
export async function recallAllAgentPocketToMainAccount(
  env: Env,
  nearAccount: string
): Promise<{ recalled: boolean; txHash?: string; recalledAssets?: Array<{ symbol: string; amountFormatted: string }> }> {
  const cleanAccount = (nearAccount || '').trim().toLowerCase();
  if (!cleanAccount || /^[0-9a-f]{64}$/i.test(cleanAccount)) {
    return { recalled: false };
  }
  try {
    const { pocketAccount, balances } = await getAgentPocketBalances(env, cleanAccount);
    if (!pocketAccount || balances.length === 0) return { recalled: false };
    const transfers = balances.map((b) => ({
      recipientAccount: cleanAccount,
      assetId: b.defuse_asset_id,
      amountAtomic: b.amountAtomic,
    }));
    const res = await transferBatchFromEarnCustody(
      env,
      `agent_pocket:${cleanAccount}`,
      transfers,
      pocketAccount
    );
    return {
      recalled: res.success,
      txHash: res.txHash,
      recalledAssets: res.success
        ? balances.map((b) => ({ symbol: b.symbol, amountFormatted: b.amountFormatted }))
        : undefined,
    };
  } catch {
    return { recalled: false };
  }
}

