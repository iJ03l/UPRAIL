import { startAuthentication } from '@simplewebauthn/browser';
import type { NativeAuthPrepareResponse } from '../types';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i++) m.set(BASE58_ALPHABET[i], i);
  return m;
})();

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_MAP = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) m.set(CROCKFORD_ALPHABET[i], i);
  m.set('O', 0);
  m.set('I', 1);
  m.set('L', 1);
  return m;
})();

export class SelfCustodyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: any;

  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message);
    this.name = 'SelfCustodyApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let num = BigInt(0);
  for (let i = zeros; i < bytes.length; i++) {
    num = (num << BigInt(8)) | BigInt(bytes[i]);
  }

  const chars: string[] = [];
  const base = BigInt(58);
  while (num > BigInt(0)) {
    const rem = Number(num % base);
    chars.push(BASE58_ALPHABET[rem]);
    num /= base;
  }
  for (let i = 0; i < zeros; i++) chars.push('1');
  return chars.reverse().join('');
}

export function base58Decode(str: string): Uint8Array {
  const clean = str.trim();
  if (!clean) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < clean.length && clean[zeros] === '1') zeros++;

  let num = BigInt(0);
  const base = BigInt(58);
  for (let i = zeros; i < clean.length; i++) {
    const v = BASE58_MAP.get(clean[i]);
    if (v === undefined) throw new Error(`Invalid Base58 character "${clean[i]}"`);
    num = num * base + BigInt(v);
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.push(Number(num & BigInt(0xff)));
    num >>= BigInt(8);
  }
  bytes.reverse();
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes, zeros);
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function bytesFromBase64(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-512', copy.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

// ─── Pure BigInt RFC 8032 Ed25519 (works uniformly on iOS Safari, Firefox & Chrome) ───

const ED_P = (BigInt(1) << BigInt(255)) - BigInt(19);
const ED_L = (BigInt(1) << BigInt(252)) + BigInt('27742317777372353535851937790883648493');
const ED_D = BigInt('37095705934669439343138083508754565189542113879843219016388785533085940283555');
const ED_D2 = (ED_D * BigInt(2)) % ED_P;
const ED_BX = BigInt('15112221349535400772501151409588531511454012693041857206046113283949847762202');
const ED_BY = BigInt('46316835694926478169428394003475163141307993866256225615783033603165251855960');

type EdPoint = [bigint, bigint, bigint, bigint]; // (X, Y, Z, T)

function mod(a: bigint, m: bigint = ED_P): bigint {
  const r = a % m;
  return r >= BigInt(0) ? r : r + m;
}

function modPow(base: bigint, exp: bigint, m: bigint = ED_P): bigint {
  let result = BigInt(1);
  let b = mod(base, m);
  let e = exp;
  while (e > BigInt(0)) {
    if ((e & BigInt(1)) === BigInt(1)) result = (result * b) % m;
    b = (b * b) % m;
    e >>= BigInt(1);
  }
  return result;
}

function modInv(a: bigint, m: bigint = ED_P): bigint {
  return modPow(a, m - BigInt(2), m);
}

const ED_ZERO: EdPoint = [BigInt(0), BigInt(1), BigInt(1), BigInt(0)];
const ED_BASE: EdPoint = [ED_BX, ED_BY, BigInt(1), (ED_BX * ED_BY) % ED_P];

function pointAdd(p: EdPoint, q: EdPoint): EdPoint {
  const [x1, y1, z1, t1] = p;
  const [x2, y2, z2, t2] = q;
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(t1 * ED_D2 * t2);
  const d = mod(BigInt(2) * z1 * z2);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

function pointDouble(p: EdPoint): EdPoint {
  const [x1, y1, z1] = p;
  const a = mod(x1 * x1);
  const b = mod(y1 * y1);
  const c = mod(BigInt(2) * z1 * z1);
  const h = mod(a + b);
  const x1y1 = mod(x1 + y1);
  const e = mod(h - x1y1 * x1y1);
  const g = mod(a - b);
  const f = mod(c + g);
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

function scalarMult(s: bigint, point: EdPoint = ED_BASE): EdPoint {
  let acc: EdPoint = ED_ZERO;
  let cur: EdPoint = point;
  let k = s;
  while (k > BigInt(0)) {
    if ((k & BigInt(1)) === BigInt(1)) acc = pointAdd(acc, cur);
    cur = pointDouble(cur);
    k >>= BigInt(1);
  }
  return acc;
}

function bytesToLeBigInt(bytes: Uint8Array): bigint {
  let v = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) {
    v = (v << BigInt(8)) | BigInt(bytes[i]);
  }
  return v;
}

function leBigIntToBytes(n: bigint, len = 32): Uint8Array {
  const out = new Uint8Array(len);
  let v = n;
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function encodeEdPoint(pt: EdPoint): Uint8Array {
  const zInv = modInv(pt[2], ED_P);
  const x = mod(pt[0] * zInv, ED_P);
  const y = mod(pt[1] * zInv, ED_P);
  const out = leBigIntToBytes(y, 32);
  out[31] |= Number(x & BigInt(1)) << 7;
  return out;
}

function clampEdScalar(digestFirst32: Uint8Array): bigint {
  const copy = new Uint8Array(digestFirst32);
  copy[0] &= 248;
  copy[31] &= 127;
  copy[31] |= 64;
  return bytesToLeBigInt(copy);
}

export async function ed25519GetPublicKey(seed32: Uint8Array): Promise<Uint8Array> {
  if (seed32.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const h = await sha512(seed32);
  const a = clampEdScalar(h.subarray(0, 32));
  return encodeEdPoint(scalarMult(a));
}

export async function ed25519Sign(message: Uint8Array, seed32: Uint8Array): Promise<Uint8Array> {
  if (seed32.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const h = await sha512(seed32);
  const a = clampEdScalar(h.subarray(0, 32));
  const prefix = h.subarray(32, 64);
  const pubBytes = encodeEdPoint(scalarMult(a));

  const rHash = await sha512(concatBytes(prefix, message));
  const r = mod(bytesToLeBigInt(rHash), ED_L);
  const capR = encodeEdPoint(scalarMult(r));

  const kHash = await sha512(concatBytes(capR, pubBytes, message));
  const k = mod(bytesToLeBigInt(kHash), ED_L);
  const s = mod(r + k * a, ED_L);

  return concatBytes(capR, leBigIntToBytes(s, 32));
}

// ─── Device-Only Backup Recovery Key (HKDF-SHA256 -> Ed25519) ───────────────────────

function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeCrockford(str: string, expectedBytes: number): Uint8Array {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of str) {
    const v = CROCKFORD_MAP.get(ch);
    if (v === undefined) throw new Error('Recovery Key contains invalid characters.');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length < expectedBytes) {
    throw new Error('Recovery Key is incomplete. Check that all characters were pasted.');
  }
  return new Uint8Array(bytes.slice(0, expectedBytes));
}

/**
 * Generates a high-entropy (128-bit) device-only Recovery Key phrase with a
 * built-in SHA-256 checksum byte (`UP1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`).
 * Never transmitted to UPRAIL servers.
 */
export async function generateDeviceRecoveryKey(): Promise<string> {
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  const check = (await sha256(entropy))[0];
  const raw = encodeCrockford(concatBytes(entropy, Uint8Array.of(check))); // 28 chars
  const groups = raw.match(/.{1,4}/g) || [raw];
  return `UP1-${groups.join('-')}`;
}

export async function parseDeviceRecoveryEntropy(phrase: string): Promise<Uint8Array> {
  const cleaned = phrase
    .trim()
    .toUpperCase()
    .replace(/^UP1[-_\s]*/i, '')
    .replace(/[\s-]+/g, '');
  if (!cleaned) throw new Error('Enter your UPRAIL Recovery Key.');
  const decoded = decodeCrockford(cleaned, 17);
  const entropy = decoded.subarray(0, 16);
  const checksum = decoded[16];
  const expected = (await sha256(entropy))[0];
  if (checksum !== expected) {
    throw new Error('Recovery Key checksum mismatch — please check for a typo.');
  }
  return new Uint8Array(entropy);
}

/**
 * Deterministically derives the user's Backup Ed25519 keypair from their offline
 * Recovery Key using HKDF-SHA256 domain-separated to `nearAccount`.
 */
export async function deriveBackupEd25519Keypair(
  phrase: string,
  nearAccount: string
): Promise<{
  seed32: Uint8Array;
  publicKeyBytes: Uint8Array;
  nearPublicKey: string;
  nearPrivateKey: string;
}> {
  const entropy = await parseDeviceRecoveryEntropy(phrase);
  const ikm = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(entropy).buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8ToBytes('uprail:self-custody:backup-key:v1').buffer as ArrayBuffer,
      info: utf8ToBytes(nearAccount.trim().toLowerCase()).buffer as ArrayBuffer,
    },
    ikm,
    256
  );
  const seed32 = new Uint8Array(bits);
  const publicKeyBytes = await ed25519GetPublicKey(seed32);
  return {
    seed32,
    publicKeyBytes,
    nearPublicKey: `ed25519:${base58Encode(publicKeyBytes)}`,
    nearPrivateKey: `ed25519:${base58Encode(concatBytes(seed32, publicKeyBytes))}`,
  };
}

function u32Le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

export function borshSerializeNep413(
  message: string,
  nonceBytes: Uint8Array,
  recipient: string
): Uint8Array {
  if (nonceBytes.length !== 32) {
    throw new Error(`NEP-413 nonce must be 32 bytes (got ${nonceBytes.length})`);
  }
  const msgBytes = utf8ToBytes(message);
  const recBytes = utf8ToBytes(recipient);
  const magic = 2147483648 + 413; // 2^31 + 413
  return concatBytes(
    u32Le(magic),
    u32Le(msgBytes.length),
    msgBytes,
    nonceBytes,
    u32Le(recBytes.length),
    recBytes,
    Uint8Array.of(0) // callbackUrl: None
  );
}

/**
 * Signs a prepared NEP-413 payload offline in browser memory with the user's
 * derived Backup Key. Neither the Recovery Key nor private seed leaves the browser.
 */
export async function signNep413RecoveryPayload(params: {
  phrase: string;
  nearAccount: string;
  payload: { message: string; nonce: string; recipient: string };
}) {
  const { seed32, nearPublicKey } = await deriveBackupEd25519Keypair(
    params.phrase,
    params.nearAccount
  );
  const nonceBytes = bytesFromBase64(params.payload.nonce);
  const borsh = borshSerializeNep413(params.payload.message, nonceBytes, params.payload.recipient);
  const digest = await sha256(borsh);
  const sig = await ed25519Sign(digest, seed32);
  seed32.fill(0);
  return {
    standard: 'nep413' as const,
    payload: params.payload,
    public_key: nearPublicKey,
    signature: `ed25519:${base58Encode(sig)}`,
  };
}

// ─── WebAuthn + Multi-Step Self-Custody + Two-Step NEAR L1 Key Authorization ────────

export async function performWebAuthnAssertion(options: Record<string, unknown>) {
  // Preserve `allowCredentials` when provided by prepare endpoints (e.g. Circle/Gift
  // bound passkeys) so the browser selects the exact bound credential automatically.
  const normalized: any = {
    ...options,
    userVerification: 'preferred',
  };
  if (!Array.isArray(normalized.allowCredentials) || normalized.allowCredentials.length === 0) {
    delete normalized.allowCredentials;
  }
  return startAuthentication(normalized);
}

export interface NativeL1PromptRequest {
  prepared: NativeAuthPrepareResponse;
  submitAuthorized: (signedAssertion: unknown) => Promise<any>;
}

type NativeL1PromptHandler = (req: NativeL1PromptRequest) => Promise<any>;

let nativeL1Handler: NativeL1PromptHandler | null = null;

export function registerNativeL1PromptHandler(handler: NativeL1PromptHandler | null): () => void {
  nativeL1Handler = handler;
  return () => {
    if (nativeL1Handler === handler) nativeL1Handler = null;
  };
}

export async function triggerNativeL1TwoStepPrompt<T = any>(
  req: NativeL1PromptRequest
): Promise<T> {
  if (nativeL1Handler) {
    return await nativeL1Handler(req);
  }
  const assertion = await performWebAuthnAssertion(req.prepared.options);
  return await req.submitAuthorized(assertion);
}

export type SelfCustodyProgressStage =
  | 'preparing'
  | 'oneclick_auth'
  | 'native_l1_auth'
  | 'shielding'
  | 'swapping'
  | 'polling_swap'
  | 'authorizing'
  | 'submitting';

export interface RunSelfCustodyActionParams<TResult = any> {
  prepare: () => Promise<any>;
  submit: (body: { actionId: string; assertion: unknown; step?: string }) => Promise<TResult>;
  submitOneClickSession?: (body: { actionId: string; assertion: unknown }) => Promise<any>;
  pollSwapStatus?: (prep: {
    depositAddress: string;
    vaultAssetId?: string;
    balanceBeforeAtomic?: string;
  }) => Promise<{ status: string; readyToDeposit?: boolean }>;
  onProgress?: (stage: SelfCustodyProgressStage, message: string) => void;
  onNativeAuthFallback?: NativeL1PromptHandler;
}

/**
 * Orchestrates prepare -> optional 1Click session auth -> optional two-step NEAR L1
 * key authorization -> optional shield / vault swap + polling -> final passkey submit.
 */
export async function runSelfCustodyAction<TResult = any>(
  params: RunSelfCustodyActionParams<TResult>
): Promise<TResult> {
  const { prepare, submit, submitOneClickSession, pollSwapStatus, onProgress, onNativeAuthFallback } = params;

  for (let round = 0; round < 6; round++) {
    onProgress?.('preparing', 'Preparing on-chain authorization…');
    let prep: any;
    try {
      prep = await prepare();
    } catch (err: any) {
      if (
        err instanceof SelfCustodyApiError &&
        err.code === 'ONECLICK_AUTH_REQUIRED' &&
        err.payload?.oneClickPrepare
      ) {
        onProgress?.('oneclick_auth', 'Confirm with passkey to unlock private 1Click session…');
        const ocPrep = err.payload.oneClickPrepare;
        const ocAssertion = await performWebAuthnAssertion(ocPrep.options);
        if (submitOneClickSession) {
          await submitOneClickSession({ actionId: ocPrep.actionId, assertion: ocAssertion });
        } else {
          const res = await fetch('/api/custody/oneclick-session/submit', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionId: ocPrep.actionId, assertion: ocAssertion }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || 'Could not authorize 1Click confidential session.');
          }
        }
        continue;
      }
      throw err;
    }

    // Handle nested shieldPrepare envelope returned when confidential balance needs topping up
    const activePrep = prep?.ready === false && prep?.shieldPrepare ? prep.shieldPrepare : prep;

    // Short-circuit idempotent prepare responses that require no further WebAuthn signature
    if (
      activePrep &&
      !activePrep.options &&
      (activePrep.alreadyActive || activePrep.alreadySigned || activePrep.completed === true)
    ) {
      return activePrep as TResult;
    }

    // Handle deliberate two-step NEAR L1 key authorization ("Sign -> Authorize & Use L1 Key")
    if (activePrep?.step === 'native_auth') {
      onProgress?.('native_l1_auth', 'Two-step NEAR L1 key authorization required…');
      const handler = nativeL1Handler || onNativeAuthFallback;
      let l1Result: any;
      if (handler) {
        l1Result = await handler({
          prepared: activePrep as NativeAuthPrepareResponse,
          submitAuthorized: (assertion) =>
            submit({ actionId: activePrep.actionId, assertion, step: 'native_auth' }),
        });
      } else {
        const assertion = await performWebAuthnAssertion(activePrep.options);
        l1Result = await submit({ actionId: activePrep.actionId, assertion, step: 'native_auth' });
      }
      if (l1Result?.completed || activePrep.nextStep === 'completed' || activePrep.nextStep === 'settings') {
        return l1Result as TResult;
      }
      // Sweep-to-Intents finished so upstream Intents action can now proceed cleanly
      continue;
    }

    // Handle multi-step shielding (intents.near -> confidential pool)
    if (activePrep?.step === 'shield') {
      onProgress?.(
        'shielding',
        `Tap passkey to shield ${activePrep.shieldAmountFormatted || ''} ${activePrep.symbol || ''} privately…`
      );
      const assertion = await performWebAuthnAssertion(activePrep.options);
      onProgress?.('submitting', 'Shielding balance privately…');
      await submit({ actionId: activePrep.actionId, assertion, step: 'shield' });
      continue;
    }

    // Handle multi-step unshielding (confidential pool -> public intents.near)
    if (activePrep?.step === 'unshield') {
      onProgress?.(
        'shielding',
        `Tap passkey to move ${activePrep.unshieldAmountFormatted || ''} ${activePrep.symbol || 'USDC'} from private balance…`
      );
      const assertion = await performWebAuthnAssertion(activePrep.options);
      onProgress?.('submitting', 'Moving funds into swap balance…');
      const unshieldRes: any = await submit({
        actionId: activePrep.actionId,
        assertion,
        step: 'unshield',
      });
      if (
        !unshieldRes?.settled &&
        pollSwapStatus &&
        (unshieldRes?.depositAddress || activePrep.depositAddress)
      ) {
        onProgress?.('polling_swap', 'Waiting for private funds to settle into swap balance…');
        const depAddr = unshieldRes?.depositAddress || activePrep.depositAddress;
        const vaultAssetId = unshieldRes?.vaultAssetId || activePrep.vaultAssetId || activePrep.assetId;
        const balanceBeforeAtomic =
          unshieldRes?.balanceBeforeAtomic || activePrep.balanceBeforeAtomic || '0';
        const deadline = Date.now() + 65_000;
        let ready = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await pollSwapStatus({
            depositAddress: depAddr,
            vaultAssetId,
            balanceBeforeAtomic,
          }).catch(() => null);
          const upper = String(st?.status || '').toUpperCase();
          if (st?.readyToDeposit || upper === 'SUCCESS') {
            ready = true;
            break;
          }
          if (upper === 'FAILED' || upper === 'REFUNDED') {
            throw new Error(`Private unshield ${upper.toLowerCase()}. Your funds stayed safely in your private balance.`);
          }
        }
        if (!ready) {
          throw new Error('Private funds are still settling (~15s). Please tap retry in a moment.');
        }
      }
      continue;
    }

    // Handle multi-step Circle/Gift cross-asset swap into Earn vault shares before contract deposit
    if (activePrep?.step === 'swap_to_vault') {
      onProgress?.('swapping', 'Confirm passkey to swap into Earn Vault shares…');
      const assertion = await performWebAuthnAssertion(activePrep.options);
      onProgress?.('submitting', 'Executing 1Click vault conversion…');
      const swapRes: any = await submit({
        actionId: activePrep.actionId,
        assertion,
        step: 'swap_to_vault',
      });
      if (pollSwapStatus && (swapRes?.depositAddress || activePrep.depositAddress)) {
        onProgress?.('polling_swap', 'Waiting for Earn Vault shares to arrive…');
        const depAddr = swapRes?.depositAddress || activePrep.depositAddress;
        const vaultAssetId = swapRes?.vaultAssetId || activePrep.vaultAssetId;
        const balanceBeforeAtomic = swapRes?.balanceBeforeAtomic || activePrep.balanceBeforeAtomic || '0';
        const deadline = Date.now() + 65_000;
        let ready = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await pollSwapStatus({
            depositAddress: depAddr,
            vaultAssetId,
            balanceBeforeAtomic,
          }).catch(() => null);
          const upper = String(st?.status || '').toUpperCase();
          if (st?.readyToDeposit || upper === 'SUCCESS') {
            ready = true;
            break;
          }
          if (upper === 'FAILED' || upper === 'REFUNDED') {
            throw new Error(`1Click reported vault conversion as ${upper.toLowerCase()}. Funds returned safely.`);
          }
        }
        if (!ready) {
          throw new Error('Vault conversion is still settling on 1Click. Wait a few seconds and retry deposit.');
        }
      }
      continue;
    }

    // Final single-step passkey signature
    onProgress?.('authorizing', 'Confirm with your device passkey…');
    const finalAssertion = await performWebAuthnAssertion(activePrep.options);
    onProgress?.('submitting', 'Broadcasting signed intent…');
    return await submit({
      actionId: activePrep.actionId,
      assertion: finalAssertion,
      step: activePrep.step,
    });
  }

  throw new Error('Self-custody workflow exceeded maximum authorization steps.');
}
