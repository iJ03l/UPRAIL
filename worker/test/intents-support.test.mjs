import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { isIntentsSupportedAsset } from '../dist/nearRpc.bundle.mjs';

/**
 * `isIntentsSupportedAsset` decides the settlement rail before money moves.
 * A wrong `false` routes an intents asset down the native rail (escrow lock,
 * no solver route); a wrong `true` sends a meme into a doomed intents deposit.
 * Only a definitive answer from the token contract may be cached and acted
 * on — a transport failure must return null so callers keep the empirical
 * try-and-fail path.
 */
describe('isIntentsSupportedAsset', () => {
  let server;
  let rpcUrl;
  let nextResponse;
  let requestCount;

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        requestCount += 1;
        res.setHeader('content-type', 'application/json');
        res.statusCode = nextResponse.status;
        res.end(JSON.stringify(nextResponse.payload));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpcUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  // Distinct contract ids per case: the helper memoizes per contract, and the
  // bundle has no reset hook.
  const env = () => ({ NEAR_RPC_URL: rpcUrl });

  it('returns true when storage_balance_of answers with a balance object', async () => {
    requestCount = 0;
    nextResponse = {
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 'uprail',
        result: {
          result: Array.from(
            Buffer.from(JSON.stringify({ total: '1250000000000000000000', available: '0' }))
          ),
        },
      },
    };
    assert.equal(await isIntentsSupportedAsset(env(), 'token-a.near'), true);
    assert.equal(requestCount, 1);
  });

  it('returns false when the contract answers null (not registered)', async () => {
    nextResponse = {
      status: 200,
      payload: { jsonrpc: '2.0', id: 'uprail', result: { result: [] } },
    };
    assert.equal(await isIntentsSupportedAsset(env(), 'token-b.near'), false);
  });

  it('returns null on an RPC transport failure rather than guessing native', async () => {
    nextResponse = { status: 503, payload: { error: 'unavailable' } };
    assert.equal(await isIntentsSupportedAsset(env(), 'token-c.near'), null);
  });

  it('returns null on a rate-limit style RPC error', async () => {
    nextResponse = {
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 'uprail',
        error: { code: -32005, message: 'Too many requests', data: 'rate limit exceeded' },
      },
    };
    assert.equal(await isIntentsSupportedAsset(env(), 'token-d.near'), null);
  });

  it('returns null for an empty contract id without touching the network', async () => {
    requestCount = 0;
    assert.equal(await isIntentsSupportedAsset(env(), ''), null);
    assert.equal(requestCount, 0);
  });

  it('serves a repeat query from cache without a second RPC call', async () => {
    requestCount = 0;
    nextResponse = {
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 'uprail',
        result: {
          result: Array.from(Buffer.from(JSON.stringify({ total: '1', available: '0' }))),
        },
      },
    };
    assert.equal(await isIntentsSupportedAsset(env(), 'token-e.near'), true);
    assert.equal(await isIntentsSupportedAsset(env(), 'token-e.near'), true);
    assert.equal(requestCount, 1);
  });
});
