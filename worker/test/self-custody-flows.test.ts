import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode, base58Encode } from '../src/utils/base58';
import {
  NativeL1KeyGrant,
  issueNativeL1Grant,
  revokeNativeL1Grant,
  verifyNativeL1Grant,
} from '../src/services/nativeL1Grant';
import {
  assertServerOrGrantedNativeL1ForXId,
  SelfCustodySignatureRequiredError,
} from '../src/services/nearRpc';
import {
  getAttestorPublicKey,
  signHandleAttestation,
  signContractPayloadWithServerUserKey,
} from '../src/services/circleContract';
import {
  prepareSelfCustodyCircleCreate,
  prepareSelfCustodyGiftClaim,
  prepareSelfCustodyGiftReclaim,
} from '../src/services/selfCustodyVaultOps';
import { listUserCircles } from '../src/services/circles';
import { CustodyActionError } from '../src/services/custodyService';

function makeTestNearPrivateKey(fillByte: number): { priv: string; pub: string; pubRaw: Uint8Array } {
  const seed = new Uint8Array(32).fill(fillByte);
  const pubRaw = ed25519.getPublicKey(seed);
  const key64 = new Uint8Array(64);
  key64.set(seed, 0);
  key64.set(pubRaw, 32);
  return {
    priv: `ed25519:${base58Encode(key64)}`,
    pub: `ed25519:${base58Encode(pubRaw)}`,
    pubRaw,
  };
}

function makeTestP256NearPubkey(fillByte: number): string {
  const raw = new Uint8Array(64).fill(fillByte);
  return `p256:${base58Encode(raw)}`;
}

const TEST_ESCROW_KP = makeTestNearPrivateKey(0x11);
const TEST_ATTESTOR_KP = makeTestNearPrivateKey(0x22);

const MOCK_TOKENS = [
  {
    assetId: 'nep141:meta-pool.near',
    symbol: 'stNEAR',
    decimals: 24,
    blockchain: 'near',
    price: 5.71,
  },
  {
    assetId: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    symbol: 'TLO',
    decimals: 8,
    blockchain: 'eth',
    price: 1.05,
  },
];

interface MockDbFixture {
  identities?: any[];
  passkeys?: any[];
  gifts?: any[];
  circles?: any[];
  circleMembers?: any[];
  circleContributions?: any[];
  pendingActions?: any[];
}

