import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStabilizeSplit,
  getStabilizeQuote,
  resolveOriginToken,
  resolveTargetStablecoin,
  StabilizeError,
} from '../src/services/stabilize';

test('computeStabilizeSplit calculates exact BigInt 1% fee for 24-decimal native NEAR', () => {
  const gross = 1_234_567_890_123_456_789_012_345n;
  const split = computeStabilizeSplit(gross, 24, '0.01');

  assert.equal(split.feePercent, 1);
  assert.equal(split.feeAtomic + split.netInputAtomic, gross);
  assert.equal(split.feeAtomic, 12_345_678_901_234_567_890_123n);
  assert.equal(split.netInputAtomic, 1_222_222_211_222_222_221_122_222n);
  assert.equal(split.grossAmountFormatted, '1.234567890123456789012345');
});

test('computeStabilizeSplit calculates exact 1% fee for 6-decimal and fractional NEAR amounts', () => {
  const split6 = computeStabilizeSplit(250_500_000n, 6, '0.01');
  assert.equal(split6.feeAtomic, 2_505_000n);
  assert.equal(split6.netInputAtomic, 247_995_000n);
  assert.equal(split6.grossAmountFormatted, '250.5');
  assert.equal(split6.feeAmountFormatted, '2.505');
  assert.equal(split6.netInputFormatted, '247.995');

  const splitNear = computeStabilizeSplit(236_757_000_000_000_000_000_000n, 24, '0.01');
  assert.equal(splitNear.feeAtomic, 2_367_570_000_000_000_000_000n);
  assert.equal(splitNear.netInputAtomic, 234_389_430_000_000_000_000_000n);
  assert.equal(splitNear.feeAmountFormatted, '0.00236757');
  assert.equal(splitNear.netInputFormatted, '0.23438943');
});

test('resolveTargetStablecoin resolves USDC and USDT and rejects non-stable targets', () => {
  const usdc = resolveTargetStablecoin('usdc');
  assert.equal(usdc.symbol, 'USDC');
  assert.equal(
    usdc.assetId,
    'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
  );
  assert.equal(usdc.decimals, 6);

  const usdt = resolveTargetStablecoin('USDT');
  assert.equal(usdt.symbol, 'USDT');
  assert.equal(usdt.assetId, 'nep141:usdt.tether-token.near');
  assert.equal(usdt.decimals, 6);

  assert.throws(() => resolveTargetStablecoin('ETH'), StabilizeError);
});

test('resolveOriginToken canonicalizes native NEAR aliases to nep141:wrap.near', async () => {
  const mockTokens = [
    {
      assetId: 'nep141:wrap.near',
      decimals: 24,
      blockchain: 'near',
      symbol: 'wNEAR',
      price: 1.24,
      contractAddress: 'wrap.near',
    },
  ];

  for (const alias of ['near', 'NEAR', 'wnear', 'wrap.near', 'nep141:wrap.near']) {
    const resolved = await resolveOriginToken({} as any, alias, mockTokens);
    assert.equal(resolved.assetId, 'nep141:wrap.near');
    assert.equal(resolved.symbol, 'NEAR');
    assert.equal(resolved.decimals, 24);
    assert.equal(resolved.priceUsd, 1.24);
  }
});

test('getStabilizeQuote rejects dust amounts below 0.05 NEAR or $1.00 USD before quoting', async () => {
  const mockTokens = [
    {
      assetId: 'nep141:wrap.near',
      decimals: 24,
      blockchain: 'near',
      symbol: 'wNEAR',
      price: 3.59,
      contractAddress: 'wrap.near',
    },
    {
      assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      decimals: 6,
      blockchain: 'near',
      symbol: 'USDC',
      price: 1,
    },
  ];
  const mockEnv: any = {
    FEE_PERCENT: '0.01',
    CACHE: {
      async get() {
        return mockTokens;
      },
      async put() {},
    },
  };
  const mockSession: any = { x_id: 'x_1', x_handle: 'testuser' };

  await assert.rejects(
    () =>
      getStabilizeQuote(mockEnv, mockSession, {
        sourceAsset: 'nep141:wrap.near',
        targetAsset: 'USDC',
        amount: '0.03',
      }),
    (err: any) => err instanceof StabilizeError && err.code === 'AMOUNT_TOO_LOW'
  );

  await assert.rejects(
    () =>
      getStabilizeQuote(mockEnv, mockSession, {
        sourceAsset: 'nep141:wrap.near',
        targetAsset: 'USDC',
        amount: '0.078998',
      }),
    (err: any) => err instanceof StabilizeError && err.code === 'AMOUNT_TOO_LOW'
  );
});
