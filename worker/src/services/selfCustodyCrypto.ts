/**
 * Cryptographic primitives for opt-in NEAR Intents passkey self-custody (P-256 WebAuthn)
 * and client-derived ed25519 backup keys (NEP-413).
 *
 * Verified against mainnet intents.near:
 *  - Public keys use uncompressed 64-byte x||y encoded as `p256:<base58>`
 *  - Signatures use low-S normalized 64-byte r||s encoded as `p256:<base58>`
 *  - WebAuthn authenticator_data MUST be unpadded base64url (padded base64 fails on-chain)
 *  - Challenge inside client_data_json is unpadded base64url(sha256(utf8(payload)))
 */

import { p256 } from '@noble/curves/nist.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { decodeCredentialPublicKey, cose } from '@simplewebauthn/server/helpers';
import { base58Decode, base58Encode } from '../utils/base58';
import { encodeVersionedNonce, saltFromHex } from './intentsNonce';

// NIST P-256 curve group order n and floor(n / 2) for low-S normalization.
export const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const P256_HALF_ORDER = P256_ORDER >> 1n;

export interface SignedWebAuthnPayload {
  standard: 'webauthn';
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
}

export interface SignedNep413Payload {
  standard: 'nep413';
  payload: {
    message: string;
    nonce: string;
    recipient: string;
    callbackUrl?: string | null;
  };
  public_key: string;
  signature: string;
}

export type IntentsAction =
  | {
      intent: 'transfer';
      receiver_id: string;
      tokens: Record<string, string>;
      memo?: string;
      msg?: string;
      min_gas?: string;
    }
  | {
      intent: 'add_public_key';
      public_key: string;
    }
  | {
      intent: 'remove_public_key';
      public_key: string;
    }
  | {
      intent: 'set_auth_by_predecessor_id';
      enabled: boolean;
    }
  | {
      intent: 'mt_withdraw';
      token: string;
      receiver_id: string;
      token_ids: string[];
      amounts: string[];
      memo?: string;
      msg?: string;
      min_gas?: string;
    }
  | {
      intent: 'ft_withdraw';
      token: string;
      receiver_id: string;
      amount: string;
      memo?: string;
      msg?: string;
      storage_deposit?: string;
      min_gas?: string;
    }
  | {
      intent: 'native_withdraw';
      receiver_id: string;
      amount: string;
    };

export interface IntentsPayloadBody {
  signer_id: string;
  verifying_contract: string;
  deadline: string;
  nonce: string;
  intents: IntentsAction[];
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function bytesToBase64UrlUnpadded(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(trimmed)) {
    throw new Error('Invalid base64/base64url input');
  }
  const std = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  const bin = atob(std + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

export async function sha256Utf8(text: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(text));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < bytes.length; i++) {
    v = (v << 8n) | BigInt(bytes[i]);
  }
  return v;
}

function bigIntToBytes32BE(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) {
    throw new Error('Scalar out of 256-bit range');
  }
  const out = new Uint8Array(32);
  let cur = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(cur & 0xffn);
    cur >>= 8n;
  }
  return out;
}

export function ed25519PubkeyToNear(pub32: Uint8Array): string {
  if (pub32.length !== 32) {
    throw new Error(`Expected 32-byte ed25519 public key, got ${pub32.length}`);
  }
  return `ed25519:${base58Encode(pub32)}`;
}

export function p256PubkeyXYToNear(xy64: Uint8Array): string {
  if (xy64.length !== 64) {
    throw new Error(`Expected 64-byte P-256 public key (x||y), got ${xy64.length}`);
  }
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(xy64, 1);
  p256.Point.fromBytes(uncompressed).assertValidity();
  return `p256:${base58Encode(xy64)}`;
}

/**
 * Parses and validates either a `p256:<base58>` or `ed25519:<base58>` key.
 */
export function parseNearPublicKey(key: string): {
  kind: 'p256' | 'ed25519';
  bytes: Uint8Array;
  formatted: string;
} {
  const trimmed = key.trim();
  if (trimmed.startsWith('p256:')) {
    const raw = base58Decode(trimmed);
    return {
      kind: 'p256',
      bytes: raw,
      formatted: p256PubkeyXYToNear(raw),
    };
  }
  if (trimmed.startsWith('ed25519:')) {
    const raw = base58Decode(trimmed);
    const formatted = ed25519PubkeyToNear(raw);
    return {
      kind: 'ed25519',
      bytes: raw,
      formatted,
    };
  }
  throw new Error('Unsupported NEAR Intents public key scheme (expected p256: or ed25519:)');
}

/**
 * Computes NEAR Intents EVM-style implicit account ID from a `p256:` key:
 * `0x<hex(keccak256("p256" || pk64)[12..32])>`.
 */
