import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ensureKeyOnIntents } from '../dist/nearRpc.bundle.mjs';

/**
 * `ensureKeyOnIntents` gates every user-signed intent. intents.near rejects any
 * signature from a key it never authorized, so a withdrawal that skips this
 * check panics inside the contract and strands the balance. The helper must
 * (a) no-op when the key is already registered, (b) actually register a missing
 * key, and (c) refuse cleanly — never claim success — when registration cannot
 * be made to land.
 */

// 32 zero bytes in base58; a well-formed latest_block_hash.
const B58_ZERO32 = '1'.repeat(32);

describe('ensureKeyOnIntents', () => {
  let server;
  let rpcUrl;
  let registered;
  let broadcasts;
  let failBroadcast;

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let msg = {};
        try { msg = JSON.parse(body); } catch {}
        res.setHeader('content-type', 'application/json');
        const reply = (result) => res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));

        if (msg.method === 'status') {
          return reply({ sync_info: { latest_block_hash: B58_ZERO32 } });
        }
        if (msg.method === 'query' && msg.params?.request_type === 'view_access_key') {
          return reply({ nonce: 0 });
        }
        if (msg.method === 'query' && msg.params?.request_type === 'call_function') {
          return reply({ result: Array.from(Buffer.from(JSON.stringify(registered))) });
        }
        if (msg.method === 'broadcast_tx_commit') {
          broadcasts += 1;
          if (failBroadcast) {
            return res.end(
              JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { message: 'rejected', data: 'InvalidNonce' } })
            );
          }
          registered = true;
          return reply({ status: { SuccessValue: '' }, transaction: { hash: 'HASH' } });
        }
        reply({});
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpcUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const env = () => ({ NEAR_RPC_URL: rpcUrl });
  const pub = new Uint8Array(32).fill(9);
  const priv = new Uint8Array(32).fill(3);

  it('registers a missing key and reports success', async () => {
    registered = false;
    broadcasts = 0;
    failBroadcast = false;
    const res = await ensureKeyOnIntents(env(), 'acct-a.near', pub, priv);
    assert.equal(res.registered, true);
    assert.equal(broadcasts, 1);
  });

  it('is a no-op when the key is already registered', async () => {
    registered = true;
    broadcasts = 0;
    failBroadcast = false;
    const res = await ensureKeyOnIntents(env(), 'acct-b.near', pub, priv);
    assert.equal(res.registered, true);
    assert.equal(broadcasts, 0);
  });

  it('retries and gives up cleanly when registration never lands', async () => {
    registered = false;
    broadcasts = 0;
    failBroadcast = true;
    const res = await ensureKeyOnIntents(env(), 'acct-c.near', pub, priv);
    assert.equal(res.registered, false);
    // 2 attempts (1 retry): enough to ride out a throttle, few enough to stay
    // inside the Worker's 50-subrequest budget.
    assert.ok(broadcasts >= 2, `expected at least 2 attempts, saw ${broadcasts}`);
  });
});
