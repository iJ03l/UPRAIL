/**
 * x402/MPP challenge minting + verification.
 *
 * Two settlement rails:
 *
 *  - 'remote' (preferred): a single-use 1Click deposit address settles into the
 *    merchant's handle on any supported chain; verification polls 1Click.
 *  - 'local' (fallback when the settlement service is unavailable): the payer
 *    sends NEAR (native or a NEP-141) directly to the escrow holding account
 *    and echoes the transaction hash; verification reads that one tx by hash via
 *    NEAR RPC. No indexer, and no shared-address guessing.
 *
 * A challenge is stored under a unique id (its deposit address for 'remote', a
 * random reference for 'local'); the client echoes that id back.
 */

import type { Env } from '../types';
import * as nearProxy from './nearProxy';
import * as x402 from './x402';
import { probeNearTransaction, type NearTxProbe } from './nearRpc';

export type X402Rail = 'remote' | 'local';

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
  /** Unique challenge id the client must echo (deposit address or reference). */
  id: string;
  rail: X402Rail;
  payTo: string;
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

/** True when the 1Click settlement service is configured for remote quotes. */
function settlementConfigured(env: Env): boolean {
  return Boolean((env.SETTLEMENT_SERVICE_URL || '').trim() || env.NEAR_CONTAINER);
}

/**
 * Mints a payment challenge: a remote 1Click deposit address when the
 * settlement service is available, otherwise a local escrow transfer request
 * the payer fulfils on NEAR and proves with a transaction hash.
 */
export async function mintChallenge(
  env: Env,
  cfg: X402ChallengeConfig
): Promise<MintedChallenge> {
  const decimals = x402.assetDecimals(cfg.asset);
  const atomicAmount = x402.toAtomic(cfg.amount, decimals);
  const escrowAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

  let challenge: StoredChallenge;

  if (settlementConfigured(env)) {
    try {
      const quote = await nearProxy.quote(env, {
        recipientHandle: cfg.recipientHandle,
        asset: cfg.asset,
        amount: cfg.amount,
      });
      challenge = {
        id: quote.depositAddress,
        rail: 'remote',
        payTo: quote.depositAddress,
        asset: cfg.asset,
        amount: cfg.amount,
        recipientHandle: cfg.recipientHandle,
        resourceUrl: cfg.resourceUrl,
        quoteId: quote.quoteId,
        expiresAt: quote.expiresAt || Date.now() + DEFAULT_TTL_SECONDS * 1000,
      };
    } catch (err) {
      console.warn('[x402] remote quote failed, using local escrow fallback:', err);
      challenge = localChallenge(escrowAccount, cfg);
    }
  } else {
    challenge = localChallenge(escrowAccount, cfg);
  }

  if (env.CACHE) {
    const ttl = Math.max(60, Math.floor((challenge.expiresAt - Date.now()) / 1000));
    try {
      await env.CACHE.put(`${CHALLENGE_PREFIX}${challenge.id}`, JSON.stringify(challenge), {
        expirationTtl: ttl,
      });
    } catch (err) {
      console.warn('[x402] challenge store failed:', err);
    }
  }

  const accept: x402.X402Accept =
    challenge.rail === 'remote'
      ? {
          scheme: 'exact',
          network: x402.NEAR_MAINNET,
          amount: atomicAmount,
          asset: cfg.asset,
          payTo: challenge.payTo,
          maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? DEFAULT_TTL_SECONDS,
          extra: {
            method: x402.NEAR_INTENTS_METHOD,
            settlementBackend: 'near-intents',
            amountHuman: cfg.amount,
            recipient: cfg.recipientHandle,
            reference: challenge.id,
          },
        }
      : {
          scheme: 'exact',
          network: x402.NEAR_MAINNET,
          amount: atomicAmount,
          asset: cfg.asset,
          payTo: challenge.payTo,
          maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? DEFAULT_TTL_SECONDS,
          extra: {
            method: 'near-transfer',
            settlementBackend: 'uprail-escrow',
            amountHuman: cfg.amount,
            recipient: cfg.recipientHandle,
            reference: challenge.id,
            // The payer should set this as the memo on a NEP-141 transfer so
            // concurrent challenges to the same escrow account stay distinct.
            memo: challenge.id,
            settleWith: 'Send on NEAR, then present { reference, txHash, sender }',
          },
        };

  const requirement: x402.X402PaymentRequired = {
    x402Version: x402.X402_VERSION,
    resource: {
      url: cfg.resourceUrl || '',
      description: cfg.description,
      mimeType: 'application/json',
    },
    accepts: [accept],
  };

  return { requirement, challenge };
}