function createMockDb(fixture: MockDbFixture) {
  const state = {
    identities: [...(fixture.identities || [])],
    passkeys: [...(fixture.passkeys || [])],
    gifts: [...(fixture.gifts || [])],
    circles: [...(fixture.circles || [])],
    circleMembers: [...(fixture.circleMembers || [])],
    circleContributions: [...(fixture.circleContributions || [])],
    pendingActions: [...(fixture.pendingActions || [])],
  };

  function runQuery(sqlRaw: string, bindings: any[]) {
    const sql = sqlRaw.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT custody_mode FROM x_identities WHERE near_account = ?')) {
      const [nearAccount] = bindings;
      const row = state.identities.find((i) => i.near_account === nearAccount) || null;
      return { first: row, results: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT custody_mode, near_account, backup_pubkey')) {
      const [xId] = bindings;
      const row = state.identities.find((i) => i.x_id === xId) || null;
      return { first: row, results: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT x_id, x_handle, near_account, is_activated, custody_mode FROM x_identities WHERE LOWER(x_handle) = ?')) {
      const [handle] = bindings;
      const row = state.identities.find((i) => String(i.x_handle).toLowerCase() === String(handle).toLowerCase()) || null;
      return { first: row, results: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT id, x_id, credential_id, public_key, near_p256_pubkey, onchain_added_at')) {
      const [xId] = bindings;
      const results = state.passkeys.filter((p) => p.x_id === xId);
      return { first: results[0] || null, results };
    }

    if (sql.startsWith('SELECT near_p256_pubkey FROM passkeys WHERE x_id = ?')) {
      const [xId] = bindings;
      const requireOnchain = sql.includes('onchain_added_at IS NOT NULL');
      const results = state.passkeys.filter(
        (p) =>
          p.x_id === xId &&
          p.near_p256_pubkey != null &&
          (!requireOnchain || p.onchain_added_at != null)
      );
      return { first: results[0] || null, results };
    }

    if (sql.startsWith('INSERT INTO pending_custody_actions')) {
      const [id, x_id, action_type, challenge_digest, payload_json, meta_json, expires_at, created_at] = bindings;
      const row = {
        id,
        x_id,
        action_type,
        challenge_digest,
        payload_json,
        meta_json,
        expires_at,
        used_at: null,
        created_at,
      };
      state.pendingActions.push(row);
      return { first: row, results: [row], meta: { changes: 1 } };
    }

    if (sql.startsWith('SELECT * FROM gifts WHERE id = ?')) {
      const [giftId] = bindings;
      const row = state.gifts.find((g) => g.id === giftId) || null;
      return { first: row, results: row ? [row] : [] };
    }

    if (sql.startsWith('UPDATE circle_members SET x_id = ? WHERE LOWER(x_handle) = ?')) {
      const [xId, handle] = bindings;
      let changes = 0;
      for (const m of state.circleMembers) {
        if (String(m.x_handle).toLowerCase() === String(handle).toLowerCase() && m.x_id == null) {
          m.x_id = xId;
          changes++;
        }
      }
      return { first: null, results: [], meta: { changes } };
    }

    if (sql.startsWith('SELECT DISTINCT c.* FROM circles c LEFT JOIN circle_members m')) {
      const [creatorXId, memberXId, memberHandle] = bindings;
      const matchedIds = new Set<string>();
      for (const c of state.circles) {
        if (c.creator_x_id === creatorXId) matchedIds.add(c.id);
      }
      for (const m of state.circleMembers) {
        if (
          m.x_id === memberXId ||
          (memberHandle && String(m.x_handle).toLowerCase() === String(memberHandle).toLowerCase())
        ) {
          matchedIds.add(m.circle_id);
        }
      }
      const results = state.circles
        .filter((c) => matchedIds.has(c.id))
        .sort((a, b) => Number(b.created_at) - Number(a.created_at));
      return { first: results[0] || null, results };
    }

    if (sql.startsWith('SELECT * FROM circle_members WHERE circle_id = ?')) {
      const [circleId] = bindings;
      const results = state.circleMembers.filter((m) => m.circle_id === circleId);
      return { first: results[0] || null, results };
    }

    if (sql.startsWith('SELECT * FROM circle_contributions WHERE circle_id = ?')) {
      const [circleId] = bindings;
      const results = state.circleContributions.filter((c) => c.circle_id === circleId);
      return { first: results[0] || null, results };
    }

    throw new Error(`Unhandled SQL in mock DB: ${sql}`);
  }

  return {
    state,
    prepare(sql: string) {
      let bindings: any[] = [];
      const stmt: any = {
        bind(...args: any[]) {
          bindings = args;
          return stmt;
        },
        async first() {
          return runQuery(sql, bindings).first;
        },
        async all() {
          return { results: runQuery(sql, bindings).results };
        },
        async run() {
          const r = runQuery(sql, bindings);
          return { success: true, meta: r.meta || { changes: 0 } };
        },
      };
      return stmt;
    },
  };
}

async function withMockFetch<T>(
  rpcViewHandlers: Record<string, (args: any) => any>,
  fn: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/v0/tokens')) {
      return new Response(JSON.stringify(MOCK_TOKENS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (init?.body) {
      const rpcReq = JSON.parse(String(init.body));
      const params = rpcReq.params || {};
      if (params.request_type === 'call_function') {
        const argsStr = Buffer.from(String(params.args_base64 || ''), 'base64').toString('utf8');
        const args = argsStr ? JSON.parse(argsStr) : {};
        const handler = rpcViewHandlers[params.method_name];
        const value = handler ? handler(args) : null;
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (params.request_type === 'view_access_key_list') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: rpcReq.id, result: { keys: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (params.request_type === 'view_account') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { amount: '100000000000000000000000' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    throw new Error(`Unexpected fetch call during unit test: ${url}`);
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('NativeL1KeyGrant prevents forging, enforces scope/xId/target/asset/expiry, and revokes cleanly', () => {
  const forged = new NativeL1KeyGrant('native_withdraw:wrap.near:bob.near');
  assert.equal(
    verifyNativeL1Grant(forged, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'bob.near',
      asset: 'wrap.near',
    }),
    false
  );

  const valid = issueNativeL1Grant({
    xId: 'xid_alice',
    operation: 'native_withdraw',
    asset: 'wrap.near',
    target: 'bob.near',
    feeTarget: 'fees.uprail.near',
  });

  // Matches primary target & feeTarget for the rightful owner & operation
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'BOB.NEAR',
      asset: 'wrap.near',
    }),
    true
  );
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'fees.uprail.near',
      asset: 'wrap.near',
    }),
    true
  );

  // Rejects mismatched user, operation, target, or asset
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_mallory',
      allowedOperations: ['native_withdraw'],
      target: 'bob.near',
      asset: 'wrap.near',
    }),
    false
  );
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_send'],
      target: 'bob.near',
      asset: 'wrap.near',
    }),
    false
  );
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'mallory.near',
      asset: 'wrap.near',
    }),
    false
  );
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'bob.near',
      asset: 'usdt.tether-token.near',
    }),
    false
  );

  revokeNativeL1Grant(valid);
  assert.equal(
    verifyNativeL1Grant(valid, {
      xId: 'xid_alice',
      allowedOperations: ['native_withdraw'],
      target: 'bob.near',
      asset: 'wrap.near',
    }),
    false
  );

  const expired = issueNativeL1Grant({
    xId: 'xid_alice',
    operation: 'sweep_to_intents',
    asset: '*',
    target: 'intents.near',
    ttlMs: -10,
  });
  assert.equal(
    verifyNativeL1Grant(expired, {
      xId: 'xid_alice',
      allowedOperations: ['sweep_to_intents'],
      target: 'intents.near',
      asset: 'wrap.near',
    }),
    false
  );
});