export function nearP256ToImplicitAddress(nearP256: string): string {
  const parsed = parseNearPublicKey(nearP256);
  if (parsed.kind !== 'p256') {
    throw new Error('Expected p256: public key');
  }
  const prefix = new TextEncoder().encode('p256');
  const digest = keccak_256(concatBytes(prefix, parsed.bytes));
  return `0x${bytesToHex(digest.slice(12))}`;
}

/**
 * Converts a WebAuthn COSE CBOR public key (stored in D1 `passkeys.public_key` as hex
 * or passed as raw Uint8Array) to NEAR Intents format `p256:<base58(64-byte x||y)>`.
 */
export function cosePublicKeyToNearP256(coseInput: Uint8Array | string): string {
  const coseBytes = typeof coseInput === 'string' ? hexToBytes(coseInput) : coseInput;
  if (coseBytes.length === 0) {
    throw new Error('Empty COSE public key');
  }

  let decoded: ReturnType<typeof decodeCredentialPublicKey>;
  try {
    decoded = decodeCredentialPublicKey(new Uint8Array(coseBytes));
  } catch (err) {
    throw new Error(`Invalid COSE public key: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!cose.isCOSEPublicKeyEC2(decoded)) {
    throw new Error('Passkey must be an EC2 P-256 (ES256, alg -7) credential for self-custody');
  }
  const crv = decoded.get(cose.COSEKEYS.crv);
  const alg = decoded.get(cose.COSEKEYS.alg);
  if (crv !== cose.COSECRV.P256) {
    throw new Error(`Unsupported EC2 curve (${String(crv)}); only NIST P-256 is supported`);
  }
  if (alg !== undefined && alg !== cose.COSEALG.ES256) {
    throw new Error(`Unsupported COSE algorithm (${String(alg)}); expected ES256 (-7)`);
  }

  const x = decoded.get(cose.COSEKEYS.x);
  const y = decoded.get(cose.COSEKEYS.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error('COSE P-256 public key missing 32-byte x or y coordinate');
  }

  return p256PubkeyXYToNear(concatBytes(x, y));
}

/**
 * Normalizes a 64-byte P-256 (r || s) signature into canonical low-S form
 * (1 <= r < n, 1 <= s <= n/2). Rejects zero or out-of-range scalars.
 */
export function normalizeP256LowS(rawSig64: Uint8Array): Uint8Array {
  if (rawSig64.length !== 64) {
    throw new Error(`Expected 64-byte P-256 signature, got ${rawSig64.length}`);
  }
  const r = bytesToBigIntBE(rawSig64.subarray(0, 32));
  const s = bytesToBigIntBE(rawSig64.subarray(32, 64));

  if (r <= 0n || r >= P256_ORDER) {
    throw new Error('P-256 signature r out of valid range');
  }
  if (s <= 0n || s >= P256_ORDER) {
    throw new Error('P-256 signature s out of valid range');
  }

  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s;
  const out = new Uint8Array(64);
  out.set(bigIntToBytes32BE(r), 0);
  out.set(bigIntToBytes32BE(lowS), 32);
  return out;
}

/**
 * Decodes an ASN.1 DER ECDSA P-256 signature into raw 64-byte low-S (r || s).
 */
export function derSignatureToRawLowS(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error('Expected ASN.1 DER SEQUENCE for P-256 signature');
  }

  let offset = 1;
  const lenByte = der[offset++];
  let seqLen: number;
  if ((lenByte & 0x80) === 0) {
    seqLen = lenByte;
  } else {
    const octets = lenByte & 0x7f;
    if (octets === 0 || octets > 2 || offset + octets > der.length) {
      throw new Error('Malformed DER SEQUENCE length');
    }
    seqLen = 0;
    for (let i = 0; i < octets; i++) {
      seqLen = (seqLen << 8) | der[offset++];
    }
  }
  if (offset + seqLen !== der.length) {
    throw new Error('DER signature length mismatch');
  }

  const readInt = (): Uint8Array => {
    if (offset >= der.length || der[offset++] !== 0x02) {
      throw new Error('Expected DER INTEGER');
    }
    if (offset >= der.length) throw new Error('Truncated DER INTEGER length');
    const intLen = der[offset++];
    if (intLen <= 0 || offset + intLen > der.length) {
      throw new Error('Invalid DER INTEGER length');
    }
    let slice = der.subarray(offset, offset + intLen);
    offset += intLen;
    // Strip at most one leading 0x00 sign-padding byte when MSB would be set.
    if (slice.length > 32 && slice[0] === 0x00) {
      slice = slice.subarray(1);
    }
    if (slice.length > 32) {
      throw new Error('DER INTEGER exceeds 32 bytes for P-256');
    }
    const out = new Uint8Array(32);
    out.set(slice, 32 - slice.length);
    return out;
  };

  const r = readInt();
  const s = readInt();
  if (offset !== der.length) {
    throw new Error('Unexpected trailing bytes in DER signature');
  }

  return normalizeP256LowS(concatBytes(r, s));
}

/**
 * Extracts a normalized low-S 64-byte P-256 signature from DER bytes, raw 64B,
 * base64/base64url string, or `p256:<base58>` string.
 */
export function extractWebAuthnSignatureLowS(sigInput: Uint8Array | string): Uint8Array {
  if (typeof sigInput === 'string') {
    const trimmed = sigInput.trim();
    if (trimmed.startsWith('p256:')) {
      return normalizeP256LowS(base58Decode(trimmed));
    }
    const decoded = base64UrlToBytes(trimmed);
    return decoded.length === 64 ? normalizeP256LowS(decoded) : derSignatureToRawLowS(decoded);
  }
  return sigInput.length === 64 ? normalizeP256LowS(sigInput) : derSignatureToRawLowS(sigInput);
}

/**
 * Computes the WebAuthn challenge string expected by intents.near:
 * unpadded base64url(SHA-256(utf8(payloadStr))).
 */
export async function computeIntentsWebAuthnChallenge(payloadStr: string): Promise<string> {
  const hash = await sha256Utf8(payloadStr);
  return bytesToBase64UrlUnpadded(hash);
}

/**
 * Verifies a `standard: "webauthn"` payload locally against P-256 low-S + WebAuthn
 * rules matching intents.near before spending relay gas.
 */
export async function verifySignedWebAuthnPayloadLocally(
  signed: SignedWebAuthnPayload
): Promise<boolean> {
  if (signed.standard !== 'webauthn') return false;
  if (!signed.payload || !signed.public_key || !signed.signature) return false;
  // intents.near rejects padded base64 in authenticator_data.
  if (signed.authenticator_data.includes('=') || /[+/]/.test(signed.authenticator_data)) {
    return false;
  }

  let pk: { kind: 'p256' | 'ed25519'; bytes: Uint8Array; formatted: string };
  let sigBytes: Uint8Array;
  let authDataBytes: Uint8Array;
  try {
    pk = parseNearPublicKey(signed.public_key);
    if (pk.kind !== 'p256') return false;
    if (!signed.signature.startsWith('p256:')) return false;
    sigBytes = normalizeP256LowS(base58Decode(signed.signature));
    authDataBytes = base64UrlToBytes(signed.authenticator_data);
  } catch {
    return false;
  }

  if (authDataBytes.length < 37) return false;
  // User Present flag (bit 0 of flags byte at offset 32) is required by WebAuthn.
  if ((authDataBytes[32] & 0x01) === 0) return false;

  let clientData: { type?: unknown; challenge?: unknown };
  try {
    clientData = JSON.parse(signed.client_data_json);
  } catch {
    return false;
  }
  if (clientData.type !== 'webauthn.get' || typeof clientData.challenge !== 'string') {
    return false;
  }

  const expectedChallenge = await computeIntentsWebAuthnChallenge(signed.payload);
  if (clientData.challenge !== expectedChallenge) return false;

  const clientDataHash = await sha256Utf8(signed.client_data_json);
  const messageDigest = await sha256(concatBytes(authDataBytes, clientDataHash));

  const uncompressedPk = new Uint8Array(65);
  uncompressedPk[0] = 0x04;
  uncompressedPk.set(pk.bytes, 1);

  return p256.verify(sigBytes, messageDigest, uncompressedPk, {
    prehash: false,
    lowS: true,
  });
}

/**
 * Validates raw browser WebAuthn assertion fields against the prepared Intents
 * payload string, normalizes signature to low-S, ensures unpadded base64url
 * authenticator_data, and checks cryptographic validity before returning a
 * ready-to-relay `SignedWebAuthnPayload`.
 */
export async function assembleSignedWebAuthnPayload(params: {
  payloadStr: string;
  publicKeyNear: string;
  signatureDerOrRaw: string | Uint8Array;
  clientDataJson: string | Uint8Array;
  authenticatorData: string | Uint8Array;
  verifySignature?: boolean;
}): Promise<SignedWebAuthnPayload> {
  const pk = parseNearPublicKey(params.publicKeyNear);
  if (pk.kind !== 'p256') {
    throw new Error('WebAuthn Intents payloads require a p256: public key');
  }

  const sigLowS = extractWebAuthnSignatureLowS(params.signatureDerOrRaw);
  const authDataBytes =
    typeof params.authenticatorData === 'string'
      ? base64UrlToBytes(params.authenticatorData)
      : params.authenticatorData;
  if (authDataBytes.length < 37) {
    throw new Error('Malformed WebAuthn authenticatorData (too short)');
  }

  let clientDataStr: string;
  if (typeof params.clientDataJson === 'string') {
    const trimmed = params.clientDataJson.trim();
    clientDataStr = trimmed.startsWith('{')
      ? params.clientDataJson
      : new TextDecoder().decode(base64UrlToBytes(trimmed));
  } else {
    clientDataStr = new TextDecoder().decode(params.clientDataJson);
  }

  const signed: SignedWebAuthnPayload = {
    standard: 'webauthn',
    payload: params.payloadStr,
    public_key: pk.formatted,
    signature: `p256:${base58Encode(sigLowS)}`,
    client_data_json: clientDataStr,
    authenticator_data: bytesToBase64UrlUnpadded(authDataBytes),
  };

  if (params.verifySignature !== false) {
    const ok = await verifySignedWebAuthnPayloadLocally(signed);
    if (!ok) {
      throw new Error('WebAuthn signature verification failed against prepared intent payload');
    }
  }

  return signed;
}

function borshWriteU32LE(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v >>> 0, true);
  return out;
}

/**
 * Self-contained NEP-413 Borsh serializer matching NEAR Wallet / intents.near.
 */
export function borshSerializeNep413(
  message: string,
  nonceBytes: Uint8Array,
  recipient: string,
  callbackUrl?: string | null
): Uint8Array {
  if (nonceBytes.length !== 32) {
    throw new Error(`NEP-413 nonce must be 32 bytes, got ${nonceBytes.length}`);
  }
  const enc = new TextEncoder();
  const msgBytes = enc.encode(message);
  const recBytes = enc.encode(recipient);
  const parts: Uint8Array[] = [
    borshWriteU32LE(2147484061), // (1 << 31) + 413
    borshWriteU32LE(msgBytes.length),
    msgBytes,
    nonceBytes,
    borshWriteU32LE(recBytes.length),
    recBytes,
  ];
  if (callbackUrl) {
    const cbBytes = enc.encode(callbackUrl);
    parts.push(new Uint8Array([1]), borshWriteU32LE(cbBytes.length), cbBytes);
  } else {
    parts.push(new Uint8Array([0]));
  }
  return concatBytes(...parts);
}

/**
 * Verifies a client-signed `standard: "nep413"` payload signed by a device-reconstructed
 * ed25519 backup key (never receiving the user's recovery phrase on the server).
 */
export async function verifySignedNep413Ed25519Payload(
  signed: SignedNep413Payload,
  expectedPublicKey?: string
): Promise<boolean> {
  if (signed?.standard !== 'nep413' || !signed.payload) return false;
  if (typeof signed.payload.message !== 'string') return false;
  if (typeof signed.payload.nonce !== 'string') return false;
  if (typeof signed.payload.recipient !== 'string') return false;

  let pk: { kind: 'p256' | 'ed25519'; bytes: Uint8Array; formatted: string };
  let nonceBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pk = parseNearPublicKey(signed.public_key);
    if (pk.kind !== 'ed25519') return false;
    if (expectedPublicKey) {
      const exp = parseNearPublicKey(expectedPublicKey);
      if (exp.formatted !== pk.formatted) return false;
    }
    nonceBytes = base64UrlToBytes(signed.payload.nonce);
    if (nonceBytes.length !== 32) return false;
    if (!signed.signature.startsWith('ed25519:')) return false;
    sigBytes = base58Decode(signed.signature);
    if (sigBytes.length !== 64) return false;
  } catch {
    return false;
  }

  const serialized = borshSerializeNep413(
    signed.payload.message,
    nonceBytes,
    signed.payload.recipient,
    signed.payload.callbackUrl
  );
  const digest = await sha256(serialized);
  return ed25519.verify(sigBytes, digest, pk.bytes);
}

/**
 * Builds an ISO UTC deadline string for intents.near payloads.
 */
export function makeIntentDeadlineIso(ttlMs = 15 * 60 * 1000): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

/**
 * Builds an Intents JSON payload string with a versioned nonce salted from
 * intents.near::current_salt() (falling back to random bytes only if caller supplies none).
 */
export function buildIntentsPayloadString(params: {
  signerId: string;
  verifyingContract?: string;
  saltHex: string;
  intents: IntentsAction[];
  ttlMs?: number;
  deadlineIso?: string;
}): { payloadStr: string; body: IntentsPayloadBody } {
  const ttlMs = params.ttlMs ?? 15 * 60 * 1000;
  const deadlineMs = params.deadlineIso ? Date.parse(params.deadlineIso) : Date.now() + ttlMs;
  const deadline = params.deadlineIso ?? new Date(deadlineMs).toISOString();
  const nonce = encodeVersionedNonce(saltFromHex(params.saltHex), new Date(deadlineMs));
  const body: IntentsPayloadBody = {
    signer_id: params.signerId,
    verifying_contract: params.verifyingContract || 'intents.near',
    deadline,
    nonce,
    intents: params.intents,
  };
  return {
    payloadStr: JSON.stringify(body),
    body,
  };
}
