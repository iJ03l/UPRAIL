import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, createHmac, randomBytes } from 'node:crypto';
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
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        d1Databases: { DB: 'uprail-db' },
        kvNamespaces: { CACHE: 'cache', OAUTH_KV: 'oauth-kv' },
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
          FEE_PERCENT: '0.01',
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
          OAUTH_ISSUER: 'http://localhost',
          OAUTH_RESOURCE: 'http://localhost/api/mcp',
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
      '0005_launchpad_fees.sql',
      '0007_recovery_codes.sql',
      '0008_recovery_code_ciphertext.sql',
      '0009_remove_launchpad_partners.sql',
      '0010_launchpad_token_bindings.sql',
      '0011_oauth_connections.sql',
      '0012_confidential_rail.sql',
      '0013_contacts_and_requests.sql',
      '0014_add_avatar_url.sql',
      '0015_rescued_deposits.sql',
      '0016_buy_me_a_coffee.sql',
      '0017_circles_and_gifts.sql',
      '0018_self_custody.sql',
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

    // Seed test accounts so offline tests pass without requiring external X network access
    await db.prepare(
      `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
       VALUES ('xid_test_illia', 'illia', 'Illia Polosukhin', 'illia.near', 1, 0, 0),
              ('xid_test_alice', 'alice', 'Alice', 'alice.near', 1, 0, 0)`
    ).run();
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
    assert.deepEqual(body.verificationKinds, ['token_config', 'factory', 'jh_v2_dev']);
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

  it('POST /api/launchpads/register rejects an invalid proof before signer checks', async () => {
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
    assert.equal(body.code, 'INVALID_PROOF');
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
    assert.equal(body.resolved, true);
    assert.equal(body.exists, true);
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
    assert.equal(body.protocolFee, '0.015', 'Must calculate the 1% send fee (1.5 * 0.01 = 0.015)');
    assert.equal(body.recipientAmount, '1.5', 'Recipient receives 100% of quoted amount (fee charged on top)');
    assert.equal(body.totalAmount, '1.515', 'Sender total debited equals amount + protocolFee (1.5 + 0.015)');
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

  it('POST /api/mcp requires OAuth or a Bearer agent key', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /resource_metadata=/);
  });

  it('agent withdrawal and key deletion require authorization', async () => {
    const withdraw = await mf.dispatchFetch('http://localhost/api/agent/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationAddress: 'alice.near', asset: 'USDC', amount: '1' }),
    });
    assert.equal(withdraw.status, 401);
    assert.equal((await withdraw.json()).code, 'AGENT_KEY_REQUIRED');

    const deleteKey = await mf.dispatchFetch('http://localhost/api/agent/keys/akey1/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(deleteKey.status, 401);
  });

  it('GET /api/agent/openapi.json serves OpenAPI 3.1.0 spec for AI chat actions', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/agent/openapi.json');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.openapi, '3.1.0');
    assert.ok(body.paths['/api/agent/pay']);
    assert.ok(body.paths['/api/agent/withdraw']);
    assert.ok(body.paths['/api/agent/receive']);
    assert.ok(body.paths['/api/agent/balance']);
    assert.ok(body.paths['/api/agent/balances']);
    assert.ok(body.paths['/api/agent/payments']);
    assert.equal(body.components.securitySchemes.ApiKeyQuery, undefined);
    assert.deepEqual(body.security, [{ BearerAuth: [] }]);
    assert.ok(
      body.paths['/api/agent/pay'].post.parameters.some((p) => p.name === 'Idempotency-Key')
    );
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
    assert.deepEqual(names, [
      'accept_request',
      'check_approval',
      'decline_request',
      'get_balance',
      'list_contacts',
      'list_payments',
      'list_requests',
      'pay_handle',
      'receive_payment',
      'request_payment',
      'resolve_handle',
      'save_contact',
      'withdraw_to_wallet',
    ]);

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

    const overLimitWithdraw = await mf.dispatchFetch('http://localhost/api/agent/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({
        destinationAddress: 'alice.near',
        asset: 'USDC',
        amount: '50',
      }),
    });
    // Multiple accounts exceeding guardrail limit requests an instant passkey authorization
    const batchOverLimit = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({
        recipients: [
          { handle: '@alice', amount: 20 },
          { handle: '@bob', amount: 20 },
        ],
        asset: 'USDC',
      }),
    });
    assert.equal(batchOverLimit.status, 403);
    const batchBody = await batchOverLimit.json();
    assert.equal(batchBody.status, 'REQUIRES_PASSKEY_APPROVAL');
    assert.equal(batchBody.code, 'APPROVAL_REQUIRED');
    assert.ok(batchBody.approvalId);
    assert.ok(batchBody.approvalUrl.includes(batchBody.approvalId));
    assert.equal(batchBody.totalUsd, 40);
  });

  it('OAuth metadata, DCR, consent, token exchange, and MCP access work end to end', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    const xId = 'xid_oauth_1';

    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(xId, 'oauth_tester', 'OAuth Tester', 'oauth_tester.near', now, now)
      .run();

    const metadata = await mf.dispatchFetch(
      'http://localhost/.well-known/oauth-authorization-server'
    );
    assert.equal(metadata.status, 200);
    const metadataBody = await metadata.json();
    assert.equal(metadataBody.issuer, 'http://localhost');
    assert.ok(metadataBody.authorization_endpoint.endsWith('/authorize'));
    assert.ok(metadataBody.token_endpoint.endsWith('/oauth/token'));
    assert.ok(metadataBody.registration_endpoint.endsWith('/oauth/register'));
    assert.ok(metadataBody.scopes_supported.includes('mcp'));

    const resourceMetadata = await mf.dispatchFetch(
      'http://localhost/.well-known/oauth-protected-resource/api/mcp'
    );
    assert.equal(resourceMetadata.status, 200);
    const resourceBody = await resourceMetadata.json();
    assert.equal(resourceBody.resource, 'http://localhost/api/mcp');
    assert.deepEqual(resourceBody.authorization_servers, ['http://localhost']);

    const redirectUri = 'http://localhost/oauth/callback';
    const registration = await mf.dispatchFetch('http://localhost/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Miniflare AI',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    assert.equal(registration.status, 201);
    const client = await registration.json();
    assert.ok(client.client_id);

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = 'state_oauth_test';
    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'mcp',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: 'http://localhost/api/mcp',
    });
    const session = signTestSession({
      session_id: 'session_oauth_1',
      x_id: xId,
      x_handle: 'oauth_tester',
      x_name: 'OAuth Tester',
      near_account: 'oauth_tester.near',
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });
    const sessionCookie = `uprail_session=${session}`;

    const consent = await mf.dispatchFetch(
      `http://localhost/authorize?${authorizeParams.toString()}`,
      { headers: { Cookie: sessionCookie } }
    );
    assert.equal(consent.status, 200);
    const consentHtml = await consent.text();
    assert.match(consentHtml, /Connect Miniflare AI/);
    assert.match(consentHtml, /name="connection_days"/);
    const handle = /name="handle" value="([^"]+)"/.exec(consentHtml)?.[1];
    assert.ok(handle, 'consent page must carry a security handle');

    const consentCookies = (
      typeof consent.headers.getSetCookie === 'function'
        ? consent.headers.getSetCookie()
        : [consent.headers.get('set-cookie') || '']
    )
      .filter(Boolean)
      .map((cookie) => cookie.split(';')[0]);
    const cookieHeader = [sessionCookie, ...consentCookies].join('; ');

    const approval = await mf.dispatchFetch('http://localhost/authorize/approve', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        handle,
        per_tx_limit: '25',
        daily_limit: '100',
        connection_days: '30',
      }).toString(),
      redirect: 'manual',
    });
    assert.equal(approval.status, 302);
    const location = approval.headers.get('location');
    assert.ok(location, 'approval must redirect back to the client');
    const redirect = new URL(location);
    assert.equal(redirect.origin + redirect.pathname, redirectUri);
    assert.equal(redirect.searchParams.get('state'), state);
    const code = redirect.searchParams.get('code');
    assert.ok(code);

    const token = await mf.dispatchFetch('http://localhost/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
      }).toString(),
    });
    assert.equal(token.status, 200);
    const tokenBody = await token.json();
    assert.ok(tokenBody.access_token);
    assert.ok(tokenBody.refresh_token);
    assert.equal(String(tokenBody.token_type).toLowerCase(), 'bearer');

    const mcp = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenBody.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/list' }),
    });
    assert.equal(mcp.status, 200);
    assert.equal((await mcp.json()).result.tools.length, 13);

    const listed = await mf.dispatchFetch('http://localhost/api/agent/keys', {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    const connection = listedBody.keys.find((key) => key.authMethod === 'oauth');
    assert.ok(connection, 'OAuth connection must appear in the dashboard list');
    assert.equal(connection.oauthClientName, 'Miniflare AI');
    assert.equal(connection.connectionStatus, 'active');
    assert.ok(connection.oauthGrantId);
    assert.ok(connection.expiresAt > Date.now() + 29 * 86400 * 1000);
    assert.ok(connection.expiresAt < Date.now() + 31 * 86400 * 1000);

    await db
      .prepare('UPDATE agent_keys SET revoked_at = ? WHERE id = ?')
      .bind(Date.now(), connection.id)
      .run();
    const afterRevoke = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenBody.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tools/list' }),
    });
    assert.equal(afterRevoke.status, 403);
    const afterRevokeBody = await afterRevoke.json();
    assert.equal(afterRevokeBody.code, 'AGENT_KEY_REVOKED');
  });

  it('agent rail rejects wallet recipients, removes query keys, and prevents retry double-pays', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    const rawKey = 'up_agent_' + 'b'.repeat(48);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    await db
      .prepare(
        `INSERT INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind('xid_audit_1', 'audit_tester', 'Audit Tester', 'audit_tester.near', now, now)
      .run();
    await db
      .prepare(
        'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind('agent_audit_1', 'xid_audit_1', 'Audit Agent', 'autonomous', now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO agent_keys (id, agent_id, x_id, label, key_hash, key_prefix, per_tx_limit, daily_limit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('key_audit_1', 'agent_audit_1', 'xid_audit_1', 'Audit Agent', keyHash, 'up_agent_bbbbbb', '25', '100', now)
      .run();

    const addressAttempt = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ recipientHandle: 'alice.other', asset: 'USDC', amount: 1 }),
    });
    assert.equal(addressAttempt.status, 403);
    const addressBody = await addressAttempt.json();
    assert.equal(addressBody.code, 'AGENT_POLICY_DENIED');
    assert.equal(addressBody.reason, 'recipient_not_handle');

    const restQueryKey = await mf.dispatchFetch(
      `http://localhost/api/agent/receive?key=${encodeURIComponent(rawKey)}`
    );
    assert.equal(restQueryKey.status, 401);
    assert.equal((await restQueryKey.json()).code, 'AGENT_KEY_REQUIRED');

    const mcpQueryKey = await mf.dispatchFetch(
      `http://localhost/api/mcp?key=${encodeURIComponent(rawKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list' }),
      }
    );
    assert.equal(mcpQueryKey.status, 401);
    assert.match(mcpQueryKey.headers.get('www-authenticate') || '', /resource_metadata=/);

    await db
      .prepare(
        `INSERT INTO agent_requests (id, agent_key_id, idempotency_key, payment_id, status, created_at)
         VALUES (?, ?, ?, ?, 'COMPLETED', ?)`
      )
      .bind('req_completed_1', 'key_audit_1', 'idem-completed', 'pay_idem_completed', now)
      .run();
    const replay = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawKey}`,
        'Idempotency-Key': 'idem-completed',
      },
      body: JSON.stringify({ recipientHandle: '@alice', asset: 'USDC', amount: 1 }),
    });
    assert.equal(replay.status, 409);
    const replayBody = await replay.json();
    assert.equal(replayBody.code, 'AGENT_REQUEST_ALREADY_COMPLETED');
    assert.equal(replayBody.paymentId, 'pay_idem_completed');

    await db
      .prepare(
        `INSERT INTO agent_requests (id, agent_key_id, idempotency_key, payment_id, status, created_at)
         VALUES (?, ?, ?, NULL, 'PENDING', ?)`
      )
      .bind('req_pending_1', 'key_audit_1', 'idem-pending', now)
      .run();
    const inProgress = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawKey}`,
        'Idempotency-Key': 'idem-pending',
      },
      body: JSON.stringify({ recipientHandle: '@alice', asset: 'USDC', amount: 1 }),
    });
    assert.equal(inProgress.status, 409);
    assert.equal((await inProgress.json()).code, 'AGENT_REQUEST_IN_PROGRESS');

    // Server-side intent fingerprint catches LLM retries that mutate or omit Idempotency-Key
    const fpHash = createHash('sha256').update('pay|USDC|alice:1').digest('hex');
    const fpKey = `fp:${fpHash.slice(0, 48)}`;
    await db
      .prepare(
        `INSERT INTO agent_requests (id, agent_key_id, idempotency_key, payment_id, status, created_at)
         VALUES (?, ?, ?, ?, 'COMPLETED', ?)`
      )
      .bind('req_fp_completed_1', 'key_audit_1', fpKey, 'pay_fp_completed', now)
      .run();

    const mutatedKeyRetry = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawKey}`,
        'Idempotency-Key': 'usdc-1-alice-retry-2',
      },
      body: JSON.stringify({ recipientHandle: '@alice', asset: 'USDC', amount: '1.00' }),
    });
    assert.equal(mutatedKeyRetry.status, 409);
    const mutatedBody = await mutatedKeyRetry.json();
    assert.equal(mutatedBody.code, 'AGENT_REQUEST_ALREADY_COMPLETED');
    assert.equal(mutatedBody.alreadyCompleted, true);
    assert.equal(mutatedBody.retryable, false);
    assert.equal(mutatedBody.paymentId, 'pay_fp_completed');
    assert.ok(mutatedBody.shareLink.endsWith('/claim/pay_fp_completed'));

    const omittedKeyRetry = await mf.dispatchFetch('http://localhost/api/agent/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawKey}`,
      },
      body: JSON.stringify({ recipientHandle: '@ALICE', asset: 'usdc', amount: 1 }),
    });
    assert.equal(omittedKeyRetry.status, 409);
    const omittedBody = await omittedKeyRetry.json();
    assert.equal(omittedBody.code, 'AGENT_REQUEST_ALREADY_COMPLETED');
    assert.equal(omittedBody.paymentId, 'pay_fp_completed');

    await db
      .prepare(
        `INSERT INTO payments
           (id, sender_x_handle, recipient_x_id, recipient_handle, asset, amount, status,
            created_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'pay_handle_reuse_1',
        'mallory',
        'xid_other',
        'audit_tester',
        'USDC',
        '1',
        'ESCROWED',
        now,
        now + 86400000,
        now
      )
      .run();
    const history = await mf.dispatchFetch('http://localhost/api/agent/payments', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    assert.equal(history.status, 200);
    const historyBody = await history.json();
    assert.ok(!historyBody.payments.some((p) => p.id === 'pay_handle_reuse_1'));
    assert.equal(history.headers.get('cache-control'), 'no-store');

    const mcpReceive = await mf.dispatchFetch('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'receive_payment', arguments: {} },
      }),
    });
    assert.equal(mcpReceive.status, 200);
    const mcpReceiveBody = await mcpReceive.json();
    const mcpReceivePayload = JSON.parse(mcpReceiveBody.result.content[0].text);
    assert.ok(!mcpReceivePayload.pendingPayments.some((p) => p.id === 'pay_handle_reuse_1'));
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

  it('renders a dynamic creator-fee OG image with short cache headers', async () => {
    const res = await mf.dispatchFetch('http://localhost/og/fees/fee_preview.png?asset=near');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60, s-maxage=60');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(bytes.length > 1000);

    const missing = await mf.dispatchFetch('http://localhost/og/fees/not-a-handle.png?asset=near');
    assert.equal(missing.status, 404);

    const missingAsset = await mf.dispatchFetch('http://localhost/og/fees/fee_preview.png');
    assert.equal(missingAsset.status, 404);
  });

  it('serves all 6 curated Earn Vaults and renders Gift OG card + crawler SEO meta tags', async () => {
    const vaultsRes = await mf.dispatchFetch('http://localhost/api/gifts/vaults');
    assert.equal(vaultsRes.status, 200);
    const vaultsBody = await vaultsRes.json();
    assert.equal(vaultsBody.vaults.length, 6);
    assert.deepEqual(
      vaultsBody.vaults.map((v) => v.symbol),
      ['gtUSDCp', 'TLO', 'wstETH', 'stNEAR', 'cNEAR', 'kV-gtSOLb']
    );
    const gtUsdc = vaultsBody.vaults.find((v) => v.symbol === 'gtUSDCp');
    const stNear = vaultsBody.vaults.find((v) => v.symbol === 'stNEAR');
    assert.equal(gtUsdc.principalType, 'usd_stable');
    assert.equal(gtUsdc.riskTier, 'core');
    assert.equal(gtUsdc.requiresRiskAck, false);
    assert.equal(stNear.principalType, 'volatile_crypto');
    assert.equal(stNear.requiresRiskAck, true);

    const db = await mf.getD1Database('DB');
    const now = Date.now();
    const giftId = 'gft_0123456789abcdef01234567';
    const timelockUntil = now + 7 * 86400 * 1000;

    await db
      .prepare(
        `INSERT INTO gifts
           (id, sender_x_id, sender_handle, recipient_handle,
            occasion, message, show_amount, vault_asset_id, vault_symbol,
            vault_decimals, source_asset, source_symbol, source_decimals,
            gross_atomic, principal_usd_cents, custody_account,
            quoted_shares_atomic, shares_atomic, timelock_until, status,
            expires_at, created_at, updated_at, funded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCKED', ?, ?, ?, ?)`
      )
      .bind(
        giftId,
        'xid_test_alice',
        'alice',
        'illia',
        'BIRTHDAY',
        'Compounding in Taler USDC until your birthday!',
        0,
        'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
        'TLO',
        8,
        'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        'USDC',
        6,
        '50000000',
        4950,
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '4950000000',
        '4950000000',
        timelockUntil,
        now + 3600000,
        now,
        now,
        now
      )
      .run();

    // 1. Public card view hides amount when show_amount = 0
    const pubRes = await mf.dispatchFetch(`http://localhost/api/gifts/public/${giftId}`);
    assert.equal(pubRes.status, 200);
    const pubBody = await pubRes.json();
    assert.equal(pubBody.gift.recipientHandle, 'illia');
    assert.equal(pubBody.gift.vaultSymbol, 'TLO');
    assert.equal(pubBody.gift.principalUsdCents, undefined);

    // 2. Dynamic OG PNG renders valid PNG bytes
    const ogRes = await mf.dispatchFetch(`http://localhost/og/gift/${giftId}.png`);
    assert.equal(ogRes.status, 200);
    assert.equal(ogRes.headers.get('content-type'), 'image/png');
    const ogBytes = new Uint8Array(await ogRes.arrayBuffer());
    assert.deepEqual([...ogBytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(ogBytes.length > 1000);

    // 3. Crawler request to /gift/:id returns customized OG tags
    const botRes = await mf.dispatchFetch(`http://localhost/gift/${giftId}`, {
      headers: { 'User-Agent': 'Twitterbot/1.0' },
    });
    assert.equal(botRes.status, 200);
    const botHtml = await botRes.text();
    assert.ok(botHtml.includes(`/og/gift/${giftId}.png`));
    assert.ok(botHtml.includes('@illia'));
    assert.ok(botHtml.includes('TLO'));
  });

  it('rejects non-self-custody and escrow mode creation on Circle and Gift routes', async () => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    await db
      .prepare(
        `INSERT OR IGNORE INTO x_identities (x_id, x_handle, x_name, near_account, is_activated, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 1, ?, ?)`
      )
      .bind('xid_sc_only_test', 'sc_only_test', 'SC Test', now, now)
      .run();

    const session = signTestSession({
      session_id: 'session_sc_only_test',
      x_id: 'xid_sc_only_test',
      x_handle: 'sc_only_test',
      x_name: 'SC Test',
      near_account: null,
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });
    const headers = {
      'Content-Type': 'application/json',
      Cookie: `uprail_session=${session}`,
    };

    const legacyCircleRes = await mf.dispatchFetch('http://localhost/api/circles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Legacy Test', vaultAsset: 'TLO', targetAmountUsd: 50 }),
    });
    assert.equal(legacyCircleRes.status, 403);
    assert.equal((await legacyCircleRes.json()).code, 'SELF_CUSTODY_REQUIRED');

    const legacyGiftRes = await mf.dispatchFetch('http://localhost/api/gifts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipientHandle: 'illia', vaultAsset: 'TLO', amount: '10' }),
    });
    assert.equal(legacyGiftRes.status, 403);
    assert.equal((await legacyGiftRes.json()).code, 'SELF_CUSTODY_REQUIRED');

    const escrowCirclePrep = await mf.dispatchFetch('http://localhost/api/circles/create/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'escrow', name: 'Escrow Circle' }),
    });
    assert.equal(escrowCirclePrep.status, 400);
    assert.equal((await escrowCirclePrep.json()).code, 'SELF_CUSTODY_ONLY');

    const escrowGiftPrep = await mf.dispatchFetch('http://localhost/api/gifts/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'escrow', recipientHandle: 'illia', vaultAsset: 'TLO', amount: '10' }),
    });
    assert.equal(escrowGiftPrep.status, 400);
    assert.equal((await escrowGiftPrep.json()).code, 'SELF_CUSTODY_ONLY');
  });

  it('reserves /verify route and does not treat it as @verify coffee handle', async () => {
    const postRes = await mf.dispatchFetch('http://localhost/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsd: 5, originSymbol: 'USDC', originChain: 'base' }),
    });
    assert.equal(postRes.status, 404);
    assert.equal((await postRes.json()).code, 'NOT_FOUND');

    const botJsonRes = await mf.dispatchFetch('http://localhost/verify?format=json', {
      headers: { 'User-Agent': 'Twitterbot/1.0' },
    });
    assert.equal(botJsonRes.headers.get('content-type')?.includes('text/html'), true);

    const botRes = await mf.dispatchFetch('http://localhost/verify', {
      headers: { 'User-Agent': 'Twitterbot/1.0' },
    });
    const html = await botRes.text();
    assert.equal(html.includes('PAY ME HERE — @verify'), false);
    assert.equal(html.includes('/og/coffee/verify.png'), false);
  });

  it('GET /api/onchain/deposit-address validates swapType query param', async () => {
    const now = Date.now();
    const session = signTestSession({
      session_id: 'session_swap_type_test',
      x_id: 'xid_sc_only_test',
      x_handle: 'sc_only_test',
      x_name: 'SC Test',
      near_account: null,
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });
    const res = await mf.dispatchFetch(
      'http://localhost/api/onchain/deposit-address?chain=near&token=USDC&swapType=INVALID_MODE',
      {
        headers: {
          Cookie: `uprail_session=${session}`,
        },
      }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_SWAP_TYPE');
  });

  it('sets Content-Security-Policy frame-src to allow Coinbase and PingPay onramp while keeping frame-ancestors none', async () => {
    const res = await mf.dispatchFetch('http://localhost/health');
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /frame-src 'self' https:\/\/pay\.coinbase\.com https:\/\/onramp\.pingpay\.io https:\/\/pay\.pingpay\.io/);
  });

  it('POST /api/pingpay/quote blocks CRYPTO method and validates authenticated caller', async () => {
    const unauth = await mf.dispatchFetch('http://localhost/api/pingpay/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '25', paymentMethod: 'APPLE_PAY' }),
    });
    assert.equal(unauth.status, 401);

    const now = Date.now();
    const session = signTestSession({
      session_id: 'session_pingpay_test',
      x_id: 'xid_pp_test',
      x_handle: 'pp_tester',
      x_name: 'PP Tester',
      near_account: null,
      passkey_verified: true,
      passkey_verified_at: now,
      created_at: now,
      expires_at: now + 60 * 60 * 1000,
    });
    for (const disallowed of ['CRYPTO', 'COINBASE', 'CASH_APP', 'CARD']) {
      const blocked = await mf.dispatchFetch('http://localhost/api/pingpay/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `uprail_session=${session}`,
        },
        body: JSON.stringify({ amount: '25', paymentMethod: disallowed }),
      });
      assert.equal(blocked.status, 400, `expected 400 for disallowed method ${disallowed}`);
      const body = await blocked.json();
      assert.equal(body.code, 'INVALID_REQUEST');
    }
  });
});
