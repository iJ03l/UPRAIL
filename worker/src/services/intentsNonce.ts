/**
 * Versioned expirable nonces for NEAR Intents.
 *
 * The verifier rejects random 32-byte nonces. A valid nonce is:
 *   magic[4] || version[1] || salt[4] || deadline_u64_le[8] || random[15]
 * and is carried in intent payloads as base64.
 *
 * The first 8 random bytes carry the creation time in nanoseconds so the
 * server can enforce its 5-minute clock-skew check.
 */

export const VERSIONED_NONCE_MAGIC = new Uint8Array([86, 40, 246, 198]);
export const VERSIONED_NONCE_VERSION = 0;
export const VERSIONED_NONCE_BYTES = 32;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function saltFromHex(hex: string): Uint8Array {
  const clean = (hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{8}$/.test(clean)) {
    throw new Error('Intents salt must be exactly 4 bytes (8 hex characters)');
  }
  const salt = new Uint8Array(4);
  for (let i = 0; i < 4; i++) salt[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return salt;
}

/**
 * Writes the current time (nanoseconds, little-endian) into the first 8 bytes
 * and fills the remaining 7 bytes with CSPRNG output.
 */
export function createTimestampedNonceBytes(now: Date = new Date()): Uint8Array {
  const bytes = new Uint8Array(15);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(now.getTime()) * 1000000n, true);
  crypto.getRandomValues(bytes.subarray(8));
  return bytes;
}

export function encodeVersionedNonce(
  salt: Uint8Array,
  deadline: Date,
  randomBytes: Uint8Array = createTimestampedNonceBytes()
): string {
  if (salt.length !== 4) throw new Error(`Invalid salt length: ${salt.length}, expected 4`);
  if (randomBytes.length !== 15) {
    throw new Error(`Invalid nonce random bytes: ${randomBytes.length}, expected 15`);
  }
  const deadlineMs = deadline.getTime();
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error('Invalid nonce deadline');
  }

  const borsh = new Uint8Array(27);
  borsh.set(salt, 0);
  new DataView(borsh.buffer).setBigUint64(4, BigInt(deadlineMs) * 1000000n, true);
  borsh.set(randomBytes, 12);

  const result = new Uint8Array(5 + borsh.length);
  result.set(VERSIONED_NONCE_MAGIC, 0);
  result[4] = VERSIONED_NONCE_VERSION;
  result.set(borsh, 5);
  return bytesToBase64(result);
}

export interface DecodedVersionedNonce {
  version: number;
  salt: Uint8Array;
  deadline: Date;
  randomBytes: Uint8Array;
}

export function decodeVersionedNonce(encoded: string): DecodedVersionedNonce {
  const bytes = base64ToBytes(encoded);
  if (bytes.length !== VERSIONED_NONCE_BYTES) {
    throw new Error(`Invalid nonce length: ${bytes.length}, expected ${VERSIONED_NONCE_BYTES}`);
  }
  for (let i = 0; i < VERSIONED_NONCE_MAGIC.length; i++) {
    if (bytes[i] !== VERSIONED_NONCE_MAGIC[i]) throw new Error('Invalid versioned nonce magic');
  }
  const deadlineNs = new DataView(bytes.buffer, bytes.byteOffset + 9, 8).getBigUint64(0, true);
  return {
    version: bytes[4],
    salt: bytes.slice(5, 9),
    deadline: new Date(Number(deadlineNs / 1_000_000n)),
    randomBytes: bytes.slice(17, 32),
  };
}
