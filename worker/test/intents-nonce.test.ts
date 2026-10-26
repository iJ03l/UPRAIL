import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSIONED_NONCE_MAGIC,
  base64ToBytes,
  createTimestampedNonceBytes,
  decodeVersionedNonce,
  encodeVersionedNonce,
  saltFromHex,
} from '../src/services/intentsNonce';

describe('versioned Intents nonce', () => {
  it('encodes the 32-byte magic/version/salt/deadline/random layout', () => {
    const salt = saltFromHex('e110f317');
    const deadline = new Date('2026-09-30T09:00:00.000Z');
    const random = new Uint8Array(15);
    for (let i = 0; i < random.length; i++) random[i] = i + 1;

    const encoded = encodeVersionedNonce(salt, deadline, random);
    const bytes = base64ToBytes(encoded);
    assert.equal(bytes.length, 32);
    assert.deepEqual(Array.from(bytes.slice(0, 4)), Array.from(VERSIONED_NONCE_MAGIC));
    assert.equal(bytes[4], 0);
    assert.deepEqual(Array.from(bytes.slice(5, 9)), [0xe1, 0x10, 0xf3, 0x17]);

    const decoded = decodeVersionedNonce(encoded);
    assert.equal(decoded.deadline.toISOString(), deadline.toISOString());
    assert.deepEqual(Array.from(decoded.salt), [0xe1, 0x10, 0xf3, 0x17]);
    assert.deepEqual(Array.from(decoded.randomBytes), Array.from(random));
  });

  it('writes the creation time into the first 8 random bytes', () => {
    const now = new Date('2026-01-02T03:04:05.006Z');
    const bytes = createTimestampedNonceBytes(now);
    const nanos = new DataView(bytes.buffer).getBigInt64(0, true);
    assert.equal(nanos, BigInt(now.getTime()) * 1_000_000n);
  });

  it('rejects a salt that is not exactly four bytes', () => {
    assert.throws(() => saltFromHex('abcd'), /4 bytes/);
    assert.throws(() => saltFromHex('zzzzzzzz'), /4 bytes/);
  });

  it('rejects malformed nonces', () => {
    assert.throws(() => decodeVersionedNonce('AAAA'), /Invalid nonce length/);
  });
});
