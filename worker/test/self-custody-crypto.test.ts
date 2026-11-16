import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import {
  P256_HALF_ORDER,
  P256_ORDER,
  assembleSignedWebAuthnPayload,
  borshSerializeNep413,
  buildIntentsPayloadString,
  bytesToBase64,
  bytesToBase64UrlUnpadded,
  bytesToHex,
  computeIntentsWebAuthnChallenge,
  cosePublicKeyToNearP256,
  derSignatureToRawLowS,
  ed25519PubkeyToNear,
  nearP256ToImplicitAddress,
  normalizeP256LowS,
  verifySignedNep413Ed25519Payload,
  verifySignedWebAuthnPayloadLocally,
} from '../src/services/selfCustodyCrypto';
import { base58Decode, base58Encode } from '../src/utils/base58';
import { VERSIONED_NONCE_MAGIC } from '../src/services/intentsNonce';

// Minimal deterministic CBOR encoder for test COSE keys.
function cborInt(n: number): Uint8Array {
  if (n >= 0 && n <= 23) return Uint8Array.of(n);
  if (n < 0 && n >= -24) return Uint8Array.of(0x20 | (-1 - n));
  throw new Error(`Unsupported test CBOR int ${n}`);
}
function cborBytes(buf: Uint8Array): Uint8Array {
  if (buf.length < 24) return Uint8Array.of(0x40 | buf.length, ...buf);
  if (buf.length < 256) return Uint8Array.of(0x58, buf.length, ...buf);
  throw new Error('Too long for tiny test CBOR encoder');
}
function encodeTestCoseP256(x: Uint8Array, y: Uint8Array, overrides?: { crv?: number; kty?: number; alg?: number }): string {
  const kty = overrides?.kty ?? 2; // EC2
  const alg = overrides?.alg ?? -7; // ES256
  const crv = overrides?.crv ?? 1; // P-256
  const parts: Uint8Array[] = [
    Uint8Array.of(0xa5), // map(5)
    cborInt(1), cborInt(kty),
    cborInt(3), cborInt(alg),
    cborInt(-1), cborInt(crv),
    cborInt(-2), cborBytes(x),
    cborInt(-3), cborBytes(y),
  ];
  const total = parts.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return bytesToHex(out);
}

function rawSigToDer(raw64: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let trimmed = bytes.subarray(i);
    if (trimmed[0] & 0x80) {
      trimmed = Uint8Array.of(0x00, ...trimmed);
    }
    return Uint8Array.of(0x02, trimmed.length, ...trimmed);
  };
  const r = encodeInt(raw64.subarray(0, 32));
  const s = encodeInt(raw64.subarray(32, 64));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

