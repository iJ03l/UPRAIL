import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pruneExpiredAuthChallenges } from '../dist/maintenance.bundle.mjs';

describe('auth challenge maintenance', () => {
  it('deletes only challenges older than the 24h grace window', async () => {
    const now = 1_700_000_000_000;
    let cutoff;
    const env = {
      DB: {
        prepare(sql) {
          assert.match(sql, /DELETE FROM auth_challenges WHERE expires_at < \?/);
          return {
            bind(value) {
              cutoff = value;
              return { run: async () => ({ meta: { changes: 7 } }) };
            },
          };
        },
      },
    };

    assert.equal(await pruneExpiredAuthChallenges(env, now), 7);
    assert.equal(cutoff, now - 24 * 60 * 60 * 1000);
  });
});
