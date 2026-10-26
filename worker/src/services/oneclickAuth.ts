/**
 * End-user authentication for 1Click Confidential Intents.
 *
 * 1Click exposes confidential balances only to a User-Session token minted from
 * a wallet-signed empty intent. UPRAIL derives each user's Intents key, proves
 * it is registered, signs a versioned-nonce empty intent, and caches the
 * short-lived token. Nothing here is allowed to fall back to a public quote.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import type { Env } from '../types';
import { base58Decode, base58Encode } from '../utils/base58';
import {
  authenticateUser,
  refreshUserSession,
  type OneClickAuthSession,
  type OneClickGeneratedIntent,
  type OneClickMultiPayload,
} from './oneclickClient';
import {
  base64ToBytes,
  createTimestampedNonceBytes,
  decodeVersionedNonce,
  encodeVersionedNonce,
  saltFromHex,
} from './intentsNonce';
import {
  createOnchainSubAccount,
  deriveUserNearKeypair,
  ensureKeyOnIntents,
  nep413Serialize,
} from './nearRpc';

const SESSION_CACHE_PREFIX = '1click:user-session:';
const ESCROW_SESSION_CACHE_KEY = '1click:escrow-session';
const SALT_CACHE_KEY = '1click:intents-salt';
const SALT_TTL_SECONDS = 5 * 60;
const AUTH_DEADLINE_MS = 10 * 60 * 1000;

interface CachedSession extends OneClickAuthSession {
  accountId: string;
}

export interface UserSigningKey {
  accountId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyB58: string;
}

function sessionCacheKey(xId: string): string {
  return `${SESSION_CACHE_PREFIX}${xId}`;
}

function intentsAccount(env: Env): string {
  return env.INTENTS_CONTRACT_ID || 'intents.near';
}

async function rpcPost(env: Env, body: Record<string, unknown>): Promise<any> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  let resp: Response;
  try {
    resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new Error(`NEAR RPC unavailable: ${err?.message || String(err)}`);
  }
  if (!resp.ok) throw new Error(`NEAR RPC HTTP ${resp.status}`);
  const data = (await resp.json()) as any;
  if (data?.error) {
    throw new Error(data.error?.message || data.error?.data || 'NEAR RPC error');
  }
  return data;
}

function decodeRpcBytes(value: unknown): string {
  if (Array.isArray(value)) {
    return new TextDecoder().decode(Uint8Array.from(value as number[]));
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    /^[0-9-]/.test(trimmed)
  ) {
    return value;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

/**
 * Reads `intents.near.current_salt`. The salt rotates; a stale hard-coded salt
 * makes every auth attempt fail with "invalid nonce".
 */
export async function getCurrentIntentsSalt(env: Env): Promise<string> {
  try {
    const cached = await env.CACHE?.get(SALT_CACHE_KEY);
    if (typeof cached === 'string' && /^[0-9a-fA-F]{8}$/.test(cached)) return cached;
  } catch {
    // fall through to the live read
  }

  const data = await rpcPost(env, {
    jsonrpc: '2.0',
    id: 1,
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: intentsAccount(env),
      method_name: 'current_salt',
      args_base64: btoa('{}'),
    },
  });
  const raw = decodeRpcBytes(data?.result?.result);
  if (!raw) throw new Error('intents.near.current_salt returned no value');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  const salt =
    typeof parsed === 'string'
      ? parsed.replace(/^"|"$/g, '')
      : typeof (parsed as any)?.salt === 'string'
        ? (parsed as any).salt
        : '';
  if (!/^[0-9a-fA-F]{8}$/.test(salt)) {
    throw new Error(`intents.near.current_salt returned an invalid salt: ${String(salt).slice(0, 40)}`);
  }
  try {
    await env.CACHE?.put(SALT_CACHE_KEY, salt, { expirationTtl: SALT_TTL_SECONDS });
  } catch {
    // caching is an optimization only
  }
  return salt;
}

async function resolveAccountId(env: Env, xId: string, fallback: string): Promise<string> {
  if (!env.DB) return fallback;
  try {
    const row = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
      .bind(xId)
      .first<{ near_account: string | null }>();
    return row?.near_account || fallback;
  } catch {
    return fallback;
  }
}

async function deriveSigningKey(env: Env, xId: string): Promise<UserSigningKey> {
  const derived = await deriveUserNearKeypair(env, xId);
  const accountId = await resolveAccountId(env, xId, derived.accountId);
  return {
    accountId,
    publicKey: derived.publicKey,
    privateKey: derived.privateKey,
    publicKeyB58: derived.publicKeyB58,
  };
}