describe('selfCustodyCrypto', () => {
  it('verifies official near/intents webauthn.rs vector and implicit address', async () => {
    const vector = {
      standard: 'webauthn' as const,
      payload:
        '{"signer_id":"0x3602b546589a8fcafdce7fad64a46f91db0e4d50","verifying_contract":"defuse.test.near","deadline":"2025-03-30T00:00:00Z","nonce":"A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=","intents":[{"intent":"transfer","receiver_id":"user1.test.near","tokens":{"nep141:ft1.poa-factory.test.near":"1000"}}]}',
      public_key:
        'p256:2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q',
      signature:
        'p256:3KBMZ72BHUiVfE1ey5dpi3KgbXvSEf9kuxgBEax7qLBQtidZExxxjjQk1hTTGFRrPvUoEStfrjoFNVVW4Abar94W',
      client_data_json:
        '{"type":"webauthn.get","challenge":"4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk","origin":"https://defuse-widget-git-feat-passkeys-defuse-94bbc1b2.vercel.app"}',
      // Convert vector padded base64 into unpadded base64url (as intents.near expects)
      authenticator_data: '933cQogpBzE3RSAYSAkfWoNEcBd3X84PxE8iRrRVxMgdAAAAAA',
    };

    assert.equal(
      await computeIntentsWebAuthnChallenge(vector.payload),
      '4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk'
    );
    assert.equal(
      nearP256ToImplicitAddress(vector.public_key),
      '0x3602b546589a8fcafdce7fad64a46f91db0e4d50'
    );
    assert.equal(await verifySignedWebAuthnPayloadLocally(vector), true);

    // Padded base64 in authenticator_data MUST be rejected locally too
    const padded = { ...vector, authenticator_data: '933cQogpBzE3RSAYSAkfWoNEcBd3X84PxE8iRrRVxMgdAAAAAA==' };
    assert.equal(await verifySignedWebAuthnPayloadLocally(padded), false);
  });

  it('converts COSE P-256 key to p256:<base58> and rejects non-P256 keys', () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const x = Uint8Array.from(Buffer.from(jwk.x, 'base64url'));
    const y = Uint8Array.from(Buffer.from(jwk.y, 'base64url'));
    const coseHex = encodeTestCoseP256(x, y);

    const nearPk = cosePublicKeyToNearP256(coseHex);
    assert.ok(nearPk.startsWith('p256:'));
    const decoded64 = base58Decode(nearPk);
    assert.equal(decoded64.length, 64);
    assert.deepEqual(decoded64.subarray(0, 32), x);
    assert.deepEqual(decoded64.subarray(32, 64), y);

    assert.throws(() => cosePublicKeyToNearP256(encodeTestCoseP256(x, y, { crv: 2 })), /P-256/);
    assert.throws(() => cosePublicKeyToNearP256(encodeTestCoseP256(x, y, { kty: 1 })), /EC2 P-256/);
    assert.throws(() => cosePublicKeyToNearP256(encodeTestCoseP256(x, y, { alg: -8 })), /ES256/);

    // Point not on P-256 curve (x=0, y=0) must fail curve validity
    assert.throws(
      () => cosePublicKeyToNearP256(encodeTestCoseP256(new Uint8Array(32), new Uint8Array(32))),
      /invalid|point/i
    );
  });

  it('normalizes synthetic and live high-S DER signatures to valid low-S WebAuthn payloads', async () => {
    // 1. Deterministic high-S scalar flip check: s = P256_ORDER - 9n => low-S = 9n
    const highSig = new Uint8Array(64);
    highSig[31] = 42; // r = 42
    let sVal = P256_ORDER - 9n;
    for (let i = 63; i >= 32; i--) {
      highSig[i] = Number(sVal & 0xffn);
      sVal >>= 8n;
    }
    const norm = normalizeP256LowS(highSig);
    let outS = 0n;
    for (let i = 32; i < 64; i++) outS = (outS << 8n) | BigInt(norm[i]);
    assert.equal(outS, 9n);
    assert.ok(outS <= P256_HALF_ORDER);

    const derNorm = derSignatureToRawLowS(rawSigToDer(highSig));
    assert.deepEqual(derNorm, norm);

    // 2. Real P-256 WebAuthn sign loop until we observe both a naturally high-S and low-S DER signature
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const coseHex = encodeTestCoseP256(
      Uint8Array.from(Buffer.from(jwk.x, 'base64url')),
      Uint8Array.from(Buffer.from(jwk.y, 'base64url'))
    );
    const nearPk = cosePublicKeyToNearP256(coseHex);

    const { payloadStr } = buildIntentsPayloadString({
      signerId: 'u_testuser.escrow.uprail.near',
      saltHex: '252812b3',
      intents: [{ intent: 'add_public_key', public_key: nearPk }],
    });
    const challenge = await computeIntentsWebAuthnChallenge(payloadStr);
    const clientDataJson = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'https://app.uprail.world',
    });
    const rpHash = crypto.createHash('sha256').update('uprail.world').digest();
    const authData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.alloc(4)]);
    const signedBytes = Buffer.concat([
      authData,
      crypto.createHash('sha256').update(clientDataJson).digest(),
    ]);

    let observedHighS = false;
    for (let attempt = 0; attempt < 32; attempt++) {
      const der = Uint8Array.from(crypto.sign('sha256', signedBytes, privateKey));
      // Peek raw s from DER before normalization
      const rLen = der[3];
      const sOff = 4 + rLen;
      const sLen = der[sOff + 1];
      let sSlice = der.subarray(sOff + 2, sOff + 2 + sLen);
      if (sSlice.length > 32 && sSlice[0] === 0) sSlice = sSlice.subarray(1);
      let rawS = 0n;
      for (const b of sSlice) rawS = (rawS << 8n) | BigInt(b);
      if (rawS > P256_HALF_ORDER) observedHighS = true;

      const assembled = await assembleSignedWebAuthnPayload({
        payloadStr,
        publicKeyNear: nearPk,
        signatureDerOrRaw: der,
        clientDataJson,
        authenticatorData: bytesToBase64(authData), // even if caller passes padded base64, output must be unpadded base64url!
      });
      assert.equal(assembled.authenticator_data.includes('='), false);
      assert.equal(assembled.authenticator_data, bytesToBase64UrlUnpadded(authData));
      assert.equal(await verifySignedWebAuthnPayloadLocally(assembled), true);

      // Verify low-S encoded signature directly with @noble/curves lowS: true
      const raw64 = base58Decode(assembled.signature);
      const pk65 = Uint8Array.of(0x04, ...base58Decode(nearPk));
      const digest = crypto.createHash('sha256').update(signedBytes).digest();
      assert.equal(p256.verify(raw64, digest, pk65, { prehash: false, lowS: true }), true);
      if (observedHighS) break;
    }
    assert.equal(observedHighS, true, 'expected to encounter and normalize a high-S signature within 32 trials');
  });

  it('rejects malformed or tampered WebAuthn payloads', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const nearPk = cosePublicKeyToNearP256(
      encodeTestCoseP256(
        Uint8Array.from(Buffer.from(jwk.x, 'base64url')),
        Uint8Array.from(Buffer.from(jwk.y, 'base64url'))
      )
    );
    const { payloadStr } = buildIntentsPayloadString({
      signerId: 'u_testuser.escrow.uprail.near',
      saltHex: '252812b3',
      intents: [],
    });
    const challenge = await computeIntentsWebAuthnChallenge(payloadStr);
    const clientDataJson = JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://app.uprail.world' });
    const authData = Buffer.concat([Buffer.alloc(32), Buffer.from([0x01]), Buffer.alloc(4)]);
    const signedBytes = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJson).digest()]);
    const der = Uint8Array.from(crypto.sign('sha256', signedBytes, privateKey));

    await assert.rejects(
      assembleSignedWebAuthnPayload({
        payloadStr: payloadStr.replace('u_testuser', 'u_attacker'),
        publicKeyNear: nearPk,
        signatureDerOrRaw: der,
        clientDataJson,
        authenticatorData: authData,
      }),
      /verification failed/
    );
  });

  it('builds versioned Intents nonces and verifies ed25519 NEP-413 backup key recovery payloads', async () => {
    const priv = new Uint8Array(32).fill(7);
    const pub = ed25519.getPublicKey(priv);
    const backupPubNear = ed25519PubkeyToNear(pub);

    const { payloadStr, body } = buildIntentsPayloadString({
      signerId: 'u_alice.escrow.uprail.near',
      saltHex: '252812b3',
      intents: [{ intent: 'add_public_key', public_key: backupPubNear }],
    });

    const nonceBytes = Uint8Array.from(Buffer.from(body.nonce, 'base64'));
    assert.equal(nonceBytes.length, 32);
    assert.deepEqual(Array.from(nonceBytes.subarray(0, 4)), Array.from(VERSIONED_NONCE_MAGIC));
    assert.equal(nonceBytes[4], 0);
    assert.deepEqual(Array.from(nonceBytes.subarray(5, 9)), [0x25, 0x28, 0x12, 0xb3]);

    const serialized = borshSerializeNep413(payloadStr, nonceBytes, 'intents.near');
    const digest = Uint8Array.from(crypto.createHash('sha256').update(serialized).digest());
    const sig = ed25519.sign(digest, priv);

    const signed = {
      standard: 'nep413' as const,
      payload: {
        message: payloadStr,
        nonce: bytesToBase64(nonceBytes),
        recipient: 'intents.near',
      },
      public_key: backupPubNear,
      signature: `ed25519:${base58Encode(sig)}`,
    };

    assert.equal(await verifySignedNep413Ed25519Payload(signed, backupPubNear), true);
    assert.equal(
      await verifySignedNep413Ed25519Payload({ ...signed, signature: `ed25519:${base58Encode(new Uint8Array(64))}` }, backupPubNear),
      false
    );
  });

  it('frontend generateDeviceRecoveryKey + HKDF Ed25519 NEP-413 signature interoperates with backend verifier and isolates accounts', async () => {
    const fe = await import('../../frontend/src/lib/selfCustody');
    const phrase = await fe.generateDeviceRecoveryKey();
    assert.match(phrase, /^UP1-/);

    const aliceAcct = 'u_alice.escrow.uprail.near';
    const bobAcct = 'u_bob.escrow.uprail.near';
    const aliceKeys = await fe.deriveBackupEd25519Keypair(phrase, aliceAcct);
    const bobKeys = await fe.deriveBackupEd25519Keypair(phrase, bobAcct);
    assert.match(aliceKeys.nearPublicKey, /^ed25519:/);
    assert.notEqual(
      aliceKeys.nearPublicKey,
      bobKeys.nearPublicKey,
      'HKDF domain separation must yield distinct keys for different accounts even from the same phrase'
    );

    const { payloadStr, body } = buildIntentsPayloadString({
      signerId: aliceAcct,
      saltHex: '252812b3',
      intents: [{ intent: 'add_public_key', public_key: 'p256:11111111111111111111111111111111111111111111' }],
    });

    const signed = await fe.signNep413RecoveryPayload({
      phrase,
      nearAccount: aliceAcct,
      payload: {
        message: payloadStr,
        nonce: body.nonce,
        recipient: 'intents.near',
      },
    });

    assert.equal(await verifySignedNep413Ed25519Payload(signed, aliceKeys.nearPublicKey), true);
    assert.equal(await verifySignedNep413Ed25519Payload(signed, bobKeys.nearPublicKey), false);
    const tampered = {
      ...signed,
      payload: { ...signed.payload, message: payloadStr.replace('alice', 'mallory') },
    };
    assert.equal(await verifySignedNep413Ed25519Payload(tampered, aliceKeys.nearPublicKey), false);
  });
});