function localChallenge(escrowAccount: string, cfg: X402ChallengeConfig): StoredChallenge {
  const id = `x402_${crypto.randomUUID()}`;
  return {
    id,
    rail: 'local',
    payTo: escrowAccount,
    asset: cfg.asset,
    amount: cfg.amount,
    recipientHandle: cfg.recipientHandle,
    resourceUrl: cfg.resourceUrl,
    expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
  };
}

/** Loads a stored challenge by id, or null if unknown/expired. */
export async function loadChallenge(env: Env, id: string): Promise<StoredChallenge | null> {
  if (!env.CACHE || !id) return null;
  try {
    const raw = await env.CACHE.get(`${CHALLENGE_PREFIX}${id}`);
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
  tx?: NearTxProbe;
}

/** The unique challenge id the client echoed in its payment payload. */
export function challengeIdFromPayload(payload: x402.X402PaymentPayload | null): string {
  if (!payload || typeof payload.payload !== 'object' || payload.payload === null) return '';
  const p = payload.payload as Record<string, unknown>;
  const candidate = p.reference || p.id || p.depositAddress || p.payTo || p.address;
  return typeof candidate === 'string' ? candidate : '';
}

function payloadString(payload: x402.X402PaymentPayload | null, key: string): string {
  if (!payload || typeof payload.payload !== 'object' || payload.payload === null) return '';
  const v = (payload.payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Verifies a presented payment. For 'remote' challenges it polls 1Click; for
 * 'local' challenges it reads the echoed NEAR transaction and confirms a
 * matching transfer to the escrow account.
 */
export async function verifySettlement(
  env: Env,
  payload: x402.X402PaymentPayload | null,
  opts: { consume?: boolean } = {}
): Promise<VerifyResult> {
  const consume = opts.consume !== false;
  const id = challengeIdFromPayload(payload);
  if (!id) {
    return {
      ok: false,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'missing_reference' },
    };
  }

  const challenge = await loadChallenge(env, id);
  if (!challenge) {
    return {
      ok: false,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'unknown_reference' },
    };
  }

  if (challenge.rail === 'local') {
    return verifyLocal(env, payload, challenge, consume);
  }
  return verifyRemote(env, challenge, consume);
}

async function verifyRemote(
  env: Env,
  challenge: StoredChallenge,
  consume: boolean
): Promise<VerifyResult> {
  const probe = await x402.probeDeposit(env, challenge.payTo);
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

  if (consume) {
    const proofKey = probe.txHashes[0] || challenge.id;
    if (!(await x402.consumeSettlementProof(env, proofKey))) {
      return {
        ok: false,
        challenge,
        probe,
        settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'already_redeemed' },
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

async function verifyLocal(
  env: Env,
  payload: x402.X402PaymentPayload | null,
  challenge: StoredChallenge,
  consume: boolean
): Promise<VerifyResult> {
  const txHash = payloadString(payload, 'txHash') || payloadString(payload, 'transaction');
  if (!txHash) {
    return {
      ok: false,
      challenge,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'missing_tx_hash' },
    };
  }

  const tx = await probeNearTransaction(env, txHash, payloadString(payload, 'sender') || undefined);
  if (!tx.found) {
    return {
      ok: false,
      challenge,
      tx,
      settlement: {
        success: false,
        network: x402.NEAR_MAINNET,
        errorReason: 'tx_not_found',
        errorDetail: tx.error,
      },
    };
  }
  if (!tx.success) {
    return {
      ok: false,
      challenge,
      tx,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'tx_failed' },
    };
  }

  const decimals = x402.assetDecimals(challenge.asset);
  const requiredAtomic = BigInt(x402.toAtomic(challenge.amount, decimals) || '0');
  const match = tx.transfers.find((t) => {
    if (t.to !== challenge.payTo) return false;
    // A memo, when present, must be THIS challenge's reference so two
    // same-amount payments to the shared escrow account stay distinguishable.
    if (t.memo && t.memo !== challenge.id) return false;
    try {
      return BigInt(t.amountAtomic) >= requiredAtomic;
    } catch {
      return false;
    }
  });

  if (!match) {
    return {
      ok: false,
      challenge,
      tx,
      settlement: {
        success: false,
        network: x402.NEAR_MAINNET,
        errorReason: 'no_matching_transfer',
        errorDetail: `no transfer to ${challenge.payTo} of >= ${challenge.amount} ${challenge.asset}`,
      },
    };
  }

  if (consume && !(await x402.consumeSettlementProof(env, txHash))) {
    return {
      ok: false,
      challenge,
      tx,
      settlement: { success: false, network: x402.NEAR_MAINNET, errorReason: 'already_redeemed' },
    };
  }

  return {
    ok: true,
    challenge,
    tx,
    settlement: {
      success: true,
      payer: tx.signer || undefined,
      transaction: txHash,
      network: x402.NEAR_MAINNET,
      amount: challenge.amount,
    },
  };
}
