import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

function signTestSession(session) {
  const payload = JSON.stringify(session);
  const body = Buffer.from(payload).toString('base64url');
  const signature = createHmac('sha256', 'test_session_secret_do_not_use_in_production')
    .update(payload)
    .digest('base64url');
  return `${body}.${signature}`;
}

function fakeAssertion(credentialId, challenge) {
  const clientData = {
    type: 'webauthn.get',
    challenge,
    origin: 'https://app.uprail.world',
  };
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString('base64url'),
      authenticatorData: 'AAAA',
      signature: 'AAAA',
      userHandle: null,
    },
  };
}

describe('UPRAIL Cloudflare Worker (Miniflare)', () => {
  /** @type {Miniflare} */
  let mf;

  before(async () => {
    const distDir = new URL('../dist/', import.meta.url);
    const wasmModules = (await readdir(distDir))
      .filter((file) => file.endsWith('.wasm'))
      .map((file) => ({ type: 'CompiledWasm', path: `dist/${file}` }));

    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: [{ type: 'ESModule', path: 'dist/worker.js' }, ...wasmModules],
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
      }),
    );

    // Apply schema migrations to the in-memory D1 database, exactly as
    // `wrangler d1 migrations apply` does in production. Route handlers
    // (invites, payments, claim, ...) depend on these tables existing.
    const db = await mf.getD1Database('DB');
    const migrations = [
      '0001_initial.sql',
      '0002_payment_identity_and_missing_tables.sql',
      '0003_withdrawal_error_diagnostics.sql',
      '0004_agent_rail.sql',
      '0007_recovery_codes.sql',
      '0008_recovery_code_ciphertext.sql',
      '0010_launchpad_token_bindings.sql',
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

  it('GET /api/launchpads/config exposes self-serve proof details', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/launchpads/config');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.escrowAccount, 'escrow.uprail.near');
    assert.equal(body.registration.proofRecipient, 'uprail.near');
    assert.equal(body.registration.auth, 'NEP-413 signature from an access key on the token parent account');
    assert.deepEqual(body.verificationKinds, ['token_config', 'factory']);
    assert.deepEqual(body.claimKinds, ['token_claim']);
  });

  it('POST /api/launchpads/register requires a signed proof', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/launchpads/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'alice.launchpad.near',
        handle: 'alice',
        launchpad: { id: 'custom', name: 'Custom' },
        verification: { kind: 'token_config', method: 'get_config', paths: [['fee_to']] },
        issuedAt: Date.now(),
      }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'PROOF_REQUIRED');
  });

  it('POST /api/launchpads/register rejects a proof from the wrong signer', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/launchpads/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'alice.launchpad.near',
        handle: 'alice',
        launchpad: { id: 'custom', name: 'Custom' },
        verification: { kind: 'token_config', method: 'get_config', paths: [['fee_to']] },
        issuedAt: Date.now(),
        proof: {
          signerId: 'other.near',
          publicKey: 'ed25519:11111111111111111111111111111111',
          signature: 'AAAA',
          nonce: 'AAAA',
          recipient: 'uprail.near',
        },
      }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'WRONG_SIGNER');
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

  it('passkey confirmation and recovery endpoints require authentication', async () => {
    for (const [path, method] of [
      ['/auth/passkey/confirm', 'POST'],
      ['/auth/recovery/status', 'GET'],
      ['/auth/recovery/codes', 'POST'],
      ['/auth/recovery/verify', 'POST'],
      ['/auth/recovery/regenerate', 'POST'],
    ]) {
      const res = await mf.dispatchFetch(`http://localhost${path}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      assert.equal(res.status, 401, `${method} ${path}`);
      const body = await res.json();
      assert.equal(body.code, 'UNAUTHORIZED', `${method} ${path}`);
    }
  });

  it('passkey login cannot switch an active X session to another account', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 1, ?, ?)`
      )
      .bind('xid_pk_alice', 'pk_alice', 'Alice', now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 1, ?, ?)`
      )
      .bind('xid_pk_bob', 'pk_bob', 'Bob', now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO passkeys (id, x_id, credential_id, public_key, counter, transports, created_at)
         VALUES (?, ?, ?, ?, 0, '[]', ?)`
      )
      .bind('passkey_bob', 'xid_pk_bob', 'credential_bob', '00', now)
      .run();

    const optionsRes = await mf.dispatchFetch('http://localhost/auth/passkey/login-options');
    assert.equal(optionsRes.status, 200);
    const options = await optionsRes.json();

    const session = signTestSession({
      session_id: 'session_alice',
      x_id: 'xid_pk_alice',
      x_handle: 'pk_alice',
      x_name: 'Alice',
      near_account: null,
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });

    const res = await mf.dispatchFetch('http://localhost/auth/passkey/login-verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `uprail_session=${session}`,
      },
      body: JSON.stringify({ assertion: fakeAssertion('credential_bob', options.challenge) }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'ACCOUNT_MISMATCH');
  });

  it('passkey confirmation rejects another account\'s credential', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 1, ?, ?)`
      )
      .bind('xid_pk_carol', 'pk_carol', 'Carol', now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO passkeys (id, x_id, credential_id, public_key, counter, transports, created_at)
         VALUES (?, ?, ?, ?, 0, '[]', ?)`
      )
      .bind('passkey_carol', 'xid_pk_carol', 'credential_carol', '00', now)
      .run();

    const session = signTestSession({
      session_id: 'session_carol',
      x_id: 'xid_pk_carol',
      x_handle: 'pk_carol',
      x_name: 'Carol',
      near_account: null,
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });

    const challengeRes = await mf.dispatchFetch('http://localhost/api/auth-challenge', {
      headers: { Cookie: `uprail_session=${session}` },
    });
    assert.equal(challengeRes.status, 200);
    const challenge = await challengeRes.json();

    const res = await mf.dispatchFetch('http://localhost/auth/passkey/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `uprail_session=${session}`,
      },
      body: JSON.stringify({
        assertion: fakeAssertion('credential_bob', challenge.challenge),
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'ACCOUNT_MISMATCH');
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
        recipientHandle: '@illia',
        asset: 'nep141:wrap.near',
        amount: '1.5',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recipientHandle, '@illia');
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
        recipientHandle: '@illia',
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

  it('GET /api/agent/openapi.json serves OpenAPI 3.1.0 spec for AI chat actions', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/agent/openapi.json');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.openapi, '3.1.0');
    assert.ok(body.paths['/api/agent/pay']);
    assert.ok(body.paths['/api/agent/receive']);
    assert.ok(body.paths['/api/agent/balance']);
    assert.ok(body.paths['/api/agent/payments']);
  });

  it('agent authentication resolves a seeded key, lists MCP tools, and enforces USD spend caps', async () => {
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
        `INSERT INTO agent_keys (id, agent_id, x_id, label, key_hash, key_prefix, per_tx_limit, daily_limit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('key_mcp_1', 'agent_mcp_1', 'xid_mcp_1', 'MCP Agent', keyHash, 'up_agent_aaaaaa', '25', '100', now)
      .run();

    const listed = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    const names = listedBody.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_balance', 'list_payments', 'pay_handle', 'receive_payment', 'resolve_handle']);

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

    // Receive endpoint returns the user's @handle and nearAccount
    const receiveRes = await mf.dispatchFetch('http://localhost/api/agent/receive', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    assert.equal(receiveRes.status, 200);
    const receiveBody = await receiveRes.json();
    assert.equal(receiveBody.handle, '@mcp_tester');
    assert.equal(receiveBody.nearAccount, 'mcp_tester.near');

    // Sending above per-tx limit ($25) in USDC ($1/token) is rejected by policy
    const overLimit = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ recipientHandle: '@alice', asset: 'USDC', amount: 50 }),
    });
    assert.equal(overLimit.status, 403);
    const overLimitBody = await overLimit.json();
    assert.equal(overLimitBody.code, 'AGENT_POLICY_DENIED');
    assert.equal(overLimitBody.reason, 'per_tx_limit');
  });

  it('renders a per-payment OG image instead of the generic static card', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    const paymentId = 'pay_og_card_1';
    await db
      .prepare(
        `INSERT INTO payments
           (id, sender_x_handle, recipient_handle, asset, amount, status,
            created_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(paymentId, 'alice', 'bob', 'USDC', '12.5', 'ESCROWED', now, now + 86400000, now)
      .run();

    const nativeNearId = 'pay_og_card_near';
    await db
      .prepare(
        `INSERT INTO payments
           (id, sender_x_handle, recipient_handle, asset, amount, status,
            created_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(nativeNearId, 'alice', 'bob', 'native:near', '1.25', 'ESCROWED', now, now + 86400000, now)
      .run();

    for (const id of [paymentId, nativeNearId]) {
      const res = await mf.dispatchFetch(`http://localhost/og/claim/${id}.png`);
      assert.equal(res.status, 200, id);
      assert.equal(res.headers.get('content-type'), 'image/png', id);
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual(
        [...bytes.slice(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        id
      );
      assert.ok(bytes.length > 1000, `${id}: expected a rendered PNG`);
    }

    const missing = await mf.dispatchFetch('http://localhost/og/claim/not-a-png');
    assert.equal(missing.status, 404);
  });
});

