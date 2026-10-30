import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plainAmount, resolveShareTicker } from '../dist/share.bundle.mjs';

const env = { NEAR_RPC_URL: 'https://near.invalid' };

describe('share card ticker resolution', () => {
  it('renders every native NEAR representation as NEAR', async () => {
    for (const asset of [
      'near',
      'NEAR',
      'wnear',
      'wrap.near',
      'native:near',
      'nep141:near',
      'nep141:wrap.near',
    ]) {
      assert.equal(await resolveShareTicker(env, asset), 'NEAR', asset);
    }
  });

  it('falls back to the NEP-141 label when the registry is unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    try {
      assert.equal(
        await resolveShareTicker(env, 'nep141:uptober.nearlytrade.near'),
        'UPTOBER'
      );
      assert.equal(
        await resolveShareTicker(env, 'nep141:raen-e1328c.launchpad.justhoot.near'),
        'RAEN'
      );
      assert.equal(
        await resolveShareTicker(env, 'RAEN-E1328C'),
        'RAEN'
      );
      assert.equal(
        await resolveShareTicker(env, 'nep141:abg-966.meme-cooking.near'),
        'ABG'
      );
      assert.equal(
        await resolveShareTicker(env, 'nep141:uptober-2.nearlytrade.near'),
        'UPTOBER'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('share card amount formatting', () => {
  it('rounds token amounts to two decimals', () => {
    assert.equal(plainAmount('12.3437283', 'USDC'), '12.34 USDC');
    assert.equal(plainAmount('94850.72118', '6BOWEN'), '94,850.72 6BOWEN');
  });

  it('keeps sub-cent amounts visible', () => {
    assert.equal(plainAmount('0.004321', 'NEAR'), '0.004321 NEAR');
    assert.equal(plainAmount('0', 'USDC'), '0.00 USDC');
  });
});
