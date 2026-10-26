/**
 * Typed, fail-closed client for the 1Click Swap API.
 *
 * This module deliberately has no dependency on NEAR RPC or the settlement
 * code. Callers pass the end-user session token and exact asset ids/amounts;
 * every response is validated before it can influence a money movement.
 */

import type { Env } from '../types';

export type OneClickConfidentiality = 'public' | 'basic' | 'advanced';
export type OneClickDepositType = 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
export type OneClickRecipientType = 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
export type OneClickRefundType = 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';

export class OneClickError extends Error {
  status: number;
  code: string;
  body: unknown;

  constructor(message: string, status = 0, code = 'ONE_CLICK_ERROR', body?: unknown) {
    super(message);
    this.name = 'OneClickError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface OneClickQuoteRequest {
  dry?: boolean;
  swapType?: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: OneClickRecipientType;
  refundTo: string;
  refundType: OneClickRefundType;
  depositType: OneClickDepositType;
  confidentiality?: OneClickConfidentiality;
  slippageTolerance?: number;
  deadline: string;
}

export interface OneClickQuote {
  depositAddress: string;
  depositMemo?: string;
  deadline?: string;
  amountIn?: string;
  amountOut?: string;
  minAmountOut?: string;
  quoteId?: string;
  timeEstimate?: number;
}

export interface OneClickQuoteResponse {
  quote: OneClickQuote;
  quoteRequest?: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  correlationId?: string;
  raw: Record<string, unknown>;
}

export interface OneClickBalance {
  tokenId: string;
  available: string;
  source?: string;
  raw: Record<string, unknown>;
}

export interface OneClickIntentPayload {
  message: string;
  nonce: string;
  recipient: string;
}

export interface OneClickGeneratedIntent {
  standard: string;
  payload: OneClickIntentPayload;
  correlationId?: string;
}

export interface OneClickMultiPayload {
  standard: 'nep413';
  payload: OneClickIntentPayload;
  public_key: string;
  signature: string;
}

export interface OneClickAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt?: number;
}

export interface OneClickExecutionStatus {
  status: string;
  depositAddress?: string;
  intentHash?: string;
  swapDetails?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

function apiBase(env: Env): string {
  return (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
}

function partnerHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'UPRAIL/1.0',
  };
  // Partner auth must use X-API-Key so Authorization stays free for the
  // per-user User-Session token. A partner JWT is accepted in this header too.
  const key = (env.ONE_CLICK_API_KEY || env.ONE_CLICK_JWT || '').trim();
  if (key) headers['X-API-Key'] = key;
  return headers;
}

function userHeaders(env: Env, userSession: string): Record<string, string> {
  return {
    ...partnerHeaders(env),
    Authorization: `Bearer ${userSession}`,
  };
}

async function readBody(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 400);
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim().slice(0, 400);
    }
  }
  return fallback;
}

