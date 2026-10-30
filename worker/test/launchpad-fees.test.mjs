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
  creatorFeesEnabled,
} from '../dist/launchpadFees.bundle.mjs';
/**
 * The launchpad fee rail is zero-integration: tokens point creator fees at
 * escrow and UPRAIL detects them over RPC. A regression in handle parsing,
 * amount conversion, or escrow accounting either lets a caller mint fees or
 * silently drops real ones, so those paths are pinned.
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

  it('reads only the canonical adapter memo as a payout handle', async () => {
    const { deriveHandleFromMemo, uprailFeeMemo } = await import('../dist/launchpadFees.bundle.mjs');
    assert.equal(deriveHandleFromMemo('Fees to @alice via UPRAIL'), 'alice');
    assert.equal(deriveHandleFromMemo('{"purpose":"fee_split","role":"token_owner"}'), null);
    assert.equal(deriveHandleFromMemo('paid @alice somehow'), null);
    assert.equal(uprailFeeMemo('@Alice'), 'Fees to @alice via UPRAIL');
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
    assert.equal(inferLaunchpadFromContract('tear.launch.intear.near'), 'intear');
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

describe('creator-fee auto-routing kill switch', () => {
  it('is off by default and only enabled explicitly', () => {
    assert.equal(creatorFeesEnabled({}), false);
    assert.equal(creatorFeesEnabled({ CREATOR_FEES_ENABLED: 'false' }), false);
    assert.equal(creatorFeesEnabled({ CREATOR_FEES_ENABLED: 'true' }), true);
    assert.equal(creatorFeesEnabled({ CREATOR_FEES_ENABLED: '1' }), true);
  });
});
