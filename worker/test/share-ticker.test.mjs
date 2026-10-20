import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShareTicker } from '../dist/share.bundle.mjs';

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
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
