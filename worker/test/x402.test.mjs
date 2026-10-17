import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64Encode,
  base64Decode,
  encodePaymentRequired,
  decodePaymentPayload,
  encodeSettlement,
  assetDecimals,
  toAtomic,
  X402_VERSION,
  NEAR_MAINNET,
} from '../dist/x402.bundle.mjs';

/**
 * The x402 wire helpers are the contract between UPRAIL and any paying client.
 * A broken base64/amount conversion silently makes every challenge unpayable,
 * so these are pinned explicitly.
 */
describe('x402 base64', () => {
  it('round-trips ascii and multi-byte text', () => {
    for (const s of ['hello', '{"a":1}', 'price: 0.01 USDC', 'NEAR 🔒 mainnet', 'ünïcödé']) {
      assert.equal(base64Decode(base64Encode(s)), s);
    }
  });

  it('produces standard base64', () => {
    assert.equal(base64Encode('hello'), 'aGVsbG8=');
    assert.equal(base64Decode('aGVsbG8='), 'hello');
  });
});

describe('x402 payment required', () => {
  const requirement = {
    x402Version: X402_VERSION,
    resource: { url: 'https://api.uprail.world/api/x402/demo' },
    accepts: [
      {
        scheme: 'exact',
        network: NEAR_MAINNET,
        amount: '10000',
        asset: 'USDC',
        payTo: 'deposit-addr-123',
        maxTimeoutSeconds: 900,
      },
    ],
  };

  it('encodes to a header payload that decodes back to the object', () => {
    const header = encodePaymentRequired(requirement);
    assert.equal(typeof header, 'string');
    assert.deepEqual(JSON.parse(base64Decode(header)), requirement);
  });
});

describe('x402 payment payload decoding', () => {
  it('decodes a base64 payload', () => {
    const payload = {
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: NEAR_MAINNET,
      payload: { depositAddress: 'dep-1' },
    };
    const decoded = decodePaymentPayload(base64Encode(JSON.stringify(payload)));
    assert.deepEqual(decoded, payload);
  });

  it('returns null for empty or malformed input', () => {
    assert.equal(decodePaymentPayload(''), null);
    assert.equal(decodePaymentPayload(undefined), null);
    assert.equal(decodePaymentPayload('not-base64!!'), null);
    assert.equal(decodePaymentPayload(base64Encode('not json')), null);
  });
});

describe('x402 settlement encoding', () => {
  it('encodes a settlement response', () => {
    const settlement = { success: true, transaction: '0xabc', network: NEAR_MAINNET };
    assert.deepEqual(JSON.parse(base64Decode(encodeSettlement(settlement))), settlement);
  });
});

describe('asset decimals', () => {
  it('knows common symbols', () => {
    assert.equal(assetDecimals('USDC'), 6);
    assert.equal(assetDecimals('usdt'), 6);
    assert.equal(assetDecimals('NEAR'), 24);
    assert.equal(assetDecimals('WNEAR'), 24);
    assert.equal(assetDecimals('ETH'), 18);
    assert.equal(assetDecimals('BTC'), 8);
    assert.equal(assetDecimals('RHEA'), 18);
  });

  it('infers from a nep141 contract id', () => {
    assert.equal(assetDecimals('nep141:wrap.near'), 24);
    assert.equal(assetDecimals('nep141:usdc.token.near'), 6);
  });

  it('does not treat every .near contract as NEAR', () => {
    // The ".near" parent domain must not make an arbitrary token look like NEAR.
    assert.equal(assetDecimals('nep141:uptober.nearlytrade.near'), 6);
    assert.equal(assetDecimals('nep141:usdt.tether-token.near'), 6);
  });

  it('defaults to 6 for unknown assets', () => {
    assert.equal(assetDecimals('mysterycoin'), 6);
    assert.equal(assetDecimals(''), 6);
  });
});

describe('toAtomic', () => {
  it('scales whole and fractional amounts', () => {
    assert.equal(toAtomic('1', 6), '1000000');
    assert.equal(toAtomic('1.5', 6), '1500000');
    assert.equal(toAtomic('0.01', 6), '10000');
    assert.equal(toAtomic('0.000001', 6), '1');
    assert.equal(toAtomic('1', 24), '1' + '0'.repeat(24));
  });

  it('truncates precision beyond the asset decimals', () => {
    assert.equal(toAtomic('0.1234567', 6), '123456');
  });

  it('handles zero and padding', () => {
    assert.equal(toAtomic('0', 6), '0');
    assert.equal(toAtomic('0.0', 6), '0');
    assert.equal(toAtomic('0.1', 6), '100000');
  });
});
