/**
 * x402/MPP challenge minting + verification, settled by the existing 1Click
 * rail. A challenge mints a single-use deposit address for the merchant's
 * handle and records it in KV; verification loads that record and confirms the
 * deposit landed.
 */

import type { Env } from '../types';
import * as nearProxy from './nearProxy';
import * as x402 from './x402';

export interface X402ChallengeConfig {
  recipientHandle: string;
  asset: string;
  /** Human-readable amount the merchant must receive. */
  amount: string;
  description?: string;
  resourceUrl?: string;
  maxTimeoutSeconds?: number;
}

export interface StoredChallenge {
  depositAddress: string;
  asset: string;
  amount: string;
  recipientHandle: string;
  resourceUrl?: string;
  quoteId?: string;
  expiresAt: number;
}

const CHALLENGE_PREFIX = 'x402:challenge:';
const DEFAULT_TTL_SECONDS = 900;

export interface MintedChallenge {
  requirement: x402.X402PaymentRequired;
  challenge: StoredChallenge;
}

/**
 * Mints a payment challenge for a merchant: obtains a single-use 1Click deposit
 * address that settles to the merchant's handle, and records it in KV so the
 * verification step can confirm both the address and the expected amount.
 */
export async function mintChallenge(
  env: Env,
  cfg: X402ChallengeConfig
): Promise<MintedChallenge> {
  const quote = await nearProxy.quote(env, {
    recipientHandle: cfg.recipientHandle,
    asset: cfg.asset,
    amount: cfg.amount,
  });

  const depositAddress = quote.depositAddress;
  const challenge: StoredChallenge = {
    depositAddress,
    asset: cfg.asset,
    amount: cfg.amount,
    recipientHandle: cfg.recipientHandle,
    resourceUrl: cfg.resourceUrl,
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt || Date.now() + DEFAULT_TTL_SECONDS * 1000,
  };

  if (env.CACHE) {
    const ttl = Math.max(60, Math.floor((challenge.expiresAt - Date.now()) / 1000));
    try {
      await env.CACHE.put(`${CHALLENGE_PREFIX}${depositAddress}`, JSON.stringify(challenge), {
        expirationTtl: ttl,
      });
    } catch (err) {
      console.warn('[x402] challenge store failed:', err);
    }
  }

  const decimals = x402.assetDecimals(cfg.asset);
  const requirement: x402.X402PaymentRequired = {
    x402Version: x402.X402_VERSION,
    resource: {
      url: cfg.resourceUrl || '',
      description: cfg.description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: x402.NEAR_MAINNET,
        amount: x402.toAtomic(cfg.amount, decimals),
        asset: cfg.asset,
        payTo: depositAddress,
        maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? DEFAULT_TTL_SECONDS,
        extra: {
          method: x402.NEAR_INTENTS_METHOD,
          settlementBackend: 'near-intents',
          amountHuman: cfg.amount,
          recipient: cfg.recipientHandle,
        },
      },
    ],
  };

  return { requirement, challenge };
}

/** Loads a stored challenge for a deposit address, or null if unknown/expired. */
export async function loadChallenge(
  env: Env,
  depositAddress: string
): Promise<StoredChallenge | null> {
  if (!env.CACHE || !depositAddress) return null;
  try {
    const raw = await env.CACHE.get(`${CHALLENGE_PREFIX}${depositAddress}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChallenge;
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  ok: boolean;
  settlement: x402.X402SettlementResponse;
  challenge?: StoredChallenge;
  probe?: x402.DepositProbe;
}

/** Extracts the deposit address a client echoed in its payment payload. */
export function depositAddressFromPayload(payload: x402.X402PaymentPayload | null): string {
  if (!payload || typeof payload.payload !== 'object' || payload.payload === null) return '';
  const p = payload.payload as Record<string, unknown>;
  const candidate = p.depositAddress || p.payTo || p.address;
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * Verifies a presented payment: the deposit address must belong to a live
 * challenge we minted, and 1Click must report the deposit settled for at least
 * the required amount.
 */
export async function verifySettlement(
  env: Env,
  payload: x402.X402PaymentPayload | null,
  opts: { consume?: boolean } = {}
): Promise<VerifyResult> {
  const consume = opts.consume !== false;
  const depositAddress = depositAddressFromPayload(payload);
  if (!depositAddress) {
    return {
      ok: false,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'missing_deposit_address' },
    };
  }

  const challenge = await loadChallenge(env, depositAddress);
  if (!challenge) {
    return {
      ok: false,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'unknown_deposit_address' },
    };
  }

  const probe = await x402.probeDeposit(env, depositAddress);
  if (!probe.isSettled) {
    return {
      ok: false,
      challenge,
      probe,
      settlement: {
        success: false,
        network: x402.NEAR_MAINNET,
        errorReason: probe.error ? 'settlement_unavailable' : 'not_settled',
        errorDetail: probe.error || probe.status,
      },
    };
  }

  const received = parseFloat(probe.depositedAmountFormatted || '0') || 0;
  const required = parseFloat(challenge.amount) || 0;
  if (received + 1e-9 < required) {
    return {
      ok: false,
      challenge,
      probe,
      settlement: {
        success: false,
        network: x402.NEAR_MAINNET,
        errorReason: 'underpaid',
        errorDetail: `received ${received} of ${required}`,
      },
    };
  }

  // Replay guard: a given on-chain proof may only be redeemed once. A
  // read-only verification (`consume: false`) skips this so `verify` stays
  // idempotent per x402 semantics; `settle` and the gating middleware consume.
  if (consume) {
    const proofKey = probe.txHashes[0] || depositAddress;
    const fresh = await x402.consumeSettlementProof(env, proofKey);
    if (!fresh) {
      return {
        ok: false,
        challenge,
        probe,
        settlement: {
          success: false,
          network: x402.NEAR_MAINNET,
          errorReason: 'already_redeemed',
        },
      };
    }
  }

  return {
    ok: true,
    challenge,
    probe,
    settlement: {
      success: true,
      payer: probe.payer,
      transaction: probe.txHashes[0],
      network: x402.NEAR_MAINNET,
      amount: challenge.amount,
    },
  };
}
