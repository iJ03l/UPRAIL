import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getWithdrawChains,
  get1ClickWithdrawalQuote,
  isValidDestinationAddress,
  isNearAccountAddress,
  inferChainFromAddress,
  hasKnownAddressFamily,
  chainMatchesAddress,
} from '../dist/oneclickWithdraw.bundle.mjs';

const XRP_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const WBTC_ASSET =
  'nep141:2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near';

const TOKENS = [
  { assetId: 'nep141:xrp.omft.near', blockchain: 'xrp', symbol: 'XRP', decimals: 6 },
  {
    assetId: '1cs_v1:starknet:erc20:0x0000000000000000000000000000000000000001',
    blockchain: 'starknet',
    symbol: 'XRP',
    decimals: 6,
  },
  {
    assetId: '1cs_v1:aptos:aptos-fa:0x1::xrp::XRP',
    blockchain: 'aptos',
    symbol: 'XRP',
    decimals: 6,
  },
  { assetId: 'nep141:btc.omft.near', blockchain: 'btc', symbol: 'BTC', decimals: 8 },
  { assetId: WBTC_ASSET, blockchain: 'near', symbol: 'BTC', decimals: 8 },
  {
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    blockchain: 'near',
    symbol: 'USDC',
    decimals: 6,
  },
  { assetId: 'nep141:sol.omft.near', blockchain: 'sol', symbol: 'SOL', decimals: 9 },
  { assetId: 'nep141:near.omft.near', blockchain: 'bsc', symbol: 'NEAR', decimals: 24 },
];

