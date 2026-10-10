/**
 * Proxy service to the Go settlement service via the NearContainer Durable Object.
 *
 * The Go service is the ONLY settlement implementation — there is no TypeScript
 * fallback. If the container binding (or the shared secret) is missing, these
 * calls fail closed instead of settling funds some other way.
 */

import type { Env, QuoteResponse } from '../types';
import { requireQuoteSecret } from '../utils/secrets';
import { signedInternalRequest } from '../utils/internalAuth';
import { signQuote } from './quoteAuth';

export interface TransferParams {
  recipientNearAccount: string;
  asset: string;
  amount: string;
  escrowAccountId: string;
  intentHash?: string | null;
  paymentId?: string;
}

export interface RefundParams {
  senderNearAccount?: string | null;
  asset: string;
  amount: string;
  escrowAccountId: string;
  intentHash?: string | null;
  paymentId?: string;
}

export interface TxResult {
  txHash: string;
  status: string;
  intentHash?: string;
}

/**
 * Obtain the singleton NearContainer DO stub
 */
export function getNearContainer(env: Env) {
  if (!env.NEAR_CONTAINER) return null;
  const id = env.NEAR_CONTAINER.idFromName('near-service-singleton');
  return env.NEAR_CONTAINER.get(id);
}

/** Fails closed: settlement requires the Go container binding. */
function requireContainer(env: Env) {
  const container = getNearContainer(env);
  if (!container) {
    throw new Error('Settlement service unavailable: NEAR_CONTAINER binding is not configured');
  }
  return container;
}

/**
 * Request a 1Click confidential quote with "advanced" confidentiality
 */
export async function quote(
  env: Env,
  params: {
    recipientHandle: string;
    asset: string;
    amount: string;
    confidentiality?: string;
    /**
     * Values that go INTO the HMAC signature. Defaults to recipientHandle/amount.
     * The quote endpoint sets these to the X handle and the human-readable
     * amount so the signature matches what /api/send verifies, while the Go
     * service still receives the resolved NEAR account and base-unit amount.
     */
    signing?: { recipient: string; amount: string };
  }
): Promise<QuoteResponse> {
  const container = requireContainer(env);

  const request = await signedInternalRequest(env, '/internal/quote', {
    originAsset: params.asset,
    destinationAsset: params.asset,
    amount: params.amount,
    recipient: params.recipientHandle,
    confidentiality: params.confidentiality || 'advanced',
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Quote failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as any;
  const quoteId = raw.quoteId || raw.QuoteID || `q_${Date.now()}`;
  const depositAddress = raw.depositAddress || raw.DepositAddress || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const expiresAt = raw.expiration
    ? (typeof raw.expiration === 'number' && raw.expiration < 1e11 ? raw.expiration * 1000 : raw.expiration)
    : Date.now() + 15 * 60 * 1000;

  // Always sign locally with our own key — 1Click's signature (if any) is not
  // verifiable by /api/send and must never be trusted as quote binding.
  const secret = requireQuoteSecret(env);
  const quoteSignature = await signQuote(secret, {
    quoteId,
    asset: params.asset,
    amount: params.signing?.amount ?? params.amount,
    recipient: params.signing?.recipient ?? params.recipientHandle,
    depositAddress,
    expiresAt,
  });

  return {
    quoteId,
    recipientHandle: params.recipientHandle,
    asset: params.asset,
    amount: params.amount,
    confidentiality: 'advanced',
    depositAddress,
    quoteSignature,
    estimatedFees: raw.estimatedFees || '0',
    expiresAt,
  } satisfies QuoteResponse;
}

/**
 * Execute confidential NEAR transfer to recipient passkey account
 */
export async function transfer(env: Env, params: TransferParams): Promise<TxResult> {
  const container = requireContainer(env);

  const request = await signedInternalRequest(env, '/internal/transfer', {
    recipient: params.recipientNearAccount,
    recipientNearAccount: params.recipientNearAccount,
    asset: params.asset,
    amount: params.amount,
    escrowAccountId: params.escrowAccountId,
    intentHash: params.intentHash,
    paymentId: params.paymentId,
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transfer failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as any;
  return {
    txHash: raw.txHash || raw.intentHash || '',
    intentHash: raw.intentHash,
    status: raw.status || 'SUBMITTED',
  } satisfies TxResult;
}

/**
 * Execute confidential NEAR refund upon expiry (30-day alarm)
 */
export async function refund(env: Env, params: RefundParams): Promise<TxResult> {
  const container = requireContainer(env);

  // Fail closed: a refund must go back to the original sender's account.
  // Defaulting to the escrow account would strand the funds (the settlement
  // service rejects escrow self-refunds).
  if (!params.senderNearAccount || !params.senderNearAccount.trim()) {
    throw new Error('Refund requires the original sender account — refusing to default to the escrow account');
  }

  const request = await signedInternalRequest(env, '/internal/refund', {
    refundTo: params.senderNearAccount.trim(),
    senderNearAccount: params.senderNearAccount.trim(),
    asset: params.asset,
    amount: params.amount,
    escrowAccountId: params.escrowAccountId,
    intentHash: params.intentHash,
    paymentId: params.paymentId,
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Refund failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as any;
  return {
    txHash: raw.txHash || raw.intentHash || '',
    intentHash: raw.intentHash,
    status: raw.status || 'SUBMITTED',
  } satisfies TxResult;
}
