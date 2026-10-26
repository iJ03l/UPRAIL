import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAtomic,
  getConfidentialAvailableBalance,
  isConfidentialRailEnabled,
  reconcileConfidentialPayments,
  reconcileConfidentialWithdrawals,
} from '../src/services/confidentialRail';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function statusResponse(status: string): Response {
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeDb(
  rows: Array<{ id: string; x_id: string; deposit_address: string; settlement_status: string | null }>
) {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  return {
    updates,
    prepare(sql: string) {
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async all() {
          return { results: rows };
        },
        async run() {
          updates.push({ sql, args: statement.args });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

describe('confidential rail formatting', () => {
  it('formats base units without float rounding', () => {
    assert.equal(formatAtomic('123456789', 6), '123.456789');
    assert.equal(formatAtomic('1000000', 6), '1');
    assert.equal(formatAtomic('1', 0), '1');
    assert.equal(formatAtomic('000001', 6), '0.000001');
  });
});

describe('confidential rail flag', () => {
  it('is off unless explicitly enabled', () => {
    assert.equal(isConfidentialRailEnabled({} as any), false);
    assert.equal(isConfidentialRailEnabled({ CONFIDENTIAL_RAIL_ENABLED: 'false' } as any), false);
    assert.equal(isConfidentialRailEnabled({ CONFIDENTIAL_RAIL_ENABLED: '1' } as any), true);
    assert.equal(isConfidentialRailEnabled({ CONFIDENTIAL_RAIL_ENABLED: 'true' } as any), true);
  });
});

describe('confidential balance visibility', () => {
  it('sums matching confidential balances and subtracts pending withdrawals', async () => {
    const env = {
      CONFIDENTIAL_RAIL_ENABLED: 'true',
      NEAR_API_BASE: 'https://1click.example',
      ONE_CLICK_API_KEY: 'partner-key',
      CACHE: {
        async get() {
          return {
            accessToken: 'user-session',
            accountId: 'acct.near',
            expiresAt: Date.now() + 600_000,
          };
        },
        async put() {},
        async delete() {},
      },
      DB: {
        prepare(sql: string) {
          const statement = {
            bind() {
              return statement;
            },
            async all() {
              assert.match(sql, /privacy_rail = 'confidential'/);
              return { results: [{ asset: 'nep141:usdc.near', amount: '0.5' }] };
            },
          };
          return statement;
        },
      },
    } as any;

    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/v0/account/balances')) {
        return new Response(
          JSON.stringify([
            { tokenId: 'nep141:usdc.near', available: '2500000', source: 'private' },
            { tokenId: 'nep141:other.near', available: '9000000', source: 'private' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (String(url).includes('/v0/tokens')) {
        return new Response(
          JSON.stringify([
            {
              assetId: 'nep141:usdc.near',
              symbol: 'USDC',
              decimals: 6,
              price: 1,
              blockchain: 'near',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const available = await getConfidentialAvailableBalance(env, 'x-1', 'USDC');
    assert.equal(available, 2);
  });
});

describe('confidential withdrawal reconciliation', () => {
  const env = {
    CONFIDENTIAL_RAIL_ENABLED: 'true',
    NEAR_API_BASE: 'https://1click.example',
    ONE_CLICK_API_KEY: 'partner-key',
    CACHE: {
      async get() {
        return { accessToken: 'user-session', accountId: 'acct.near', expiresAt: Date.now() + 600_000 };
      },
      async put() {},
      async delete() {},
    },
  } as any;

  it('does nothing when the rail is disabled', async () => {
    const db = fakeDb([]);
    const result = await reconcileConfidentialWithdrawals({ ...env, CONFIDENTIAL_RAIL_ENABLED: 'false', DB: db } as any);
    assert.deepEqual(result, { checked: 0, completed: 0, failed: 0 });
    assert.equal(db.updates.length, 0);
  });

  it('finalizes only on SUCCESS', async () => {
    globalThis.fetch = (async () => statusResponse('SUCCESS')) as any;
    const db = fakeDb([{ id: 'wth_1', x_id: 'x-1', deposit_address: 'deposit-1', settlement_status: 'PENDING' }]);
    const result = await reconcileConfidentialWithdrawals({ ...env, DB: db } as any);
    assert.deepEqual(result, { checked: 1, completed: 1, failed: 0 });
    assert.match(db.updates[0].sql, /status = 'COMPLETED'/);
    assert.deepEqual(db.updates[0].args, [db.updates[0].args[0], db.updates[0].args[1], 'wth_1']);
  });

  it('releases the reservation on FAILED and REFUNDED', async () => {
    globalThis.fetch = (async () => statusResponse('REFUNDED')) as any;
    const db = fakeDb([{ id: 'wth_2', x_id: 'x-2', deposit_address: 'deposit-2', settlement_status: 'PENDING' }]);
    const result = await reconcileConfidentialWithdrawals({ ...env, DB: db } as any);
    assert.deepEqual(result, { checked: 1, completed: 0, failed: 1 });
    assert.match(db.updates[0].sql, /status = 'FAILED'/);
  });

  it('persists in-flight status without releasing the reservation', async () => {
    globalThis.fetch = (async () => statusResponse('PROCESSING')) as any;
    const db = fakeDb([{ id: 'wth_3', x_id: 'x-3', deposit_address: 'deposit-3', settlement_status: 'PENDING' }]);
    const result = await reconcileConfidentialWithdrawals({ ...env, DB: db } as any);
    assert.deepEqual(result, { checked: 1, completed: 0, failed: 0 });
    assert.match(db.updates[0].sql, /settlement_status = \?/);
  });
});


describe('confidential payment reconciliation', () => {
  const env = {
    CONFIDENTIAL_RAIL_ENABLED: 'true',
    NEAR_API_BASE: 'https://1click.example',
    ONE_CLICK_API_KEY: 'partner-key',
    CACHE: {
      async get() {
        return { accessToken: 'user-session', accountId: 'acct.near', expiresAt: Date.now() + 600_000 };
      },
      async put() {},
      async delete() {},
    },
  } as any;

  it('marks a timed-out direct send SUCCESS from the sender session', async () => {
    let polledUrl = '';
    globalThis.fetch = (async (url: string) => {
      polledUrl = String(url);
      return statusResponse('SUCCESS');
    }) as any;
    const db = fakeDb([
      {
        id: 'pay_1',
        x_id: 'x-1',
        deposit_address: 'quote-deposit',
        settlement_status: 'PROCESSING',
        status: 'CLAIMED',
        sender_x_id: 'x-1',
        claim_deposit_address: 'claim-deposit',
        intent_hash: null,
        claim_tx_hash: 'intent-hash',
      } as any,
    ]);
    const result = await reconcileConfidentialPayments({ ...env, DB: db } as any);
    assert.deepEqual(result, { checked: 1, completed: 1, failed: 0 });
    assert.match(polledUrl, /claim-deposit/);
    assert.doesNotMatch(polledUrl, /quote-deposit/);
    assert.match(db.updates[0].sql, /settlement_status = 'SUCCESS'/);
  });

  it('returns a failed claim to ESCROWED', async () => {
    globalThis.fetch = (async () => statusResponse('REFUNDED')) as any;
    const db = fakeDb([
      {
        id: 'pay_2',
        x_id: 'x-2',
        deposit_address: 'quote-deposit',
        settlement_status: 'PROCESSING',
        status: 'CLAIMED',
        sender_x_id: 'x-2',
        claim_deposit_address: 'claim-deposit',
        intent_hash: 'escrow-deposit',
        claim_tx_hash: 'claim-hash',
      } as any,
    ]);
    const result = await reconcileConfidentialPayments({ ...env, DB: db } as any);
    assert.deepEqual(result, { checked: 1, completed: 0, failed: 1 });
    assert.match(db.updates[0].sql, /status = 'ESCROWED'/);
  });
});
