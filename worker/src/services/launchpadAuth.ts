import type { Env } from '../types';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode } from '../utils/base58';
import { hasAccessKey, nep413Serialize } from './nearRpc';

export interface LaunchpadProof {
  signerId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  recipient: string;
}

const DEFAULT_DAILY_REG_CAP = 100;
const MAX_PROOF_AGE_MS = 5 * 60 * 1000;

function decodeBase64(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parentAccountOf(token: string): string | null {
  const parts = token.toLowerCase().split('.');
  if (parts.length < 3) return null;
  return parts.slice(1).join('.');
}

export async function buildLaunchpadRegistrationMessage(payload: {
  token: string;
  handle: string;
  launchpad: unknown;
  verification: unknown;
  claim: unknown;
  issuedAt: number;
}): Promise<string> {
  return `UPRAIL launchpad registration\n${await sha256Hex(canonicalJson(payload))}`;
}

export async function verifyLaunchpadProofSignature(
  proof: Pick<LaunchpadProof, 'publicKey' | 'signature' | 'nonce' | 'recipient'>,
  message: string,
  expectedRecipient: string
): Promise<boolean> {
  if (!proof || proof.recipient !== expectedRecipient) return false;
  if (!proof.publicKey?.startsWith('ed25519:')) return false;
  try {
    const publicKey = base58Decode(proof.publicKey);
    const signature = decodeBase64(proof.signature);
    const nonce = decodeBase64(proof.nonce);
    if (publicKey.length !== 32 || signature.length !== 64 || nonce.length !== 32) return false;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      nep413Serialize(message, nonce, expectedRecipient)
    );
    return ed25519.verify(signature, new Uint8Array(digest), publicKey);
  } catch {
    return false;
  }
}

export async function verifyLaunchpadProof(
  env: Env,
  proof: LaunchpadProof,
  message: string
): Promise<{ ok: boolean; signerId?: string; error?: string }> {
  const expectedRecipient = env.MASTER_ACCOUNT_ID || 'uprail.near';
  if (!proof || proof.recipient !== expectedRecipient) {
    return { ok: false, error: `Proof recipient must be ${expectedRecipient}.` };
  }
  const signerId = (proof.signerId || '').trim().toLowerCase();
  if (!signerId) return { ok: false, error: 'Proof signerId is required.' };
  if (!(await verifyLaunchpadProofSignature(proof, message, expectedRecipient))) {
    return { ok: false, error: 'Invalid proof signature.' };
  }
  if (!(await hasAccessKey(env, signerId, proof.publicKey))) {
    return { ok: false, error: 'Proof key is not an access key on the signer account.' };
  }
  if (env.CACHE) {
    try {
      const nonceKey = `launchpad:nonce:${signerId}:${proof.nonce}`;
      if (await env.CACHE.get(nonceKey)) {
        return { ok: false, error: 'Proof nonce was already used.' };
      }
      await env.CACHE.put(nonceKey, '1', { expirationTtl: 600 });
    } catch {}
  }
  return { ok: true, signerId };
}

export function proofIssuedAtValid(issuedAt: unknown, now = Date.now()): boolean {
  return typeof issuedAt === 'number' && Math.abs(now - issuedAt) <= MAX_PROOF_AGE_MS;
}

function dayKey(signerId: string): string {
  return `launchpad:reg:${signerId}:${new Date().toISOString().slice(0, 10)}`;
}

function dailyCap(env: Env): number {
  const cap = parseInt(env.LAUNCHPAD_DAILY_REG_CAP ?? '', 10);
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_DAILY_REG_CAP;
}

export async function launchpadRegistrationAllowed(
  env: Env,
  signerId: string
): Promise<boolean> {
  if (!env.CACHE) return true;
  try {
    const used = parseInt((await env.CACHE.get(dayKey(signerId))) || '0', 10) || 0;
    return used < dailyCap(env);
  } catch {
    return true;
  }
}

export async function recordLaunchpadRegistration(
  env: Env,
  signerId: string
): Promise<void> {
  if (!env.CACHE) return;
  try {
    const key = dayKey(signerId);
    const used = parseInt((await env.CACHE.get(key)) || '0', 10) || 0;
    await env.CACHE.put(key, String(used + 1), { expirationTtl: 2 * 24 * 3600 });
  } catch {}
}