async function ensureSigningKey(env: Env, key: UserSigningKey): Promise<void> {
  // Creating the account is idempotent and only possible when the escrow key is
  // configured. Registration on intents.near is what actually authorizes the
  // signature, so a failure there is fatal.
  try {
    await createOnchainSubAccount(env, key.accountId, key.publicKey, key.privateKey);
  } catch (err: any) {
    console.warn(`[oneclickAuth] sub-account provisioning skipped for ${key.accountId}:`, err?.message || err);
  }
  const ready = await ensureKeyOnIntents(env, key.accountId, key.publicKey, key.privateKey);
  if (!ready.registered) {
    throw new Error(
      `Your signing key is not set up on NEAR Intents yet${ready.reason ? ` (${ready.reason})` : ''} — please try again in a moment.`
    );
  }
}

async function signNep413Async(
  key: UserSigningKey,
  message: string,
  nonceB64: string,
  recipient: string
): Promise<OneClickMultiPayload> {
  const nonceBytes = base64ToBytes(nonceB64);
  if (nonceBytes.length !== 32) throw new Error('1Click intent nonce must be 32 bytes');
  const serialized = nep413Serialize(message, nonceBytes, recipient);
  const digest = await crypto.subtle.digest('SHA-256', serialized);
  const sig = ed25519.sign(new Uint8Array(digest), key.privateKey);
  return {
    standard: 'nep413',
    payload: { message, nonce: nonceB64, recipient },
    public_key: key.publicKeyB58,
    signature: `ed25519:${base58Encode(sig)}`,
  };
}

async function signEmptyIntent(env: Env, key: UserSigningKey): Promise<OneClickMultiPayload> {
  const salt = saltFromHex(await getCurrentIntentsSalt(env));
  const deadline = new Date(Date.now() + AUTH_DEADLINE_MS);
  const nonce = encodeVersionedNonce(salt, deadline, createTimestampedNonceBytes());
  const message = JSON.stringify({
    deadline: deadline.toISOString(),
    intents: [],
    signer_id: key.accountId,
  });
  return await signNep413Async(key, message, nonce, intentsAccount(env));
}

/**
 * The escrow account signs its own Confidential Intents legs (claims/refunds
 * out of the pooled escrow balance). It uses the existing escrow key; no new
 * secret or derived account is introduced.
 */
export async function getEscrowSigningKey(env: Env): Promise<UserSigningKey> {
  const raw = env.ESCROW_PRIVATE_KEY;
  if (!raw) throw new Error('ESCROW_PRIVATE_KEY is missing');
  const privateKey = base58Decode(raw).slice(0, 32);
  if (privateKey.length !== 32) throw new Error('ESCROW_PRIVATE_KEY is not an ed25519 private key');
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    accountId: env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near',
    publicKey,
    privateKey,
    publicKeyB58: `ed25519:${base58Encode(publicKey)}`,
  };
}

async function cacheSession(
  env: Env,
  cacheKey: string,
  accountId: string,
  session: OneClickAuthSession
): Promise<{ accessToken: string; accountId: string }> {
  const cached: CachedSession = { ...session, accountId };
  const ttl = Math.max(
    60,
    Math.floor(((session.refreshExpiresAt || session.expiresAt) - Date.now()) / 1000)
  );
  try {
    await env.CACHE?.put(cacheKey, JSON.stringify(cached), { expirationTtl: ttl });
  } catch {
    // A cache miss only costs another signature next request.
  }
  return { accessToken: session.accessToken, accountId };
}

async function sessionFromCache(env: Env, cacheKey: string): Promise<{ accessToken: string; accountId: string } | null> {
  try {
    const cached = (await env.CACHE?.get(cacheKey, 'json')) as CachedSession | null;
    if (cached?.accessToken && cached.expiresAt > Date.now() + 30_000) {
      return { accessToken: cached.accessToken, accountId: cached.accountId };
    }
    if (
      cached?.refreshToken &&
      (!cached.refreshExpiresAt || cached.refreshExpiresAt > Date.now() + 30_000)
    ) {
      const refreshed = await refreshUserSession(env, cached.refreshToken);
      const next: CachedSession = {
        ...cached,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      };
      const ttl = Math.max(60, Math.floor((next.refreshExpiresAt || next.expiresAt - Date.now()) / 1000));
      await env.CACHE?.put(cacheKey, JSON.stringify(next), { expirationTtl: ttl });
      return { accessToken: next.accessToken, accountId: next.accountId };
    }
  } catch (err: any) {
    console.warn(`[oneclickAuth] cached session refresh failed:`, err?.message || err);
  }
  return null;
}