async function requestJson(
  env: Env,
  path: string,
  init: RequestInit,
  headers: Record<string, string>
): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase(env)}${path}`, { ...init, headers });
  } catch (err: any) {
    throw new OneClickError(
      `1Click request failed: ${err?.message || String(err)}`,
      0,
      'ONE_CLICK_NETWORK'
    );
  }
  const body = await readBody(resp);
  if (!resp.ok) {
    const code =
      resp.status === 401
        ? 'ONE_CLICK_AUTH_REQUIRED'
        : resp.status === 403
          ? 'ONE_CLICK_FORBIDDEN'
          : 'ONE_CLICK_HTTP_ERROR';
    throw new OneClickError(
      errorMessage(body, `1Click ${path} failed (${resp.status})`),
      resp.status,
      code,
      body
    );
  }
  return body;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OneClickError(`1Click ${label} response is not an object`, 502, 'ONE_CLICK_BAD_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isFutureIso(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > now;
}

function sameBaseUnits(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' && typeof actual !== 'number') return false;
  const value = String(actual);
  if (!/^\d+$/.test(value) || !/^\d+$/.test(expected)) return false;
  try {
    return BigInt(value) === BigInt(expected);
  } catch {
    return false;
  }
}

/**
 * Requests a quote and validates the fields that matter for settlement.
 *
 * A confidential quote is never accepted without partner auth and a user
 * session, and never silently downgraded: the returned confidentiality must
 * match what was requested.
 */
export async function requestQuote(
  env: Env,
  request: OneClickQuoteRequest,
  opts: { userSession?: string } = {}
): Promise<OneClickQuoteResponse> {
  if (!/^\d+$/.test(request.amount) || BigInt(request.amount) <= 0n) {
    throw new OneClickError('Quote amount must be a positive base-unit integer', 400, 'INVALID_AMOUNT');
  }
  if (!isFutureIso(request.deadline)) {
    throw new OneClickError('Quote deadline must be a future ISO timestamp', 400, 'INVALID_DEADLINE');
  }

  const confidentiality = request.confidentiality || 'public';
  const confidential = confidentiality !== 'public';
  const userSession = (opts.userSession || '').trim();

  if (confidential) {
    if (!(env.ONE_CLICK_API_KEY || '').trim() && !(env.ONE_CLICK_JWT || '').trim()) {
      throw new OneClickError(
        'ONE_CLICK_API_KEY is required for confidential quotes',
        401,
        'ONE_CLICK_PARTNER_KEY_MISSING'
      );
    }
    if (!userSession) {
      throw new OneClickError(
        'A 1Click User-Session token is required for confidential quotes',
        401,
        'ONE_CLICK_USER_SESSION_MISSING'
      );
    }
  }

  const body: Record<string, unknown> = {
    dry: request.dry ?? false,
    swapType: request.swapType || 'EXACT_INPUT',
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    recipient: request.recipient,
    recipientType: request.recipientType,
    refundTo: request.refundTo,
    refundType: request.refundType,
    depositType: request.depositType,
    slippageTolerance: request.slippageTolerance ?? 100,
    deadline: request.deadline,
  };
  if (confidential) body.confidentiality = confidentiality;

  const raw = requireObject(
    await requestJson(
      env,
      '/v0/quote',
      { method: 'POST', body: JSON.stringify(body) },
      confidential ? userHeaders(env, userSession) : partnerHeaders(env)
    ),
    'quote'
  );

  const quote = requireObject(raw.quote, 'quote.quote');
  const quoteRequest =
    raw.quoteRequest && typeof raw.quoteRequest === 'object'
      ? (raw.quoteRequest as Record<string, unknown>)
      : undefined;

  const depositAddress = stringValue(quote.depositAddress);
  if (!depositAddress) {
    throw new OneClickError(
      '1Click quote returned no depositAddress',
      502,
      'ONE_CLICK_NO_DEPOSIT_ADDRESS'
    );
  }

  const deadline = stringValue(quote.deadline) || stringValue(quote.expiration);
  if (!deadline) {
    throw new OneClickError('1Click quote returned no deadline', 502, 'ONE_CLICK_NO_DEADLINE');
  }
  if (!isFutureIso(deadline)) {
    throw new OneClickError('1Click quote deadline has already expired', 502, 'ONE_CLICK_QUOTE_EXPIRED');
  }

  if (confidential) {
    const returnedConfidentiality = stringValue(quoteRequest?.confidentiality);
    if (returnedConfidentiality !== confidentiality) {
      throw new OneClickError(
        `1Click did not honor confidentiality (requested ${confidentiality}, got ${returnedConfidentiality || 'none'})`,
        502,
        'ONE_CLICK_PRIVACY_DOWNGRADE'
      );
    }
    const returnedDepositType = stringValue(quoteRequest?.depositType);
    if (returnedDepositType && returnedDepositType !== request.depositType) {
      throw new OneClickError(
        `1Click changed depositType (requested ${request.depositType}, got ${returnedDepositType})`,
        502,
        'ONE_CLICK_QUOTE_MISMATCH'
      );
    }
  }

  const amountIn = stringValue(quote.amountIn);
  if (amountIn && !sameBaseUnits(amountIn, request.amount)) {
    throw new OneClickError(
      `1Click quote amountIn ${amountIn} does not match requested ${request.amount}`,
      502,
      'ONE_CLICK_QUOTE_MISMATCH'
    );
  }

  return {
    quote: {
      depositAddress,
      depositMemo: stringValue(quote.depositMemo),
      deadline,
      amountIn,
      amountOut: stringValue(quote.amountOut),
      minAmountOut: stringValue(quote.minAmountOut),
      quoteId: stringValue(quote.quoteId),
      timeEstimate: typeof quote.timeEstimate === 'number' ? quote.timeEstimate : undefined,
    },
    quoteRequest,
    signature: stringValue(raw.signature),
    timestamp: stringValue(raw.timestamp),
    correlationId: stringValue(raw.correlationId),
    raw,
  };
}

/** Reads confidential balances for an authenticated user. */
export async function getAccountBalances(
  env: Env,
  userSession: string,
  tokenIds?: string[]
): Promise<OneClickBalance[]> {
  if (!userSession.trim()) {
    throw new OneClickError('A 1Click User-Session token is required', 401, 'ONE_CLICK_USER_SESSION_MISSING');
  }
  const query = tokenIds?.length
    ? `?tokenIds=${encodeURIComponent(tokenIds.join(','))}`
    : '';
  const raw = await requestJson(
    env,
    `/v0/account/balances${query}`,
    { method: 'GET' },
    userHeaders(env, userSession)
  );
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(obj?.balances)
      ? (obj!.balances as unknown[])
      : [];
  const out: OneClickBalance[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const tokenId = stringValue(item.tokenId);
    const available = stringValue(item.available);
    if (!tokenId || !available || !/^\d+$/.test(available)) continue;
    out.push({
      tokenId,
      available,
      source: stringValue(item.source),
      raw: item,
    });
  }
  return out;
}

/** Generates the exact intent a user must sign for a quote deposit. */
export async function generateSwapIntent(
  env: Env,
  params: { depositAddress: string; signerId: string; standard?: string }
): Promise<OneClickGeneratedIntent> {
  if (!(env.ONE_CLICK_API_KEY || '').trim() && !(env.ONE_CLICK_JWT || '').trim()) {
    throw new OneClickError('ONE_CLICK_API_KEY is required', 401, 'ONE_CLICK_PARTNER_KEY_MISSING');
  }
  const raw = requireObject(
    await requestJson(
      env,
      '/v0/generate-intent',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'swap_transfer',
          standard: params.standard || 'nep413',
          signerId: params.signerId,
          depositAddress: params.depositAddress,
        }),
      },
      partnerHeaders(env)
    ),
    'generate-intent'
  );
  const intent = requireObject(raw.intent, 'generate-intent.intent');
  const payload = requireObject(intent.payload, 'generate-intent.payload');
  const message = stringValue(payload.message);
  const nonce = stringValue(payload.nonce);
  const recipient = stringValue(payload.recipient);
  const standard = stringValue(intent.standard);
  if (!message || !nonce || !recipient || !standard) {
    throw new OneClickError(
      '1Click generate-intent returned no signable payload',
      502,
      'ONE_CLICK_BAD_INTENT'
    );
  }
  return { standard, payload: { message, nonce, recipient }, correlationId: stringValue(raw.correlationId) };
}

/** Submits a signed MultiPayload and returns 1Click's intent hash. */
export async function submitSwapIntent(
  env: Env,
  signedData: OneClickMultiPayload
): Promise<{ intentHash: string; correlationId?: string }> {
  if (!(env.ONE_CLICK_API_KEY || '').trim() && !(env.ONE_CLICK_JWT || '').trim()) {
    throw new OneClickError('ONE_CLICK_API_KEY is required', 401, 'ONE_CLICK_PARTNER_KEY_MISSING');
  }
  const raw = requireObject(
    await requestJson(
      env,
      '/v0/submit-intent',
      {
        method: 'POST',
        body: JSON.stringify({ type: 'swap_transfer', signedData }),
      },
      partnerHeaders(env)
    ),
    'submit-intent'
  );
  const intentHash = stringValue(raw.intentHash);
  if (!intentHash) {
    throw new OneClickError('1Click submit-intent returned no intentHash', 502, 'ONE_CLICK_BAD_INTENT');
  }
  return { intentHash, correlationId: stringValue(raw.correlationId) };
}

/** Exchanges a User-Session refresh token for a new access token. */
export async function refreshUserSession(
  env: Env,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const raw = requireObject(
    await requestJson(
      env,
      '/v0/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      partnerHeaders(env)
    ),
    'auth/refresh'
  );
  const accessToken = stringValue(raw.accessToken);
  const expiresIn = typeof raw.expiresIn === 'number' ? raw.expiresIn : 3600;
  if (!accessToken) {
    throw new OneClickError('1Click auth refresh returned no accessToken', 502, 'ONE_CLICK_BAD_AUTH');
  }
  return { accessToken, expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000 };
}

/** Exchanges a signed empty intent for a User-Session token. */
export async function authenticateUser(
  env: Env,
  signedData: OneClickMultiPayload
): Promise<OneClickAuthSession> {
  const raw = requireObject(
    await requestJson(
      env,
      '/v0/auth/authenticate',
      { method: 'POST', body: JSON.stringify({ signedData }) },
      partnerHeaders(env)
    ),
    'auth/authenticate'
  );
  const accessToken = stringValue(raw.accessToken);
  const refreshToken = stringValue(raw.refreshToken);
  const expiresIn = typeof raw.expiresIn === 'number' ? raw.expiresIn : 3600;
  const refreshExpiresIn =
    typeof raw.refreshExpiresIn === 'number' ? raw.refreshExpiresIn : undefined;
  if (!accessToken) {
    throw new OneClickError('1Click authenticate returned no accessToken', 502, 'ONE_CLICK_BAD_AUTH');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    refreshExpiresAt:
      refreshExpiresIn === undefined ? undefined : Date.now() + refreshExpiresIn * 1000,
  };
}

/** Polls 1Click execution status for a quote deposit address. */
export async function getExecutionStatus(
  env: Env,
  depositAddress: string,
  depositMemo?: string,
  userSession?: string
): Promise<OneClickExecutionStatus> {
  const params = new URLSearchParams({ depositAddress });
  if (depositMemo) params.set('depositMemo', depositMemo);
  // Confidential quote status is scoped to the owning account. Without the
  // User-Session token 1Click returns 404 even when the swap succeeded.
  const raw = await requestJson(
    env,
    `/v0/status?${params.toString()}`,
    { method: 'GET' },
    userSession ? userHeaders(env, userSession) : partnerHeaders(env)
  );
  const obj = Array.isArray(raw)
    ? requireObject(raw[0], 'status')
    : requireObject(raw, 'status');
  const status = stringValue(obj.status) || stringValue(obj.swapStatus) || 'UNKNOWN';
  return {
    status,
    depositAddress: stringValue(obj.depositAddress),
    intentHash: stringValue(obj.intentHash),
    swapDetails:
      obj.swapDetails && typeof obj.swapDetails === 'object'
        ? (obj.swapDetails as Record<string, unknown>)
        : undefined,
    raw: obj,
  };
}

export function isTerminalStatus(status: string): boolean {
  return ['SUCCESS', 'FAILED', 'REFUNDED'].includes(status.toUpperCase());
}
