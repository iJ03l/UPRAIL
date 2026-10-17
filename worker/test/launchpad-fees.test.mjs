import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHandle,
  fromAtomic,
  contractFromToken,
} from '../dist/launchpadFees.bundle.mjs';
import {
  generatePartnerKey,
  hashPartnerKey,
  looksLikePartnerKey,
  buildWebhookSignature,
  verifyWebhookSignature,
} from '../dist/launchpadKeys.bundle.mjs';

/**
 * The launchpad fee rail trusts a partner's webhook only after (a) a bearer key
 * lookup and (b) an HMAC signature over the raw body. A regression here either
 * lets an unauthenticated caller mint fees or silently drops real ones, so the
 * handle parsing, amount conversion, and signature checks are pinned.
 */
describe('launchpad handle normalization', () => {
  it('strips @, trims, and lowercases', () => {
    assert.equal(normalizeHandle('@Creator'), 'creator');
    assert.equal(normalizeHandle('  @UP_RAIL '), 'up_rail');
    assert.equal(normalizeHandle('alice'), 'alice');
  });

  it('rejects non-handles', () => {
    for (const bad of ['', '@', 'has space', 'toolonghandlexyz123', 'a-b', 'a.b', 42, null, undefined]) {
      assert.equal(normalizeHandle(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

describe('launchpad token contract parsing', () => {
  it('accepts nep141: prefixed and bare contract ids', () => {
    assert.equal(contractFromToken('nep141:uptober.nearlytrade.near'), 'uptober.nearlytrade.near');
    assert.equal(contractFromToken('Uptober.NearlyTrade.NEAR'), 'uptober.nearlytrade.near');
  });

  it('rejects junk', () => {
    for (const bad of ['', 'x', 'has space', 'a!b', 123, null]) {
      assert.equal(contractFromToken(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

describe('atomic → decimal conversion', () => {
  it('renders exact decimals without exponent', () => {
    assert.equal(fromAtomic('1000000', 6), '1');
    assert.equal(fromAtomic('1500000', 6), '1.5');
    assert.equal(fromAtomic('1', 6), '0.000001');
    assert.equal(fromAtomic('123456789', 6), '123.456789');
    assert.equal(fromAtomic('1' + '0'.repeat(24), 24), '1');
  });

  it('handles zero and odd input', () => {
    assert.equal(fromAtomic('0', 6), '0');
    assert.equal(fromAtomic('', 6), '0');
    assert.equal(fromAtomic('not-a-number', 6), '0');
  });
});

describe('partner key generation', () => {
  it('mints self-identifying keys and hashes deterministically', async () => {
    const key = await generatePartnerKey();
    assert.ok(looksLikePartnerKey(key.plaintext));
    assert.ok(key.plaintext.startsWith('up_lp_'));
    assert.equal(key.prefix, key.plaintext.slice(0, 'up_lp_'.length + 6));
    assert.equal(await hashPartnerKey(key.plaintext), key.hash);
    assert.equal(looksLikePartnerKey('up_agent_abc'), false);
  });
});

describe('webhook signature verification', () => {
  const secret = 'a'.repeat(64);
  const body = JSON.stringify({ event: 'fee.paid', eventId: 'e1' });

  it('accepts a signature it produced', async () => {
    const header = await buildWebhookSignature(secret, body);
    assert.equal(await verifyWebhookSignature(secret, header, body), true);
  });

  it('rejects a wrong secret', async () => {
    const header = await buildWebhookSignature(secret, body);
    assert.equal(await verifyWebhookSignature('b'.repeat(64), header, body), false);
  });

  it('rejects a tampered body', async () => {
    const header = await buildWebhookSignature(secret, body);
    assert.equal(await verifyWebhookSignature(secret, header, body + ' '), false);
  });

  it('rejects a stale timestamp (replay)', async () => {
    const old = Date.now() - 10 * 60 * 1000;
    const header = await buildWebhookSignature(secret, body, old);
    assert.equal(await verifyWebhookSignature(secret, header, body, Date.now()), false);
  });

  it('rejects malformed or missing headers', async () => {
    assert.equal(await verifyWebhookSignature(secret, undefined, body), false);
    assert.equal(await verifyWebhookSignature(secret, 'garbage', body), false);
    assert.equal(await verifyWebhookSignature(secret, 't=abc,v1=zz', body), false);
    assert.equal(await verifyWebhookSignature('', 't=1,v1=x', body), false);
  });
});