function validateGeneratedIntent(
  env: Env,
  generated: OneClickGeneratedIntent,
  key: UserSigningKey
): void {
  if (generated.standard !== 'nep413') {
    throw new Error(`Unsupported 1Click intent standard: ${generated.standard}`);
  }
  // Confidential swaps are generated against the FAR verifier. Public
  // intents use intents.near; both are the only recipients we sign for.
  const allowedRecipients = new Set([intentsAccount(env), 'intents.far']);
  if (!allowedRecipients.has(generated.payload.recipient)) {
    throw new Error(
      `Refusing to sign an intent for ${generated.payload.recipient}; expected ${intentsAccount(env)} or intents.far`
    );
  }
  const decoded = decodeVersionedNonce(generated.payload.nonce);
  if (decoded.deadline.getTime() <= Date.now()) {
    throw new Error('1Click returned an already-expired intent');
  }
  let message: any;
  try {
    message = JSON.parse(generated.payload.message);
  } catch {
    throw new Error('1Click returned a non-JSON intent message');
  }
  if (message?.signer_id !== key.accountId) {
    throw new Error('1Click intent signer does not match the authenticated account');
  }
  if (!Array.isArray(message?.intents)) {
    throw new Error('1Click intent message has no intents array');
  }
  const deadline = typeof message?.deadline === 'string' ? Date.parse(message.deadline) : NaN;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error('1Click intent message deadline is invalid');
  }
}

/** Signs a 1Click-generated swap intent without modifying its payload. */
export async function signGeneratedIntentWithKey(
  env: Env,
  key: UserSigningKey,
  generated: OneClickGeneratedIntent
): Promise<OneClickMultiPayload> {
  validateGeneratedIntent(env, generated, key);
  return await signNep413Async(
    key,
    generated.payload.message,
    generated.payload.nonce,
    generated.payload.recipient
  );
}

/** Signs a 1Click-generated swap intent without modifying its payload. */
export async function signGeneratedIntent(
  env: Env,
  xId: string,
  generated: OneClickGeneratedIntent
): Promise<OneClickMultiPayload> {
  const key = await deriveSigningKey(env, xId);
  await ensureSigningKey(env, key);
  return await signGeneratedIntentWithKey(env, key, generated);
}

/** Signs a 1Click-generated swap intent as the pooled escrow account. */
export async function signGeneratedIntentForEscrow(
  env: Env,
  generated: OneClickGeneratedIntent
): Promise<OneClickMultiPayload> {
  const key = await getEscrowSigningKey(env);
  const ready = await ensureKeyOnIntents(env, key.accountId, key.publicKey, key.privateKey);
  if (!ready.registered) {
    throw new Error(`Escrow signing key is not registered on NEAR Intents${ready.reason ? ` (${ready.reason})` : ''}`);
  }
  return await signGeneratedIntentWithKey(env, key, generated);
}

/** Returns a valid User-Session token, refreshing or re-signing as needed. */
export async function getUserSession(
  env: Env,
  xId: string,
  opts: { force?: boolean } = {}
): Promise<{ accessToken: string; accountId: string }> {
  const key = sessionCacheKey(xId);
  if (!opts.force) {
    const cached = await sessionFromCache(env, key);
    if (cached) return cached;
  }

  const signingKey = await deriveSigningKey(env, xId);
  await ensureSigningKey(env, signingKey);
  const signedData = await signEmptyIntent(env, signingKey);
  const session = await authenticateUser(env, signedData);
  return await cacheSession(env, key, signingKey.accountId, session);
}

/** Returns a User-Session for the pooled escrow account. */
export async function getEscrowSession(
  env: Env,
  opts: { force?: boolean } = {}
): Promise<{ accessToken: string; accountId: string }> {
  if (!opts.force) {
    const cached = await sessionFromCache(env, ESCROW_SESSION_CACHE_KEY);
    if (cached) return cached;
  }
  const key = await getEscrowSigningKey(env);
  const ready = await ensureKeyOnIntents(env, key.accountId, key.publicKey, key.privateKey);
  if (!ready.registered) {
    throw new Error(`Escrow signing key is not registered on NEAR Intents${ready.reason ? ` (${ready.reason})` : ''}`);
  }
  const signedData = await signEmptyIntent(env, key);
  const session = await authenticateUser(env, signedData);
  return await cacheSession(env, ESCROW_SESSION_CACHE_KEY, key.accountId, session);
}

export async function clearUserSession(env: Env, xId: string): Promise<void> {
  try {
    await env.CACHE?.delete(sessionCacheKey(xId));
  } catch {
    // ignore
  }
}