const env = () => ({
  NEAR_API_BASE: 'https://1click.test',
  ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function tokenCatalogue(tokens = TOKENS) {
  return async (url) => {
    const href = String(url);
    if (href.endsWith('/v0/tokens')) return jsonResponse(tokens);
    throw new Error(`unexpected fetch ${href}`);
  };
}

describe('registry-driven withdrawal origins', () => {
  it('offers XRP Ledger, Starknet and Aptos for the live XRP asset', async () => {
    await withFetch(tokenCatalogue(), async () => {
      const chains = await getWithdrawChains(env(), 'nep141:xrp.omft.near');
      assert.deepEqual(
        chains.map((chain) => chain.key),
        ['xrp', 'starknet', 'aptos']
      );
      assert.equal(chains[0].name, 'XRP Ledger');
      assert.equal(chains[0].family, null);
    });
  });

  it('refreshes a stale catalogue when the requested asset is newly listed', async () => {
    let puts = 0;
    const staleEnv = {
      ...env(),
      CACHE: {
        get: async () => TOKENS.filter((token) => token.symbol !== 'XRP'),
        put: async () => {
          puts += 1;
        },
      },
    };
    await withFetch(tokenCatalogue(), async () => {
      const chains = await getWithdrawChains(staleEnv, 'nep141:xrp.omft.near');
      assert.equal(chains[0].key, 'xrp');
      assert.equal(puts, 1);
    });
  });

  it('keeps native NEAR as the first withdrawal rail', async () => {
    await withFetch(tokenCatalogue(), async () => {
      const chains = await getWithdrawChains(env(), 'nep141:wrap.near');
      assert.deepEqual(
        chains.map((chain) => chain.key),
        ['near', 'bsc']
      );
    });
  });

  it('returns no chains for an asset outside the registry', async () => {
    await withFetch(tokenCatalogue(), async () => {
      assert.deepEqual(await getWithdrawChains(env(), 'nep141:not-real.near'), []);
    });
  });
});

describe('XRP withdrawal quote', () => {
  it('quotes the exact XRP intents asset to an XRP Ledger address', async () => {
    let quoteBody;
    const handler = async (url, init) => {
      const href = String(url);
      if (href.endsWith('/v0/tokens')) return jsonResponse(TOKENS);
      if (href.endsWith('/v0/quote')) {
        quoteBody = JSON.parse(init.body);
        return jsonResponse({
          quote: {
            depositAddress: 'deposit-address.near',
            quoteId: 'quote-xrp',
            amountIn: '12345678',
            amountOut: '12.345678',
          },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withFetch(handler, async () => {
      const quote = await get1ClickWithdrawalQuote(env(), {
        asset: 'nep141:xrp.omft.near',
        amount: 12.345678,
        destinationAddress: XRP_ADDRESS,
        destinationChain: 'xrp',
      });

      assert.equal(quoteBody.originAsset, 'nep141:xrp.omft.near');
      assert.equal(quoteBody.destinationAsset, 'nep141:xrp.omft.near');
      assert.equal(quoteBody.amount, '12345678');
      assert.equal(quoteBody.recipient, XRP_ADDRESS);
      assert.equal(quoteBody.recipientType, 'DESTINATION_CHAIN');
      assert.equal(quote.depositAddress, 'deposit-address.near');
      assert.equal(quote.originAsset, 'nep141:xrp.omft.near');
    });
  });

  it('turns 1Click atomic minimums into a human token amount', async () => {
    const handler = async (url) => {
      const href = String(url);
      if (href.endsWith('/v0/tokens')) return jsonResponse(TOKENS);
      if (href.endsWith('/v0/quote')) {
        return jsonResponse(
          { message: 'Amount is too low for bridge, try at least 1010112' },
          400
        );
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withFetch(handler, async () => {
      await assert.rejects(
        () =>
          get1ClickWithdrawalQuote(env(), {
            asset: 'nep141:xrp.omft.near',
            amount: 1,
            destinationAddress: XRP_ADDRESS,
            destinationChain: 'xrp',
          }),
        /minimum is 1\.010112 XRP/
      );
    });
  });

  it('uses the exact wBTC origin instead of the BTC ticker entry', async () => {
    let quoteBody;
    const handler = async (url, init) => {
      const href = String(url);
      if (href.endsWith('/v0/tokens')) return jsonResponse(TOKENS);
      if (href.endsWith('/v0/quote')) {
        quoteBody = JSON.parse(init.body);
        return jsonResponse({ quote: { depositAddress: 'deposit-address.near' } });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withFetch(handler, async () => {
      await get1ClickWithdrawalQuote(env(), {
        asset: WBTC_ASSET,
        amount: 0.00012345,
        destinationAddress: BTC_ADDRESS,
        destinationChain: 'btc',
      });

      assert.equal(quoteBody.originAsset, WBTC_ASSET);
      assert.equal(quoteBody.destinationAsset, 'nep141:btc.omft.near');
      assert.equal(quoteBody.amount, '12345');
    });
  });
});

describe('XRP destination validation', () => {
  it('recognises XRP classic and X-addresses', () => {
    const xAddress = `X${'1'.repeat(46)}`;
    for (const address of [XRP_ADDRESS, xAddress]) {
      assert.equal(isValidDestinationAddress(address), true);
      assert.equal(isNearAccountAddress(address), false);
      assert.equal(inferChainFromAddress(address), 'xrp');
      assert.equal(chainMatchesAddress('xrp', address), true);
    }
  });

  it('leaves unknown 1Click families to the solver', () => {
    assert.equal(hasKnownAddressFamily('xrp'), false);
    assert.equal(hasKnownAddressFamily('starknet'), false);
    assert.equal(hasKnownAddressFamily('near'), true);
    assert.equal(hasKnownAddressFamily('base'), true);
    assert.equal(hasKnownAddressFamily('hood'), true);
    assert.equal(hasKnownAddressFamily('prl'), true);
  });
});

describe('Robinhood and Pearl destination validation', () => {
  it('recognises Robinhood EVM and Pearl Bech32 addresses', () => {
    const pearlAddress = 'prl1pgvux70s2fhwn80dv3ceqw2qdu3h62zxlh7d5m6ef6zqllr4vglpszmpk4p';
    const hoodAddress = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';

    assert.equal(isValidDestinationAddress(pearlAddress), true);
    assert.equal(isNearAccountAddress(pearlAddress), false);
    assert.equal(inferChainFromAddress(pearlAddress), 'prl');
    assert.equal(chainMatchesAddress('prl', pearlAddress), true);

    assert.equal(isValidDestinationAddress(hoodAddress), true);
    assert.equal(chainMatchesAddress('hood', hoodAddress), true);
  });
});

describe('native NEAR withdrawal assetId', () => {
  it('canonicalizes native NEAR to nep141:wrap.near for 1Click quotes', async () => {
    let quoteBody;
    const handler = async (url, init) => {
      const href = String(url);
      if (href.endsWith('/v0/tokens')) return jsonResponse(TOKENS);
      if (href.endsWith('/v0/quote')) {
        quoteBody = JSON.parse(init.body);
        return jsonResponse({
          quote: {
            depositAddress: 'deposit-near.near',
            quoteId: 'quote-near',
            amountIn: '1400000000000000000000000',
            amountOut: '1400000000000000000000000',
          },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withFetch(handler, async () => {
      const quote = await get1ClickWithdrawalQuote(env(), {
        asset: 'nep141:wrap.near',
        amount: 1.4,
        destinationAddress: 'ed32a286963961d8ee752e431e2866b89dd1f7c7e0ddaa785abe5f1f60bf9355',
        destinationChain: 'near',
      });

      assert.equal(quoteBody.originAsset, 'nep141:wrap.near');
      assert.equal(quoteBody.destinationAsset, 'nep141:wrap.near');
      assert.equal(quote.originAsset, 'nep141:wrap.near');
    });
  });
});