test('assertServerOrGrantedNativeL1ForXId requires scoped passkey-minted grant only for self-custody', async () => {
  const db = createMockDb({
    identities: [
      {
        x_id: 'xid_server',
        x_handle: 'serveruser',
        near_account: 'u_srv.escrow.uprail.near',
        custody_mode: 'server',
        backup_pubkey: null,
        self_custody_at: null,
        self_custody_version: 0,
      },
      {
        x_id: 'xid_self',
        x_handle: 'selfuser',
        near_account: 'u_self.escrow.uprail.near',
        custody_mode: 'self',
        backup_pubkey: TEST_ATTESTOR_KP.pub,
        self_custody_at: 1700000000000,
        self_custody_version: 1,
      },
    ],
  });
  const env: any = { DB: db };

  // Server-custody user is allowed without a grant
  await assertServerOrGrantedNativeL1ForXId(env, 'xid_server', undefined, {
    allowedOperations: ['native_send'],
    target: 'alice.near',
    asset: 'wrap.near',
  });

  // Self-custody user without a grant fails closed
  await assert.rejects(
    () =>
      assertServerOrGrantedNativeL1ForXId(env, 'xid_self', undefined, {
        allowedOperations: ['native_send'],
        target: 'alice.near',
        asset: 'wrap.near',
      }),
    (err: any) => err instanceof SelfCustodySignatureRequiredError
  );

  const grant = issueNativeL1Grant({
    xId: 'xid_self',
    operation: 'native_send',
    asset: 'wrap.near',
    target: 'alice.near',
  });

  // Matching grant succeeds
  await assertServerOrGrantedNativeL1ForXId(env, 'xid_self', grant, {
    allowedOperations: ['native_send'],
    target: 'alice.near',
    asset: 'wrap.near',
  });

  // Same grant for wrong destination target is blocked
  await assert.rejects(
    () =>
      assertServerOrGrantedNativeL1ForXId(env, 'xid_self', grant, {
        allowedOperations: ['native_send'],
        target: 'evil.near',
        asset: 'wrap.near',
      }),
    (err: any) => err instanceof SelfCustodySignatureRequiredError
  );
});

test('ATTESTOR_PRIVATE_KEY is strictly isolated from ESCROW_PRIVATE_KEY for handle attestations', async () => {
  const noAttestorEnv: any = {
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ESCROW_NEAR_ACCOUNT: 'escrow.uprail.near',
  };
  assert.equal(getAttestorPublicKey(noAttestorEnv), null);
  assert.throws(
    () => signHandleAttestation(noAttestorEnv, 'uprail:claim:bob'),
    /ATTESTOR_PRIVATE_KEY is not configured/
  );

  const validEnv: any = {
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ATTESTOR_PRIVATE_KEY: TEST_ATTESTOR_KP.priv,
  };
  const pub = getAttestorPublicKey(validEnv);
  assert.equal(pub, TEST_ATTESTOR_KP.pub);
  assert.notEqual(pub, TEST_ESCROW_KP.pub);

  const payload = 'uprail:gift:claim:gift_1:u_bob.escrow.uprail.near:9999999999';
  const sigStr = signHandleAttestation(validEnv, payload);
  assert.ok(sigStr.startsWith('ed25519:'));
  const sigBytes = base58Decode(sigStr.slice('ed25519:'.length));
  assert.equal(
    ed25519.verify(sigBytes, new TextEncoder().encode(payload), TEST_ATTESTOR_KP.pubRaw),
    true
  );
  assert.equal(
    ed25519.verify(sigBytes, new TextEncoder().encode(payload), TEST_ESCROW_KP.pubRaw),
    false
  );

  // Server contract payload signer rejects 'self' custody users fail-closed
  const db = createMockDb({
    identities: [
      {
        x_id: 'xid_self',
        x_handle: 'alice',
        near_account: 'u_alice.escrow.uprail.near',
        custody_mode: 'self',
      },
    ],
  });
  await assert.rejects(
    () => signContractPayloadWithServerUserKey({ ...validEnv, DB: db }, 'xid_self', 'payload'),
    (err: any) => err instanceof SelfCustodySignatureRequiredError
  );
});

