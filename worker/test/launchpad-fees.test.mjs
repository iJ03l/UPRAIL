import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHandle,
  fromAtomic,
  contractFromToken,
  splitProtocolFee,
  deriveHandleFromDescription,
  protocolFeePercent,
  minFeeUsd,
  isSharedPoolContract,
  inferLaunchpadFromContract,
  getAccountedEscrowAtomic,
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

describe('protocol fee split', () => {
  it('carves 5% with integer math and never loses wei', () => {
    const { netAtomic, feeAtomic } = splitProtocolFee(1000000n, 0.05);
    assert.equal(feeAtomic, 50000n);
    assert.equal(netAtomic, 950000n);
    assert.equal(netAtomic + feeAtomic, 1000000n);
  });

  it('floors the fee and leaves the remainder in the net', () => {
    const { netAtomic, feeAtomic } = splitProtocolFee(3n, 0.05);
    assert.equal(feeAtomic, 0n);
    assert.equal(netAtomic, 3n);
  });

  it('is a no-op at 0% and for non-positive amounts', () => {
    assert.deepEqual(splitProtocolFee(12345n, 0), { netAtomic: 12345n, feeAtomic: 0n });
    assert.deepEqual(splitProtocolFee(0n, 0.05), { netAtomic: 0n, feeAtomic: 0n });
  });

  it('reads FEE_PERCENT with a 5% fallback', () => {
    assert.equal(protocolFeePercent({}), 0.05);
    assert.equal(protocolFeePercent({ FEE_PERCENT: '0.05' }), 0.05);
    assert.equal(protocolFeePercent({ FEE_PERCENT: '0' }), 0);
    assert.equal(protocolFeePercent({ FEE_PERCENT: 'nonsense' }), 0.05);
    assert.equal(protocolFeePercent({ FEE_PERCENT: '1' }), 0.05);
  });
});

describe('creator-fee recipient from token description', () => {
  it('reads the canonical line', () => {
    assert.equal(deriveHandleFromDescription('Fees to @elonmusk via UPRAIL'), 'elonmusk');
    assert.equal(deriveHandleFromDescription('Fees to elonmusk via uprail'), 'elonmusk');
    assert.equal(
      deriveHandleFromDescription('A token. Fees to @creator via UPRAIL. DYOR.'),
      'creator'
    );
  });

  it('falls back to the first @handle', () => {
    assert.equal(deriveHandleFromDescription('launched for @alice, enjoy'), 'alice');
  });

  it('returns null when there is no handle', () => {
    for (const bad of ['', 'no handles here', null, undefined, 42]) {
      assert.equal(deriveHandleFromDescription(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

describe('creator-fee dust threshold', () => {
  it('defaults to $1 and honours an override', () => {
    assert.equal(minFeeUsd({}), 1);
    assert.equal(minFeeUsd({ MIN_FEE_USD: '0.5' }), 0.5);
    assert.equal(minFeeUsd({ MIN_FEE_USD: '0' }), 0);
    assert.equal(minFeeUsd({ MIN_FEE_USD: 'nope' }), 1);
  });
});

describe('automatic RPC balance-delta helpers', () => {
  it('excludes shared pooled contracts from single-creator delta routing', () => {
    assert.equal(isSharedPoolContract('wrap.near'), true);
    assert.equal(isSharedPoolContract('usdt.tether-token.near'), true);
    assert.equal(isSharedPoolContract('sol.omft.near'), true);
    assert.equal(isSharedPoolContract('uptober.nearlytrade.near'), false);
    assert.equal(isSharedPoolContract('hoot.launchpad.justhoot.near'), false);
  });

  it('infers launchpad name from token contract', () => {
    assert.equal(inferLaunchpadFromContract('uptober.nearlytrade.near'), 'nearly');
    assert.equal(inferLaunchpadFromContract('owl.launchpad.justhoot.near'), 'justhoot');
    assert.equal(inferLaunchpadFromContract('cat.meme-cooking.near'), 'meme-cooking');
    assert.equal(inferLaunchpadFromContract('custom.token.near'), 'direct');
  });

  it('computes accounted escrow atomic units across ESCROWED and CLAIMED rows', async () => {
    const rows = [
      // Escrowed 100 gross -> 95 net + 5 fee (all 100 still in escrow)
      {
        amount: '95',
        fee: '5',
        fee_recipient: 'escrow.uprail.near',
        status: 'ESCROWED',
        claim_tx_hash: null,
        origin: 'launchpad:nearly',
      },
      // Claimed 200 gross with real onchain tx -> 190 net left escrow, 10 fee stayed in escrow
      {
        amount: '190',
        fee: '10',
        fee_recipient: 'escrow.uprail.near',
        status: 'CLAIMED',
        claim_tx_hash: '8fG7kL9pQ2rT4vW6xY8zA1bC3dE5fG7hJ9kL2mN4pQ6r',
        origin: 'launchpad:nearly',
      },
    ];
    const mockEnv = {
      ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: rows }),
          }),
        }),
      },
    };
    const accounted = await getAccountedEscrowAtomic(
      mockEnv,
      'uptober.nearlytrade.near',
      'nep141:uptober.nearlytrade.near',
      6
    );
    // 95 + 5 + 10 = 110 tokens = 110_000_000 atomic units
    assert.equal(accounted, 110000000n);
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

