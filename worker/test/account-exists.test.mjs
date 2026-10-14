import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { accountExists } from '../dist/nearRpc.bundle.mjs';

/**
 * `accountExists` gates /api/onchain/account, which in turn decides whether the
 * Send page ever fetches balances. Answering false for a transient RPC failure
 * reports a funded recipient as having no account, and their real balance is
 * never read. Only a definitive UNKNOWN_ACCOUNT may answer false.
 */
describe('accountExists', () => {
  let server;
  let rpcUrl;
  let nextResponse;

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.statusCode = nextResponse.status;
        res.end(JSON.stringify(nextResponse.payload));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpcUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const env = () => ({ NEAR_RPC_URL: rpcUrl });

  it('returns true when the node reports a balance', async () => {
    nextResponse = {
      status: 200,
      payload: { jsonrpc: '2.0', id: 'uprail', result: { amount: '99641197280780499999999' } },
    };
    assert.equal(await accountExists(env(), 'u_6639e0db8916d338.escrow.uprail.near'), true);
  });

  it('returns false only for a definitive UNKNOWN_ACCOUNT', async () => {
    // Real shape observed from the NEAR node for a missing account.
    nextResponse = {
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 'uprail',
        error: {
          name: 'HANDLER_ERROR',
          cause: { name: 'UNKNOWN_ACCOUNT', info: {} },
          code: -32000,
          message: 'Server error',
          data: 'account u_deadbeef.escrow.uprail.near does not exist while viewing',
        },
      },
    };
    assert.equal(await accountExists(env(), 'u_deadbeef.escrow.uprail.near'), false);
  });

  it('throws on an HTTP failure rather than inventing a missing account', async () => {
    nextResponse = { status: 503, payload: { error: 'unavailable' } };
    await assert.rejects(() => accountExists(env(), 'u_6639e0db8916d338.escrow.uprail.near'));
  });

  it('throws on a rate-limit style RPC error', async () => {
    nextResponse = {
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 'uprail',
        error: { code: -32005, message: 'Too many requests', data: 'rate limit exceeded' },
      },
    };
    await assert.rejects(() => accountExists(env(), 'u_6639e0db8916d338.escrow.uprail.near'));
  });

  it('returns false for an empty account id without touching the network', async () => {
    assert.equal(await accountExists(env(), ''), false);
  });
});
