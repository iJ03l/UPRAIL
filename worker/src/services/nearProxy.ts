/**
 * Proxy service to the Go Container Worker via NearContainer Durable Object
 */

import type { Env, QuoteResponse, BalanceResponse } from '../types';

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
      recipientHandle: params.recipientHandle,
      asset: params.asset,
      amount: params.amount,
      confidentiality: params.confidentiality || 'advanced',
    }),
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Quote failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as QuoteResponse;
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

  return (await response.json()) as TxResult;
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

  return (await response.json()) as TxResult;
}

/**
 * Create a new confidential NEAR account mapped to WebAuthn P-256 public key
 */
export async function createAccount(
  env: Env,
  params: CreateAccountParams
): Promise<CreateAccountResponse> {
  const container = getNearContainer(env);

  const request = new Request('http://container/create-account', {
    method: 'POST',
    headers: internalHeaders(env),
    body: JSON.stringify({
      publicKeyHex: params.publicKeyHex,
      xHandle: params.xHandle,
    }),
  });

  const response = await container.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Create account failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as CreateAccountResponse;
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
