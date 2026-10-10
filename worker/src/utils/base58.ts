/**
 * Base58 (Bitcoin alphabet) encoding used for NEAR keys, post-quantum ML-DSA-65 keys, and block hashes.
 */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEXES = new Int16Array(128).fill(-1);
for (let i = 0; i < B58_ALPHABET.length; i++) {
  B58_INDEXES[B58_ALPHABET.charCodeAt(i)] = i;
}

/**
 * Decodes a base58 string (with optional scheme prefix like "ed25519:" or "ml-dsa-65:").
 * Uses a base-256 byte accumulator for fast O(N) execution that completes in milliseconds
 * even for large 4KB+ post-quantum keys.
 */
export function base58Decode(str: string): Uint8Array {
  const clean = str.trim().replace(/^[a-z0-9_-]+:/i, '');
  if (clean.length === 0) return new Uint8Array(0);

  let zeroes = 0;
  while (zeroes < clean.length && clean[zeroes] === '1') {
    zeroes++;
  }

  // Allocate enough space (log(58)/log(256) ≈ 0.733)
  const size = Math.ceil((clean.length * 733) / 1000) + 1;
  const b256 = new Uint8Array(size);
  let length = 0;

  for (let i = zeroes; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const carry = code < 128 ? B58_INDEXES[code] : -1;
    if (carry === -1) {
      throw new Error(`Invalid base58 character '${clean[i]}'`);
    }

    let c = carry;
    for (let j = 0; j < length; j++) {
      c += b256[j] * 58;
      b256[j] = c & 0xff;
      c >>= 8;
    }
    while (c > 0) {
      b256[length++] = c & 0xff;
      c >>= 8;
    }
  }

  const result = new Uint8Array(zeroes + length);
  for (let i = 0; i < length; i++) {
    result[zeroes + length - 1 - i] = b256[i];
  }
  return result;
}

export function base58Encode(source: Uint8Array): string {
  if (source.length === 0) return '';
  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === 0) zeroes++;

  const size = Math.ceil((source.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeroes; i < source.length; i++) {
    let carry = source[i];
    for (let j = 0; j < length; j++) {
      carry += b58[j] << 8;
      b58[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      b58[length++] = carry % 58;
      carry = Math.floor(carry / 58);
    }
  }

  let str = '1'.repeat(zeroes);
  for (let i = length - 1; i >= 0; i--) {
    str += B58_ALPHABET[b58[i]];
  }
  return str;
}
