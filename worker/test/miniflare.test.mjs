import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';

describe('UPRAIL Cloudflare Worker (Miniflare)', () => {
  /** @type {Miniflare} */
  let mf;

  before(async () => {
    mf = new Miniflare({
      modules: true,
      scriptPath: 'dist/worker.js',
      compatibilityDate: '2026-10-08',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'uprail-db' },
      kvNamespaces: { CACHE: 'cache' },
      durableObjects: {
        ESCROW: 'EscrowDO',
        NEAR_CONTAINER: 'NearContainer',
      },
      bindings: {
        X_CLIENT_ID: 'test_client_id',
        NEAR_API_BASE: 'https://1click.chaindefuser.com',
        SOLVER_RELAY_URL: 'https://solver-relay-v2.chaindefuser.com/rpc',
        ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
        FEE_ACCOUNT_ID: 'fees.uprail.near',
        FEE_PERCENT: '0.05',
        PAYMENT_EXPIRY_DAYS: '30',
        WEBAUTHN_RP_ID: 'uprail.world',
        WEBAUTHN_RP_NAME: 'UPRAIL',
        WEBAUTHN_ORIGIN: 'https://app.uprail.world',
        SESSION_SECRET: 'test_session_secret_do_not_use_in_production',
        INTERNAL_SERVICE_KEY: 'test_internal_service_key',
        // Points at a closed local port: the settlement service is "configured"
        // but unreachable, exercising the x402 local-escrow fallback.
        SETTLEMENT_SERVICE_URL: 'http://127.0.0.1:1',
        // Throwaway ed25519 key generated for this test run. It is NOT a
        // real escrow key and must never appear in .dev.vars or a deployment.
        ESCROW_PRIVATE_KEY:
          'ed25519:3bPadi6kwbpV3pkzKEcG8NDp74yof3CYGS2aXZECvV8Wggv37W1HfxTvA7EuvhBzFoadXeHtPK62pRywWqryzYU3',
        NEAR_RPC_URL: 'https://near.invalid',
      },
    });

    // Apply schema migrations to the in-memory D1 database, exactly as
    // `wrangler d1 migrations apply` does in production. Route handlers
    // (invites, payments, claim, ...) depend on these tables existing.
    const db = await mf.getD1Database('DB');
    const migrations = [
      '0001_initial.sql',
      '0002_payment_identity_and_missing_tables.sql',
      '0003_withdrawal_error_diagnostics.sql',
      '0004_agent_rail.sql',
    ];
    for (const file of migrations) {
      const raw = await readFile(new URL(`../src/db/migrations/${file}`, import.meta.url), 'utf8');
      // Strip line comments BEFORE splitting on ';' — a ';' inside a comment
      // (e.g. "never stored; only its hash") would otherwise split a comment
      // line and leave a fragment as a bogus statement.
      const withoutComments = raw
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      // Run statements one at a time: D1's exec() mis-chunks multi-line
      // CREATE TABLE statements and rejects comment-only chunks.
      const statements = withoutComments
        .split(';')
        .map((stmt) => stmt.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await db.prepare(stmt).run();
      }
    }
  });

  after(async () => {
    if (mf) await mf.dispose();
  });

  it('GET /health returns healthy response', async () => {
    const res = await mf.dispatchFetch('http://localhost/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'uprail-worker');
  });

  it('POST /api/resolve validates handle correctly', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: '@alice' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.handle, '@alice');
    assert.equal(body.resolved, false);
  });

  it('POST /api/resolve rejects invalid handles', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'invalid!handle' }),
    });
    assert.equal(res.status, 400);
  });

  it('GET /not-found returns 404', async () => {
    const res = await mf.dispatchFetch('http://localhost/unknown');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'NOT_FOUND');
  });

  it('POST /api/payments/:id/cancel requires authentication (anti-BAC)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/payments/test_id/cancel', {
      method: 'POST',
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/claim/pending requires authentication (anti-BAC)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/claim/pending');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/claim/register requires authentication (anti-BAC)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/claim/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attestation: {} }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/payments requires authentication (anti-IDOR)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/payments');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/tokens returns live supported tokens', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/tokens');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tokens));
    assert.ok(body.tokens.length > 0);
  });

  it('GET /api/onchain/tokens returns tokens array', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/onchain/tokens');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tokens));
  });

  it('GET /api/onchain/balances requires authentication (clean access control)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/onchain/balances');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/onchain/deposit-address requires authentication (clean access control)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/onchain/deposit-address');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/onchain/history requires authentication (clean access control)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/onchain/history');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/auth-challenge requires authentication', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/auth-challenge');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/auth-challenge requires authentication', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/auth-challenge', {
      method: 'POST',
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/send requires authentication and passkey authorization', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientHandle: 'alice',
        asset: 'usdc',
        amount: '10',
        quoteSignature: 'sig',
        depositAddress: 'addr',
      }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/claim/execute requires authentication and passkey authorization', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/claim/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIds: ['test_id'] }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/quote returns cryptographically signed quote token', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientHandle: '@vitalik',
        asset: 'nep141:wrap.near',
        amount: '1.5',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recipientHandle, '@vitalik');
    assert.equal(body.asset, 'nep141:wrap.near');
    assert.equal(body.amount, '1.5');
    assert.equal(body.protocolFee, '0.075', 'Must calculate the 5% send fee (1.5 * 0.05 = 0.075)');
    assert.equal(body.recipientAmount, '1.425', 'Fee is carved out of the amount (1.5 - 0.075)');
    assert.equal(body.feeRecipient, 'fees.uprail.near', 'Must route send fee to fees.uprail.near');
    assert.ok(body.quoteId, 'Must include quoteId');
    assert.ok(body.depositAddress, 'Must include depositAddress');
    assert.ok(body.quoteSignature, 'Must include quoteSignature');
    assert.ok(body.expiresAt > Date.now(), 'Must have future expiry');
    assert.notEqual(body.quoteSignature, 'near_intent_quote_sig', 'Must not be dummy string');
    assert.notEqual(body.quoteSignature, 'escrow_platform_holding_sig', 'Must not be dummy string');
  });

  it('POST /api/quote rejects missing parameters', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientHandle: '@vitalik',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_REQUEST');
  });

  it('Quote signature token verification rejects dummy mock signatures', async () => {
    const quoteRes = await mf.dispatchFetch('http://localhost/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientHandle: '@alice',
        asset: 'nep141:wrap.near',
        amount: '2.0',
      }),
    });
    assert.equal(quoteRes.status, 200);
    const quote = await quoteRes.json();
    assert.ok(quote.quoteSignature);
    assert.notEqual(quote.quoteSignature, 'near_intent_quote_sig');
    assert.notEqual(quote.quoteSignature, 'escrow_platform_holding_sig');
    assert.ok(quote.quoteSignature.includes('.'), 'Quote token is signed and self-verifiable');
  });

  it('POST /api/invites/validate validates genesis code UPRAIL', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'UPRAIL' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid, true);
  });

  it('POST /api/invites/validate rejects non-6-letter format', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'toolongcode123' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'Invite code must be exactly 6 capital letters');
  });

  it('POST /api/invites/validate rejects nonexistent invite code', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZ' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'Invite code does not exist');
  });

  it('GET /api/invites/status returns unauthenticated status when logged out', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/status');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.authenticated, false);
    assert.equal(body.isActivated, false);
    assert.equal(body.personalInviteCode, null);
  });

  it('GET /api/invites/my-invite requires authentication', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/my-invite');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/invites/redeem requires authentication', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'UPRAIL' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('GET /api/claim/balance requires authentication (anti-BAC)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/claim/balance');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/claim/withdraw requires authentication (anti-BAC)', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/claim/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationAddress: 'alice.near', amount: '10' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  it('POST /api/mcp requires an agent key', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'AGENT_KEY_REQUIRED');
  });

  it('POST /api/x402/challenge validates its input', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/x402/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'USDC' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MISSING_RECIPIENT');
  });

  it('x402 mints a local-escrow challenge when settlement is unreachable', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/x402/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientHandle: 'uprail', asset: 'USDC', amount: '0.01' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.rail, 'local');
    assert.equal(body.depositAddress, 'escrow.uprail.near');
    assert.match(body.reference, /^x402_/);
    assert.equal(body.requirement.accepts[0].amount, '10000');
    assert.equal(body.requirement.accepts[0].payTo, 'escrow.uprail.near');
  });

  it('x402 verify accepts a flat credential and reports missing tx hash', async () => {
    const challenge = await mf.dispatchFetch('http://localhost/api/x402/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientHandle: 'uprail', asset: 'USDC', amount: '0.01' }),
    });
    const { reference } = await challenge.json();

    const res = await mf.dispatchFetch('http://localhost/api/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isValid, false);
    assert.equal(body.reason, 'missing_tx_hash');
    assert.equal(body.rail, 'local');
  });

  it('agent authentication resolves a seeded key and lists MCP tools', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    const rawKey = 'up_agent_' + 'a'.repeat(48);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind('xid_mcp_1', 'mcp_tester', 'MCP Tester', 'mcp_tester.near', now, now)
      .run();
    await db
      .prepare(
        'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind('agent_mcp_1', 'xid_mcp_1', 'MCP Agent', 'autonomous', now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO agent_keys (id, agent_id, x_id, label, key_hash, key_prefix, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('key_mcp_1', 'agent_mcp_1', 'xid_mcp_1', 'MCP Agent', keyHash, 'up_agent_aaaaaa', now)
      .run();

    const listed = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    const names = listedBody.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['create_payment_request', 'get_balance', 'pay_handle', 'resolve_handle']);

    const resolved = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'resolve_handle', arguments: { handle: '@mcp_tester' } },
      }),
    });
    assert.equal(resolved.status, 200);
    const resolvedBody = await resolved.json();
    assert.ok(!resolvedBody.result.isError);
    const payload = JSON.parse(resolvedBody.result.content[0].text);
    assert.equal(payload.exists, true);
    assert.equal(payload.nearAccount, 'mcp_tester.near');
  });
});

