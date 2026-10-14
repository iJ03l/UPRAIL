import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assetsMatch } from '../dist/nearRpc.bundle.mjs';

/**
 * `assetsMatch` decides whether two asset strings denote the same token. It
 * feeds getUserAvailableBalance(), getVirtualBalanceDeltas() and the balance
 * merge in /api/onchain/balances, so a false positive does not merely
 * mislabel a row: it moves one token's value into another's and makes it
 * spendable under the wrong asset.
 */
describe('assetsMatch', () => {
  it('does not treat every .near account as NEAR', () => {
    // Regression: the alias lists used `id.includes('near')`, and "near" is a
    // substring of every ".near" account id. UPTOBER, USDT and ETH therefore
    // matched NEAR, so a meme send rendered — and withdrew — as NEAR.
    assert.equal(assetsMatch('nep141:uptober.nearlytrade.near', 'nep141:wrap.near'), false);
    assert.equal(assetsMatch('nep141:wrap.near', 'nep141:uptober.nearlytrade.near'), false);
    assert.equal(assetsMatch('nep141:uptober.nearlytrade.near', 'NEAR'), false);
    assert.equal(assetsMatch('NEAR', 'nep141:uptober.nearlytrade.near'), false);
    assert.equal(assetsMatch('UPTOBER', 'nep141:wrap.near'), false);
  });

  it('does not treat USDT or ETH as NEAR', () => {
    assert.equal(assetsMatch('nep141:usdt.tether-token.near', 'nep141:wrap.near'), false);
    assert.equal(assetsMatch('nep141:eth.bridge.near', 'nep141:wrap.near'), false);
    assert.equal(assetsMatch('nep141:eth.bridge.near', 'nep141:usdt.tether-token.near'), false);
  });

  it('keeps the legitimate aliases', () => {
    assert.equal(assetsMatch('NEAR', 'nep141:wrap.near'), true);
    assert.equal(assetsMatch('nep141:wrap.near', 'wnear'), true);
    assert.equal(assetsMatch('native:near', 'nep141:wrap.near'), true);
    assert.equal(assetsMatch('USDC', 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'), true);
    assert.equal(assetsMatch('usdc', 'nep141:usdc.token.near'), true);
    assert.equal(assetsMatch('USDT', 'nep141:usdt.tether-token.near'), true);
    assert.equal(assetsMatch('ETH', 'nep141:eth.bridge.near'), true);
    assert.equal(assetsMatch('BTC', 'nep141:btc.omft.near'), true);
  });

  it('matches exact ids and the unprefixed contract id', () => {
    assert.equal(assetsMatch('nep141:wrap.near', 'nep141:wrap.near'), true);
    assert.equal(assetsMatch('nep141:uptober.nearlytrade.near', 'uptober.nearlytrade.near'), true);
    assert.equal(assetsMatch('nep141:uptober.nearlytrade.near', 'nep141:uptober.nearlytrade.near'), true);
  });

  it('rejects empty input', () => {
    assert.equal(assetsMatch('', 'nep141:wrap.near'), false);
    assert.equal(assetsMatch('nep141:wrap.near', null), false);
    assert.equal(assetsMatch(undefined, undefined), false);
  });
});
