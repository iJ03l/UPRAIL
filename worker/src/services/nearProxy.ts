/**
 * Proxy service to the Go Container Worker via NearContainer Durable Object
 */

import type { Env, QuoteResponse, BalanceResponse } from '../types';
import { signQuote } from './quoteAuth';
import { deriveConfidentialAccountId } from './nearRpc';

export interface TransferParams {
  recipientNearAccount: string;
  asset: string;
  amount: string;
  escrowAccountId: string;
  escrowPrivateKey?: string;
  intentHash?: string | null;
  paymentId?: string;
}

export interface RefundParams {
  senderNearAccount?: string | null;
  asset: string;
  amount: string;
  escrowAccountId: string;
  escrowPrivateKey?: string;
  intentHash?: string | null;
  paymentId?: string;
}

export interface CreateAccountParams {
  publicKeyHex: string;
  xHandle: string;
}

export interface CreateAccountResponse {
  nearAccount: string;
  txHash?: string;
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
  const id = env.NEAR_CONTAINER.idFromName('near-service-singleton');
  return env.NEAR_CONTAINER.get(id);
}

function internalHeaders(env: Env, additional?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...additional,
  };
  if (env.INTERNAL_SERVICE_KEY) {
    headers['X-Internal-Secret'] = env.INTERNAL_SERVICE_KEY;
  }
  return headers;
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
  }
): Promise<QuoteResponse> {
  const container = getNearContainer(env);

  const request = new Request('http://container/quote', {
    method: 'POST',
    headers: internalHeaders(env),
    body: JSON.stringify({
      originAsset: params.asset,
      destinationAsset: params.asset,
      amount: params.amount,
      recipient: params.recipientHandle,
      confidentiality: params.confidentiality || 'advanced',
    }),
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

  let quoteSignature = raw.signature || raw.quoteSignature;
  if (!quoteSignature) {
    // Generate cryptographic HMAC quote signature
    const secret = env.SESSION_SECRET || env.INTERNAL_SERVICE_KEY || 'uprail_confidential_master_sig';
    quoteSignature = await signQuote(secret, {
      quoteId,
      asset: params.asset,
      amount: params.amount,
      recipient: params.recipientHandle,
      depositAddress,
      expiresAt,
    });
  }

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
  const container = getNearContainer(env);

  const request = new Request('http://container/transfer', {
    method: 'POST',
    headers: internalHeaders(env),
    body: JSON.stringify({
      recipient: params.recipientNearAccount,
      recipientNearAccount: params.recipientNearAccount,
      asset: params.asset,
      amount: params.amount,
      escrowAccountId: params.escrowAccountId,
      escrowPrivateKey: params.escrowPrivateKey || env.ESCROW_PRIVATE_KEY,
      intentHash: params.intentHash,
      paymentId: params.paymentId,
    }),
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
  const container = getNearContainer(env);

  const request = new Request('http://container/refund', {
    method: 'POST',
    headers: internalHeaders(env),
    body: JSON.stringify({
      refundTo: params.senderNearAccount || env.ESCROW_ACCOUNT_ID,
      senderNearAccount: params.senderNearAccount,
      asset: params.asset,
      amount: params.amount,
      escrowAccountId: params.escrowAccountId,
      escrowPrivateKey: params.escrowPrivateKey || env.ESCROW_PRIVATE_KEY,
      intentHash: params.intentHash,
      paymentId: params.paymentId,
    }),
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

/**
 * Create a new confidential NEAR account mapped to WebAuthn P-256 public key
 */
export async function createAccount(
  env: Env,
  params: CreateAccountParams
): Promise<CreateAccountResponse> {
  const container = getNearContainer(env);
  const masterAccount = env.MASTER_ACCOUNT_ID || 'uprail.near';
  const desiredAccountId = await deriveConfidentialAccountId(params.publicKeyHex, masterAccount);

  const request = new Request('http://container/account/create', {
    method: 'POST',
    headers: internalHeaders(env),
    body: JSON.stringify({
      publicKeyP256: params.publicKeyHex,
      publicKeyHex: params.publicKeyHex,
      desiredAccountID: desiredAccountId,
      xHandle: params.xHandle,
    }),
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Create account failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as any;
  return {
    nearAccount: raw.nearAccountID || raw.nearAccount || desiredAccountId,
    txHash: raw.intentHash || raw.txHash,
  } satisfies CreateAccountResponse;
}

/**
 * Query confidential token balances for a NEAR account
 */
export async function getBalance(
  env: Env,
  params: { nearAccount: string; asset?: string }
): Promise<BalanceResponse> {
  const container = getNearContainer(env);

  const url = new URL('http://container/balance');
  url.searchParams.set('account', params.nearAccount);
  if (params.asset) {
    url.searchParams.set('asset', params.asset);
  }

  const request = new Request(url.toString(), {
    method: 'GET',
    headers: internalHeaders(env, { 'Accept': 'application/json' }),
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Get balance failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as BalanceResponse;
}