test('Self-Custody Gift claim & 30d reclaim enforce timelocks, anti-IDOR, signer binding, and dual escrow/contract modes', async () => {
  const now = Date.now();
  const alicePub = makeTestP256NearPubkey(0x31);
  const bobPub = makeTestP256NearPubkey(0x32);
  const unlockFuture = now + 7 * 86_400_000;
  const unlockRecent = now - 5 * 86_400_000; // unlocked, but < 30d reclaim grace
  const unlockOld = now - 35 * 86_400_000;   // > 30d post-unlock reclaimable

  const db = createMockDb({
    identities: [
      {
        x_id: 'xid_alice',
        x_handle: 'alice',
        near_account: 'u_alice.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
      {
        x_id: 'xid_bob',
        x_handle: 'bob',
        near_account: 'u_bob.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
      {
        x_id: 'xid_mallory',
        x_handle: 'mallory',
        near_account: 'u_mallory.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
    ],
    passkeys: [
      {
        id: 'pk_alice',
        x_id: 'xid_alice',
        credential_id: 'cred_alice',
        public_key: 'p256_cose_alice',
        near_p256_pubkey: alicePub,
        onchain_added_at: now - 10_000,
        counter: 0,
        transports: '["internal"]',
        created_at: now - 10_000,
      },
      {
        id: 'pk_bob',
        x_id: 'xid_bob',
        credential_id: 'cred_bob',
        public_key: 'p256_cose_bob',
        near_p256_pubkey: bobPub,
        onchain_added_at: now - 10_000,
        counter: 0,
        transports: '["internal"]',
        created_at: now - 10_000,
      },
    ],
    gifts: [
      {
        id: 'gft_locked',
        sender_x_id: 'xid_alice',
        sender_handle: 'alice',
        recipient_x_id: 'xid_bob',
        recipient_handle: 'bob',
        status: 'LOCKED',
        timelock_until: unlockFuture,
        contract_mode: 'escrow',
        escrow_contract_id: null,
        onchain_gift_id: null,
        vault_asset_id: 'nep141:meta-pool.near',
        shares_atomic: '1000000000000000000',
      },
      {
        id: 'gft_escrow_ready',
        sender_x_id: 'xid_alice',
        sender_handle: 'alice',
        recipient_x_id: 'xid_bob',
        recipient_handle: 'bob',
        status: 'LOCKED',
        timelock_until: unlockRecent,
        contract_mode: 'escrow',
        escrow_contract_id: null,
        onchain_gift_id: null,
        vault_asset_id: 'nep141:meta-pool.near',
        shares_atomic: '2000000000000000000',
      },
      {
        id: 'gft_contract_old',
        sender_x_id: 'xid_alice',
        sender_handle: 'alice',
        recipient_x_id: 'xid_bob',
        recipient_handle: 'bob',
        status: 'LOCKED',
        timelock_until: unlockOld,
        contract_mode: 'contract',
        escrow_contract_id: 'circle.uprail.near',
        onchain_gift_id: 'gft_contract_old',
        vault_asset_id: 'nep141:meta-pool.near',
        shares_atomic: '3000000000000000000',
      },
    ],
  });

  const env: any = {
    DB: db,
    CIRCLE_CONTRACT_ID: 'circle.uprail.near',
    APP_URL: 'https://app.uprail.world',
    RP_ID: 'app.uprail.world',
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ATTESTOR_PRIVATE_KEY: TEST_ATTESTOR_KP.priv,
  };

  const aliceSession: any = { id: 'sa', x_id: 'xid_alice', x_handle: 'alice', x_name: 'Alice' };
  const bobSession: any = { id: 'sb', x_id: 'xid_bob', x_handle: 'bob', x_name: 'Bob' };
  const mallorySession: any = { id: 'sm', x_id: 'xid_mallory', x_handle: 'mallory', x_name: 'Mallory' };

  await withMockFetch(
    {
      current_salt: () => '00000000000000000000000000000001',
      get_gift: (args) => ({
        id: args.gift_id,
        sender_account_id: 'u_alice.escrow.uprail.near',
        sender_pubkey: alicePub,
        recipient_handle_hash: '00'.repeat(32),
        recipient_pubkey: bobPub,
        asset: { rail: 'intents', token_id: 'nep141:meta-pool.near' },
        amount: '3000000000000000000',
        unlock_at_ms: unlockOld,
        reclaim_after_ms: now - 5 * 86_400_000,
        status: 'LOCKED',
        created_at_ms: unlockOld - 86_400_000,
      }),
    },
    async () => {
      // 1. Timelock prevents early recipient claim
      await assert.rejects(
        () => prepareSelfCustodyGiftClaim({ env, session: bobSession, giftId: 'gft_locked' }),
        (err: any) => err instanceof CustodyActionError && err.code === 'TIMELOCK_ACTIVE'
      );

      // 2. Anti-IDOR prevents third party or sender from claiming recipient's gift
      await assert.rejects(
        () => prepareSelfCustodyGiftClaim({ env, session: mallorySession, giftId: 'gft_escrow_ready' }),
        (err: any) => err instanceof CustodyActionError && err.code === 'FORBIDDEN'
      );
      await assert.rejects(
        () => prepareSelfCustodyGiftClaim({ env, session: aliceSession, giftId: 'gft_escrow_ready' }),
        (err: any) => err instanceof CustodyActionError && err.code === 'FORBIDDEN'
      );

      // 3. Escrow passthrough claim prepares successfully
      const escrowClaim = await prepareSelfCustodyGiftClaim({
        env,
        session: bobSession,
        giftId: 'gft_escrow_ready',
      });
      assert.equal(escrowClaim.step, 'gift_claim');
      assert.equal(escrowClaim.contractMode, 'escrow');
      assert.ok(escrowClaim.payloadStr.includes('uprail:gift-escrow-claim:v1'));

      // 4. Smart contract claim prepares cleanly and binds recipient_pubkey
      const contractClaim = await prepareSelfCustodyGiftClaim({
        env,
        session: bobSession,
        giftId: 'gft_contract_old',
      });
      assert.equal(contractClaim.step, 'gift_claim');
      assert.equal(contractClaim.contractMode, 'contract');
      assert.ok(contractClaim.payloadStr.includes('circle.uprail.near'));

      // 5. Reclaim enforces sender-only + 30d grace period
      await assert.rejects(
        () => prepareSelfCustodyGiftReclaim({ env, session: bobSession, giftId: 'gft_contract_old' }),
        (err: any) => err instanceof CustodyActionError && err.code === 'FORBIDDEN'
      );
      await assert.rejects(
        () => prepareSelfCustodyGiftReclaim({ env, session: aliceSession, giftId: 'gft_escrow_ready' }),
        (err: any) => err instanceof CustodyActionError && err.code === 'RECLAIM_TOO_EARLY'
      );

      // 6. Contract reclaim prepares after 30d unlock grace period and binds Alice's on-chain pubkey
      const contractReclaim = await prepareSelfCustodyGiftReclaim({
        env,
        session: aliceSession,
        giftId: 'gft_contract_old',
      });
      assert.equal(contractReclaim.step, 'gift_reclaim');
      assert.ok(contractReclaim.payloadStr.includes('circle.uprail.near'));
      assert.ok(contractReclaim.payloadStr.includes('u_alice.escrow.uprail.near'));
    }
  );
});

test('Self-Custody Circles enforce signer bindings, dual contract/escrow creation, and isolate distinct groups per user', async () => {
  const now = Date.now();
  const alicePub = makeTestP256NearPubkey(0x41);
  const bobPub = makeTestP256NearPubkey(0x42);

  const db = createMockDb({
    identities: [
      {
        x_id: 'xid_alice',
        x_handle: 'alice',
        near_account: 'u_alice.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
      {
        x_id: 'xid_bob',
        x_handle: 'bob',
        near_account: 'u_bob.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
      {
        x_id: 'xid_charlie',
        x_handle: 'charlie',
        near_account: 'u_charlie.escrow.uprail.near',
        custody_mode: 'server',
        is_activated: 1,
      },
      {
        x_id: 'xid_nopasskey',
        x_handle: 'nopasskey',
        near_account: 'u_nopk.escrow.uprail.near',
        custody_mode: 'self',
        is_activated: 1,
      },
    ],
    passkeys: [
      {
        id: 'pk_a',
        x_id: 'xid_alice',
        credential_id: 'cred_a',
        public_key: 'cose_a',
        near_p256_pubkey: alicePub,
        onchain_added_at: now - 5000,
        counter: 0,
        transports: '["internal"]',
        created_at: now - 5000,
      },
      {
        id: 'pk_b',
        x_id: 'xid_bob',
        credential_id: 'cred_b',
        public_key: 'cose_b',
        near_p256_pubkey: bobPub,
        onchain_added_at: now - 5000,
        counter: 0,
        transports: '["internal"]',
        created_at: now - 5000,
      },
    ],
    circles: [
      {
        id: 'circ_group_a_ab00000000000001',
        creator_x_id: 'xid_alice',
        creator_handle: 'alice',
        name: 'Alice + Bob Trip',
        purpose: 'TRIP',
        note: null,
        target_usd_cents: 10000,
        vault_asset_id: 'nep141:meta-pool.near',
        vault_symbol: 'stNEAR',
        vault_decimals: 24,
        payout_handle: 'alice',
        custody_account: 'circle.uprail.near',
        contract_mode: 'contract',
        status: 'ACTIVE',
        created_at: now - 2000,
        updated_at: now - 2000,
      },
      {
        id: 'circ_group_b_bc00000000000002',
        creator_x_id: 'xid_bob',
        creator_handle: 'bob',
        name: 'Bob + Charlie Studio',
        purpose: 'RENT',
        note: null,
        target_usd_cents: 20000,
        vault_asset_id: 'nep141:meta-pool.near',
        vault_symbol: 'stNEAR',
        vault_decimals: 24,
        payout_handle: 'bob',
        custody_account: 'circle.uprail.near',
        contract_mode: 'contract',
        status: 'ACTIVE',
        created_at: now - 1000,
        updated_at: now - 1000,
      },
      {
        id: 'circ_group_c_ac00000000000003',
        creator_x_id: 'xid_alice',
        creator_handle: 'alice',
        name: 'Alice + Charlie Escrow',
        purpose: 'SHARED_GOAL',
        note: null,
        target_usd_cents: 15000,
        vault_asset_id: 'nep141:meta-pool.near',
        vault_symbol: 'stNEAR',
        vault_decimals: 24,
        payout_handle: 'charlie',
        custody_account: 'cc'.repeat(32),
        contract_mode: 'escrow',
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      },
    ],
    circleMembers: [
      { id: 'm1', circle_id: 'circ_group_a_ab00000000000001', x_handle: 'alice', x_id: 'xid_alice', share_bps: 5000, quota_usd_cents: 5000, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
      { id: 'm2', circle_id: 'circ_group_a_ab00000000000001', x_handle: 'bob', x_id: 'xid_bob', share_bps: 5000, quota_usd_cents: 5000, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
      { id: 'm3', circle_id: 'circ_group_b_bc00000000000002', x_handle: 'bob', x_id: 'xid_bob', share_bps: 5000, quota_usd_cents: 10000, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
      { id: 'm4', circle_id: 'circ_group_b_bc00000000000002', x_handle: 'charlie', x_id: 'xid_charlie', share_bps: 5000, quota_usd_cents: 10000, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
      { id: 'm5', circle_id: 'circ_group_c_ac00000000000003', x_handle: 'alice', x_id: 'xid_alice', share_bps: 5000, quota_usd_cents: 7500, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
      { id: 'm6', circle_id: 'circ_group_c_ac00000000000003', x_handle: 'charlie', x_id: 'xid_charlie', share_bps: 5000, quota_usd_cents: 7500, contributed_usd_cents: 0, shares_atomic: '0', joined_at: now, created_at: now },
    ],
  });

  const env: any = {
    DB: db,
    CIRCLE_CONTRACT_ID: 'circle.uprail.near',
    APP_URL: 'https://app.uprail.world',
    RP_ID: 'app.uprail.world',
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ATTESTOR_PRIVATE_KEY: TEST_ATTESTOR_KP.priv,
    USER_DERIVATION_SECRET: 'test-derivation-secret-0123456789',
  };

  const aliceSession: any = { id: 'sa', x_id: 'xid_alice', x_handle: 'alice', x_name: 'Alice' };
  const bobSession: any = { id: 'sb', x_id: 'xid_bob', x_handle: 'bob', x_name: 'Bob' };
  const charlieSession: any = { id: 'sc', x_id: 'xid_charlie', x_handle: 'charlie', x_name: 'Charlie' };

  await withMockFetch(
    {
      current_salt: () => '00000000000000000000000000000001',
    },
    async () => {
      // 1. Contract mode rejects unregistered member and self-custody member without an activated passkey
      await assert.rejects(
        () =>
          prepareSelfCustodyCircleCreate({
            env,
            session: aliceSession,
            input: {
              name: 'Unregistered Test',
              targetAmountUsd: 100,
              vaultAsset: 'stNEAR',
              mode: 'contract',
              members: [
                { handle: 'alice', shareBps: 5000 },
                { handle: 'ghostuser', shareBps: 5000 },
              ],
            },
          }),
        (err: any) => err instanceof CustodyActionError && err.code === 'MEMBER_NOT_REGISTERED'
      );

      await assert.rejects(
        () =>
          prepareSelfCustodyCircleCreate({
            env,
            session: aliceSession,
            input: {
              name: 'No Passkey Test',
              targetAmountUsd: 100,
              vaultAsset: 'stNEAR',
              mode: 'contract',
              members: [
                { handle: 'alice', shareBps: 5000 },
                { handle: 'nopasskey', shareBps: 5000 },
              ],
            },
          }),
        (err: any) => err instanceof CustodyActionError && err.code === 'MEMBER_PASSKEY_MISSING'
      );

      // 2. Contract mode succeeds across mixed self ('alice','bob') + server ('charlie') custody members
      const contractCircle = await prepareSelfCustodyCircleCreate({
        env,
        session: aliceSession,
        input: {
          name: 'Mixed Custody Crew',
          targetAmountUsd: 150,
          vaultAsset: 'stNEAR',
          mode: 'contract',
          payoutHandle: 'bob',
          members: [
            { handle: 'alice', shareBps: 4000 },
            { handle: 'bob', shareBps: 3000 },
            { handle: 'charlie', shareBps: 3000 },
          ],
        },
      });
      assert.equal(contractCircle.contractMode, 'contract');
      assert.equal(contractCircle.step, 'circle_create');
      assert.ok(contractCircle.payloadStr.includes('circle.uprail.near'));

      // 3. Explicit escrow passthrough mode allows unregistered handles
      const escrowCircle = await prepareSelfCustodyCircleCreate({
        env,
        session: aliceSession,
        input: {
          name: 'Escrow Invite Crew',
          targetAmountUsd: 100,
          vaultAsset: 'stNEAR',
          mode: 'escrow',
          members: [
            { handle: 'alice', shareBps: 5000 },
            { handle: 'invited_friend', shareBps: 5000 },
          ],
        },
      });
      assert.equal(escrowCircle.contractMode, 'escrow');
      assert.ok(escrowCircle.payloadStr.includes('uprail:circle-escrow-create:v1'));

      // 4. Multi-group isolation across distinct Circles
      const aliceList = await listUserCircles(env, aliceSession);
      const bobList = await listUserCircles(env, bobSession);
      const charlieList = await listUserCircles(env, charlieSession);

      assert.deepEqual(
        aliceList.map((c) => c.id),
        [
          'circ_group_c_ac00000000000003',
          'circ_group_a_ab00000000000001',
        ]
      );
      assert.deepEqual(
        bobList.map((c) => c.id),
        [
          'circ_group_b_bc00000000000002',
          'circ_group_a_ab00000000000001',
        ]
      );
      assert.deepEqual(
        charlieList.map((c) => c.id),
        [
          'circ_group_c_ac00000000000003',
          'circ_group_b_bc00000000000002',
        ]
      );
    }
  );
});

test('Migration L1 sweep sponsors missing intents.near NEP-145 storage from escrow and preserves custom token visibility', async () => {
  const { sweepPlainBalancesBeforeUpgrade } = await import('../src/services/custodyService');
  const { getIntentBalances } = await import('../src/services/nearRpc');

  const kvStore = new Map<string, string>();
  const mockCache = {
    async get(key: string, type?: string) {
      const val = kvStore.get(key);
      if (val === undefined) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key: string, val: string) {
      kvStore.set(key, val);
    },
    async delete(key: string) {
      kvStore.delete(key);
    },
  };

  const mockDb = createMockDb({
    identities: [
      {
        x_id: 'xid_charlie',
        x_handle: 'charlie',
        near_account: 'u_charlie.escrow.uprail.near',
        is_activated: 1,
        custody_mode: 'server',
      },
    ],
  });

  const env: any = {
    DB: mockDb,
    CACHE: mockCache,
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv.replace(/^ed25519:/, ''),
    ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
    INTENTS_CONTRACT_ID: 'intents.near',
    NEAR_RPC_URL: 'https://free.rpc.fastnear.com',
  };

  let intentsStorageRegistered = false;
  let storageDepositSponsoredByEscrow = false;
  let ftTransferCallSweptToIntents = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('api.fastnear.com') && url.endsWith('/ft')) {
      return new Response(
        JSON.stringify({
          tokens: [
            {
              contract_id: 'unlisted.meme-cooking.near',
              balance: '50000000000000000000',
              last_update_block_height: 123456,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/v0/tokens')) {
      return new Response(JSON.stringify(MOCK_TOKENS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('ref.finance') || url.includes('rhea')) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (init?.body) {
      const rpcReq = JSON.parse(String(init.body));
      if (rpcReq.method === 'status') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              sync_info: {
                latest_block_hash: base58Encode(new Uint8Array(32).fill(7)),
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (rpcReq.method === 'broadcast_tx_commit') {
        const txB64 = rpcReq.params?.[0] || '';
        const rawBytes = Buffer.from(txB64, 'base64').toString('utf8');
        if (rawBytes.includes('storage_deposit') && rawBytes.includes('escrow.uprail.near')) {
          storageDepositSponsoredByEscrow = true;
          intentsStorageRegistered = true;
        }
        if (rawBytes.includes('ft_transfer_call') && rawBytes.includes('u_charlie.escrow.uprail.near')) {
          ftTransferCallSweptToIntents = true;
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              status: { SuccessValue: '' },
              transaction: { hash: 'tx_sweep_test_123' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const params = rpcReq.params || {};
      if (params.request_type === 'view_access_key') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { nonce: 100, permission: 'FullAccess' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (params.request_type === 'view_account') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { amount: '20000000000000000000000', storage_usage: 500 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (params.request_type === 'call_function') {
        const argsStr = Buffer.from(String(params.args_base64 || ''), 'base64').toString('utf8');
        const args = argsStr ? JSON.parse(argsStr) : {};
        let value: any = null;

        if (params.method_name === 'ft_metadata' && params.account_id === 'unlisted.meme-cooking.near') {
          value = { symbol: 'COOK', name: 'Meme Cooking', decimals: 18 };
        } else if (params.method_name === 'storage_balance_of' && params.account_id === 'unlisted.meme-cooking.near') {
          if (args.account_id === 'intents.near') {
            value = intentsStorageRegistered ? { total: '1250000000000000000000', available: '0' } : null;
          } else {
            value = { total: '1250000000000000000000', available: '0' };
          }
        } else if (params.method_name === 'storage_balance_bounds') {
          value = { min: '1250000000000000000000', max: '1250000000000000000000' };
        } else if (params.method_name === 'ft_balance_of' && params.account_id === 'unlisted.meme-cooking.near') {
          value = ftTransferCallSweptToIntents ? '0' : '50000000000000000000';
        } else if (params.method_name === 'has_public_key') {
          value = true;
        } else if (params.method_name === 'mt_batch_balance_of' && params.account_id === 'intents.near') {
          const tokenIds: string[] = args.token_ids || [];
          value = tokenIds.map((id) =>
            id === 'nep141:unlisted.meme-cooking.near' && ftTransferCallSweptToIntents
              ? '50000000000000000000'
              : '0'
          );
        }

        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    throw new Error(`Unexpected fetch call during sweep test: ${url}`);
  }) as typeof fetch;

  try {
    const res = await sweepPlainBalancesBeforeUpgrade(env, 'xid_charlie', 'charlie');
    assert.equal(storageDepositSponsoredByEscrow, true, 'escrow.uprail.near must sponsor storage_deposit for intents.near on unlisted token');
    assert.equal(ftTransferCallSweptToIntents, true, 'L1 token must be swept into intents.near via ft_transfer_call');
    assert.equal(res.swept.length, 1);
    assert.equal(res.swept[0].symbol, 'COOK');
    assert.equal(res.swept[0].txHash, 'tx_sweep_test_123');

    // Verify getIntentBalances discovers the swept unlisted NEP-141 token inside intents.near!
    const intentBals = await getIntentBalances(env, 'u_charlie.escrow.uprail.near');
    const cookBal = intentBals.find((b) => b.symbol === 'COOK');
    assert.ok(cookBal, 'Swept unlisted NEP-141 token must remain visible in getIntentBalances');
    assert.equal(Number(cookBal.amountFormatted), 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
