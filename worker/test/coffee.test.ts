import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCoffeeOptions,
  getCoffeeCreatorProfile,
  createCoffeeDonation,
  checkAndSettleCoffeeDonation,
  CoffeeError,
  formatChainName,
} from '../src/services/coffee';

function makeMockDb(initialRow: {
  x_id: string;
  x_handle: string;
  x_name: string;
  near_account: string;
  avatar_url: string | null;
  coffee_enabled: number;
} | null) {
  const donations = new Map<string, any>();

  return {
    donations,
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (normalized.includes('FROM x_identities')) {
                const handle = String(args[0] || '').toLowerCase();
                if (initialRow && initialRow.x_handle.toLowerCase() === handle) {
                  return initialRow;
                }
                return null;
              }
              if (normalized.startsWith('SELECT * FROM coffee_donations WHERE id = ?')) {
                return donations.get(String(args[0])) || null;
              }
              return null;
            },
            async all() {
              return { results: Array.from(donations.values()) };
            },
            async run() {
              if (normalized.startsWith('INSERT INTO coffee_donations')) {
                const [
                  id,
                  recipient_x_id,
                  recipient_handle,
                  recipient_near_account,
                  origin_asset,
                  origin_chain,
                  origin_symbol,
                  target_symbol,
                  target_asset,
                  gross_amount,
                  gross_atomic,
                  quoted_out_atomic,
                  net_amount,
                  net_atomic,
                  protocol_fee,
                  fee_atomic,
                  deposit_address,
                  deposit_memo,
                  rail,
                  expires_at,
                  created_at,
                  updated_at,
                ] = args;
                donations.set(id, {
                  id,
                  recipient_x_id,
                  recipient_handle,
                  recipient_near_account,
                  origin_asset,
                  origin_chain,
                  origin_symbol,
                  target_symbol,
                  target_asset,
                  gross_amount,
                  gross_atomic,
                  quoted_out_atomic,
                  net_amount,
                  net_atomic,
                  protocol_fee,
                  fee_atomic,
                  deposit_address,
                  deposit_memo,
                  status: 'WAITING_DEPOSIT',
                  intent_hash: null,
                  payout_tx_hash: null,
                  settled_amount_atomic: null,
                  rail,
                  expires_at,
                  created_at,
                  updated_at,
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET status = 'SETTLING'")) {
                const [updatedAt, id] = args;
                const row = donations.get(id);
                if (row && (row.status === 'WAITING_DEPOSIT' || row.status === 'PROCESSING')) {
                  row.status = 'SETTLING';
                  row.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (normalized.includes("SET status = 'EXPIRED'")) {
                const [updatedAt, id] = args;
                const row = donations.get(id);
                if (row && row.status === 'WAITING_DEPOSIT') {
                  row.status = 'EXPIRED';
                  row.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

test('formatChainName formats common chains properly', () => {
  assert.equal(formatChainName('base'), 'Base');
  assert.equal(formatChainName('arb'), 'Arbitrum');
  assert.equal(formatChainName('sol'), 'Solana');
  assert.equal(formatChainName('near'), 'NEAR');
});

test('getCoffeeOptions pins USDC and USDT first and deduplicates chains', async () => {
  const sampleTokens = [
    { assetId: 'nep141:sol.omft.near', blockchain: 'sol', symbol: 'SOL', decimals: 9, price: 150 },
    {
      assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
      blockchain: 'eth',
      symbol: 'USDT',
      decimals: 6,
      price: 1,
    },
    {
      assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
      blockchain: 'base',
      symbol: 'USDC',
      decimals: 6,
      price: 1,
    },
    {
      assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
      blockchain: 'arb',
      symbol: 'USDC',
      decimals: 6,
      price: 1,
    },
  ];
  const mockEnv: any = {
    CACHE: {
      async get() {
        return sampleTokens;
      },
      async put() {},
    },
  };

  const opts = await getCoffeeOptions(mockEnv);
  assert.equal(opts[0].symbol, 'USDC');
  assert.equal(opts[0].isStable, true);
  assert.equal(opts[1].symbol, 'USDT');
  assert.equal(opts[1].isStable, true);
  assert.equal(opts[2].symbol, 'SOL');
  assert.equal(opts[0].chains.length, 2);
  assert.equal(opts[0].chains[0].chain, 'base');
});

test('getCoffeeOptions canonicalizes nep141:wrap.near (wNEAR on near) under NEAR before BNB Chain', async () => {
  const sampleTokens = [
    {
      assetId: 'nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t',
      blockchain: 'bsc',
      symbol: 'NEAR',
      decimals: 18,
      price: 3.59,
    },
    {
      assetId: 'nep141:wrap.near',
      blockchain: 'near',
      symbol: 'wNEAR',
      decimals: 24,
      price: 3.59,
    },
    {
      assetId: '1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG',
      blockchain: 'sol',
      symbol: 'wNEAR',
      decimals: 9,
      price: 3.59,
    },
  ];
  const mockEnv: any = {
    CACHE: {
      async get() {
        return sampleTokens;
      },
      async put() {},
    },
  };

  const opts = await getCoffeeOptions(mockEnv);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].symbol, 'NEAR');
  assert.deepEqual(
    opts[0].chains.map((c) => ({ chain: c.chain, assetId: c.assetId })),
    [
      { chain: 'near', assetId: 'nep141:wrap.near' },
      { chain: 'bsc', assetId: 'nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t' },
    ]
  );
});

test('getCoffeeCreatorProfile returns enabled state accurately', async () => {
  const dbEnabled = makeMockDb({
    x_id: 'x_1',
    x_handle: 'uprailworld',
    x_name: 'UPRAIL',
    near_account: 'u_fc982587d85af44f.escrow.uprail.near',
    avatar_url: null,
    coffee_enabled: 1,
  });
  const prof1 = await getCoffeeCreatorProfile({ DB: dbEnabled } as any, '@UPRAILWORLD');
  assert.equal(prof1.found, true);
  assert.equal(prof1.enabled, true);
  assert.equal(prof1.handle, 'uprailworld');

  const dbDisabled = makeMockDb({
    x_id: 'x_1',
    x_handle: 'uprailworld',
    x_name: 'UPRAIL',
    near_account: 'u_fc982587d85af44f.escrow.uprail.near',
    avatar_url: null,
    coffee_enabled: 0,
  });
  const prof2 = await getCoffeeCreatorProfile({ DB: dbDisabled } as any, 'uprailworld');
  assert.equal(prof2.found, true);
  assert.equal(prof2.enabled, false);

  const prof3 = await getCoffeeCreatorProfile({ DB: dbDisabled } as any, 'unknown_user');
  assert.equal(prof3.found, false);
});

test('createCoffeeDonation rejects disabled creators and invalid amounts', async () => {
  const dbDisabled = makeMockDb({
    x_id: 'x_1',
    x_handle: 'uprailworld',
    x_name: 'UPRAIL',
    near_account: 'u_fc982587d85af44f.escrow.uprail.near',
    avatar_url: null,
    coffee_enabled: 0,
  });

  await assert.rejects(
    () =>
      createCoffeeDonation({ DB: dbDisabled } as any, {
        handle: 'uprailworld',
        amountUsd: 5,
        originSymbol: 'USDC',
        originChain: 'base',
      }),
    (err: any) => err instanceof CoffeeError && err.code === 'COFFEE_DISABLED' && err.httpStatus === 403
  );

  await assert.rejects(
    () =>
      createCoffeeDonation({ DB: dbDisabled } as any, {
        handle: 'uprailworld',
        amountUsd: 0.25,
        originSymbol: 'USDC',
        originChain: 'base',
      }),
    (err: any) => err instanceof CoffeeError && err.code === 'INVALID_AMOUNT'
  );
});

test('createCoffeeDonation generates quote with 1% protocol fee split and expires stale rows cleanly', async () => {
  const db = makeMockDb({
    x_id: 'x_1',
    x_handle: 'uprailworld',
    x_name: 'UPRAIL',
    near_account: 'u_fc982587d85af44f.escrow.uprail.near',
    avatar_url: null,
    coffee_enabled: 1,
  });

  const sampleTokens = [
    {
      assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
      blockchain: 'base',
      symbol: 'USDC',
      decimals: 6,
      price: 1,
    },
    {
      assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      blockchain: 'near',
      symbol: 'USDC',
      decimals: 6,
      price: 1,
    },
  ];

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    const u = String(url);
    if (u.endsWith('/v0/quote')) {
      return new Response(
        JSON.stringify({
          quote: {
            depositAddress: '0xEphemeralBaseDeposit123',
            deadline: new Date(Date.now() + 3600_000).toISOString(),
            amountIn: '10000000',
            amountOut: '10000000',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };

  try {
    const env: any = {
      DB: db,
      ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
      FEE_PERCENT: '0.01',
      CONFIDENTIAL_RAIL_ENABLED: 'false',
      CACHE: {
        async get() {
          return sampleTokens;
        },
        async put() {},
      },
    };

    const donation = await createCoffeeDonation(env, {
      handle: 'uprailworld',
      amountUsd: 10,
      originSymbol: 'USDC',
      originChain: 'base',
    });

    assert.equal(donation.depositAddress, '0xEphemeralBaseDeposit123');
    assert.equal(donation.grossAmount, '10');
    assert.equal(donation.protocolFee, '0.1');
    assert.equal(donation.estimatedNetOut, '9.9');
    assert.equal(donation.feePercent, 1);
    assert.equal(donation.status, 'WAITING_DEPOSIT');

    // Simulate expired check
    const stored = db.donations.get(donation.id);
    stored.expires_at = Date.now() - 1000;
    const statusRes = await checkAndSettleCoffeeDonation(env, donation.id);
    assert.equal(statusRes.status, 'EXPIRED');
  } finally {
    globalThis.fetch = origFetch;
  }
});
