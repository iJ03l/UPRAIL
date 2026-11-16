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
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    symbol: 'USDC',
    decimals: 6,
    blockchain: 'near',
    price: 1,
  },
  {
    assetId: 'nep141:wrap.near',
    symbol: 'NEAR',
    decimals: 24,
    blockchain: 'near',
    price: 3.55,
  },
  {
    assetId: 'nep141:usdt.tether-token.near',
    symbol: 'USDT',
    decimals: 6,
    blockchain: 'near',
    price: 1,
  },
  {
    assetId: 'nep141:eth.omft.near',
    symbol: 'ETH',
    decimals: 18,
    blockchain: 'eth',
    price: 3000,
  },
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

    if (sql.startsWith('SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ?')) {
      const [handle] = bindings;
      const row = state.identities.find((i) => String(i.x_handle).toLowerCase() === String(handle).toLowerCase()) || null;
      return { first: row ? { x_id: row.x_id } : null, results: row ? [{ x_id: row.x_id }] : [] };
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

    if (sql.startsWith('SELECT id, used_at, meta_json FROM pending_custody_actions')) {
      const [xId, actionType, cutoff] = bindings;
      const results = state.pendingActions
        .filter(
          (a) =>
            a.x_id === xId &&
            a.action_type === actionType &&
            a.used_at != null &&
            Number(a.used_at) >= Number(cutoff)
        )
        .sort((a, b) => Number(b.used_at) - Number(a.used_at));
      return { first: results[0] || null, results };
    }

    if (sql.startsWith('SELECT meta_json FROM pending_custody_actions WHERE id = ? AND x_id = ?')) {
      const [id, xId] = bindings;
      const row = state.pendingActions.find((a) => a.id === id && a.x_id === xId) || null;
      return { first: row, results: row ? [row] : [] };
    }

    if (sql.startsWith('UPDATE pending_custody_actions SET meta_json = ? WHERE id = ? AND x_id = ?')) {
      const [metaJson, id, xId] = bindings;
      let changes = 0;
      for (const a of state.pendingActions) {
        if (a.id === id && a.x_id === xId) {
          a.meta_json = metaJson;
          changes++;
        }
      }
      return { first: null, results: [], meta: { changes } };
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

    if (sql.startsWith('UPDATE x_identities SET near_account = ?, custody_mode = \'self\'')) {
      const [nearAccount, backupPubkey, selfCustodyAt, updatedAt, xId] = bindings;
      let changes = 0;
      for (const i of state.identities) {
        if (i.x_id === xId) {
          i.near_account = nearAccount;
          i.custody_mode = 'self';
          i.backup_pubkey = backupPubkey;
          i.self_custody_at = i.self_custody_at ?? selfCustodyAt;
          i.self_custody_version = Number(i.self_custody_version || 0) + 1;
          i.updated_at = updatedAt;
          changes++;
        }
      }
      return { first: null, results: [], meta: { changes } };
    }

    if (sql.startsWith('UPDATE passkeys SET onchain_added_at = COALESCE(onchain_added_at, ?)')) {
      const [addedAt, xId, nearP256Pubkey] = bindings;
      let changes = 0;
      for (const p of state.passkeys) {
        if (p.x_id === xId && p.near_p256_pubkey === nearP256Pubkey) {
          p.onchain_added_at = p.onchain_added_at ?? addedAt;
          changes++;
        }
      }
      return { first: null, results: [], meta: { changes } };
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
              vaultAsset: 'TLO',
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
              vaultAsset: 'TLO',
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
          vaultAsset: 'TLO',
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
          vaultAsset: 'TLO',
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

test('Initial non-custodial signup provisions intents.near lock, rotates L1 FullAccess key to backupPubkey, and fails closed if verification mismatches', async () => {
  const { provisionInitialSelfCustodyOnchain } = await import('../src/services/custodyService');
  const { deriveUserNearKeypair } = await import('../src/services/nearRpc');
  const { p256 } = await import('@noble/curves/nist.js');

  const p256Uncompressed = p256.getPublicKey(new Uint8Array(32).fill(0x77), false);
  const p256Key = `p256:${base58Encode(p256Uncompressed.subarray(1))}`;
  const backupKp = makeTestNearPrivateKey(0x88);
  const db = createMockDb({
    identities: [
      {
        x_id: 'xid_newuser',
        x_handle: 'newuser',
        near_account: null,
        is_activated: 1,
        custody_mode: 'self',
        backup_pubkey: null,
        self_custody_at: null,
        self_custody_version: 0,
      },
    ],
    passkeys: [
      {
        id: 'pk_newuser_1',
        x_id: 'xid_newuser',
        credential_id: 'cred_newuser_1',
        public_key: 'aabbcc',
        near_p256_pubkey: p256Key,
        onchain_added_at: null,
      },
    ],
  });

  const env: any = {
    DB: db,
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    INTENTS_CONTRACT_ID: 'intents.near',
  };

  const derived = await deriveUserNearKeypair(env, 'xid_newuser');
  let simulateFailureNext = false;
  let verifyMismatchNext = false;
  let l1RotatedOnchain = false;
  let intentsLockedOnchain = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('1click.chaindefuser.com')) {
      return new Response(JSON.stringify({ jwt: 'mock_jwt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('rpc.testnet.near.org') || url.includes('fastnear.com')) {
      const rpcReq = JSON.parse(String(init?.body || '{}'));
      if (rpcReq.method === 'status') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              sync_info: {
                latest_block_hash: base58Encode(new Uint8Array(32).fill(0x55)),
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (rpcReq.method === 'broadcast_tx_commit') {
        const txB64 = rpcReq.params?.[0] || '';
        const rawBytes = Buffer.from(txB64, 'base64');
        const rawStr = rawBytes.toString('utf8');
        if (rawStr.includes('execute_intents')) {
          intentsLockedOnchain = true;
        } else if (rawStr.includes(derived.accountId) && rawBytes.includes(backupKp.pubRaw[0])) {
          // L1 AddKey(backup) + DeleteKey(server)
          l1RotatedOnchain = true;
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              status: { SuccessValue: '' },
              transaction: { hash: 'tx_initial_self_custody_999' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const params = rpcReq.params || {};
      if (params.request_type === 'view_account') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { amount: '50000000000000000000000', storage_usage: 500 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (params.request_type === 'view_access_key') {
        const pub = params.public_key;
        if (pub === derived.publicKeyB58 && l1RotatedOnchain) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpcReq.id,
              error: { message: 'Access key does not exist' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (pub === backupKp.pub && !l1RotatedOnchain) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpcReq.id,
              error: { message: 'Access key does not exist' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { nonce: 42, permission: 'FullAccess' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (params.request_type === 'view_access_key_list') {
        const keys = l1RotatedOnchain
          ? [{ public_key: backupKp.pub, access_key: { permission: 'FullAccess' } }]
          : [{ public_key: derived.publicKeyB58, access_key: { permission: 'FullAccess' } }];
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { keys },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (params.request_type === 'call_function') {
        let value: any = null;
        if (params.method_name === 'has_public_key') {
          value = true;
        } else if (params.method_name === 'current_salt') {
          value = '01020304';
        } else if (params.method_name === 'simulate_intents') {
          value = simulateFailureNext ? { invariant_violated: 'mock_fail' } : {};
        } else if (params.method_name === 'public_keys_of') {
          value = verifyMismatchNext
            ? [derived.publicKeyB58] // server key still present -> fail-closed!
            : intentsLockedOnchain
            ? [p256Key, backupKp.pub]
            : [derived.publicKeyB58];
        } else if (params.method_name === 'is_auth_by_predecessor_id_enabled') {
          value = verifyMismatchNext ? true : !intentsLockedOnchain;
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
    throw new Error(`Unexpected fetch in initial self-custody test: ${url}`);
  }) as typeof fetch;

  try {
    // 1. Test fail-closed verification when on-chain keys do not match after relay
    verifyMismatchNext = true;
    await assert.rejects(
      () =>
        provisionInitialSelfCustodyOnchain({
          env,
          xId: 'xid_newuser',
          xHandle: 'newuser',
          nearP256Pubkey: p256Key,
          backupPubkey: backupKp.pub,
        }),
      (err: any) => err instanceof CustodyActionError && err.code === 'ONCHAIN_VERIFICATION_FAILED'
    );
    assert.equal(
      db.state.identities[0].self_custody_at,
      null,
      'Fail-closed verification must not finalize self_custody_at when on-chain keys mismatch'
    );

    // 2. Now allow verification to succeed and verify full non-custodial lock + L1 key rotation
    verifyMismatchNext = false;
    intentsLockedOnchain = false;
    l1RotatedOnchain = false;

    const provisioned = await provisionInitialSelfCustodyOnchain({
      env,
      xId: 'xid_newuser',
      xHandle: 'newuser',
      nearP256Pubkey: p256Key,
      backupPubkey: backupKp.pub,
    });

    assert.equal(provisioned.nearAccount, derived.accountId);
    assert.equal(provisioned.backupPubkey, backupKp.pub);
    assert.equal(provisioned.l1KeyRotated, true, 'Native NEAR L1 key must be rotated to backupPubkey');
    assert.equal(l1RotatedOnchain, true);
    assert.equal(db.state.identities[0].custody_mode, 'self');
    assert.equal(db.state.identities[0].backup_pubkey, backupKp.pub);
    assert.ok(db.state.identities[0].self_custody_at, 'self_custody_at must be populated');
    assert.ok(db.state.passkeys[0].onchain_added_at, 'Passkey onchain_added_at must be populated');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Agent Allowance Pocket merges into unified balance, auto-pulls shortfalls on main actions, and executes zero-prompt sends & withdrawals', async () => {
  const {
    CIRCLE_GIFT_USDC_ASSET_ID,
    deriveUserAgentPocket,
    ensureAgentPocketTopUpForMainAccount,
    getAgentPocketBalances,
    recallAllAgentPocketToMainAccount,
  } = await import('../src/services/earnVaults');
  const {
    executeAgentPocketSingleSend,
    probeAgentPocketForPayment,
    tryExecuteAgentPocketWithdraw,
  } = await import('../src/services/agentPocketService');

  const { getEscrowSigningKey } = await import('../src/services/oneclickAuth');
  const { createTimestampedNonceBytes, encodeVersionedNonce, saltFromHex } = await import(
    '../src/services/intentsNonce'
  );

  const senderMainAccount = 'u_alpha.escrow.uprail.near';
  const recipientMainAccount = 'u_beta.escrow.uprail.near';
  const pocketCache = new Map<string, string>();
  const env: any = {
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
    FEE_ACCOUNT_ID: 'escrow.uprail.near',
    FEE_PERCENT: '0.01',
    APP_URL: 'https://app.uprail.world',
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    INTENTS_CONTRACT_ID: 'intents.near',
    ONE_CLICK_API_KEY: 'test_1click_key',
    CONFIDENTIAL_RAIL_ENABLED: 'true',
    CACHE: {
      async get(key: string, type?: string) {
        const raw = pocketCache.get(key) ?? null;
        return type === 'json' && raw ? JSON.parse(raw) : raw;
      },
      async put(key: string, val: string) {
        pocketCache.set(key, val);
      },
    },
  };
  const escrowKey = await getEscrowSigningKey(env);

  const pocket = await deriveUserAgentPocket(env, senderMainAccount);
  assert.match(pocket.accountId, /^[0-9a-f]{64}$/);
  const otherPocket = await deriveUserAgentPocket(env, recipientMainAccount);
  assert.notEqual(pocket.accountId, otherPocket.accountId);

  // Track live in-memory intents.near token balances per (account -> asset -> atomic)
  const intentsBalances: Record<string, Record<string, bigint>> = {
    [senderMainAccount]: { [CIRCLE_GIFT_USDC_ASSET_ID]: 1_000_000n }, // $1.00 on main
    [pocket.accountId]: { [CIRCLE_GIFT_USDC_ASSET_ID]: 15_000_000n }, // $15.00 in pocket
    [recipientMainAccount]: {},
    'escrow.uprail.near': {},
  };
  const confidentialBalances: Record<string, bigint> = {
    'escrow.uprail.near': 0n,
    [recipientMainAccount]: 0n,
  };
  const insertedPayments: any[] = [];
  const insertedWithdrawals: any[] = [];
  const oneClickQuotes: any[] = [];
  let scrubbedPaymentCount = 0;

  env.DB = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: any[]) {
          return {
            async first<T>() {
              if (s.includes('FROM x_identities WHERE LOWER(x_handle)')) {
                const h = String(args[0] || '').toLowerCase();
                if (h === 'beta') {
                  return { x_id: 'xid_beta', near_account: recipientMainAccount, is_activated: 1 } as T;
                }
              }
              if (s.includes('FROM x_identities WHERE x_id = ?')) {
                const id = String(args[0] || '');
                if (id === 'xid_alpha') {
                  return {
                    x_id: 'xid_alpha',
                    x_handle: 'alpha',
                    near_account: senderMainAccount,
                    is_activated: 1,
                    custody_mode: 'self',
                  } as T;
                }
              }
              return null as T;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (s.startsWith('INSERT INTO payments')) {
                insertedPayments.push({
                  id: args[0],
                  recipient: args[3],
                  amount: args[6],
                  status: 'PENDING',
                  privacy_rail: 'public',
                  deposit_address: args[11],
                  intent_hash: null,
                  claim_tx_hash: null,
                  claim_deposit_address: null,
                  settlement_status: null,
                });
              } else if (s.startsWith('UPDATE payments SET status = ?') && s.includes("privacy_rail = 'confidential'")) {
                const row = insertedPayments.find((p) => p.id === args[10]);
                if (row) {
                  row.status = args[0];
                  row.deposit_address = args[1];
                  row.intent_hash = args[2];
                  row.claim_tx_hash = args[3];
                  row.privacy_rail = 'confidential';
                  row.settlement_status = args[4];
                  row.claim_deposit_address = args[5];
                }
              } else if (s.startsWith('UPDATE payments SET deposit_address = NULL')) {
                const row = insertedPayments.find((p) => p.id === args[0]);
                if (
                  row &&
                  row.privacy_rail === 'confidential' &&
                  row.status === 'CLAIMED' &&
                  String(row.settlement_status || '').toUpperCase() === 'SUCCESS'
                ) {
                  row.deposit_address = null;
                  row.intent_hash = null;
                  row.claim_deposit_address = null;
                  row.claim_tx_hash = null;
                  scrubbedPaymentCount++;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              } else if (s.startsWith('INSERT INTO withdrawals')) {
                insertedWithdrawals.push({ id: args[0], destination: args[3], amount: args[5], status: 'PENDING' });
              } else if (s.startsWith('UPDATE withdrawals SET tx_hash =')) {
                const row = insertedWithdrawals.find((w) => w.id === args[3] || w.id === args[4]);
                if (row) row.status = s.includes("status = 'COMPLETED'") ? 'COMPLETED' : 'PENDING';
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  let lastQuoteSigner = '';
  let lastDepositAddr = '';
  const quoteByDeposit = new Map<string, any>();
  let lastIntentBroadcast: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const authHeader = String(init?.headers?.Authorization || init?.headers?.authorization || '');
    if (url.includes('/v0/tokens')) {
      return new Response(JSON.stringify(MOCK_TOKENS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/v0/auth') && !url.includes('/refresh')) {
      const body = JSON.parse(String(init?.body || '{}'));
      const msg = JSON.parse(String(body?.signedData?.payload?.message || body?.payload?.message || '{}'));
      const token =
        msg.signer_id === escrowKey.accountId ? 'escrow_oc_token' : 'pocket_oc_token';
      return new Response(
        JSON.stringify({
          accessToken: token,
          refreshToken: `refresh_${token}`,
          expiresIn: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v0/account/balances')) {
      const acct = authHeader.includes('escrow_oc_token') ? 'escrow.uprail.near' : pocket.accountId;
      return new Response(
        JSON.stringify([
          {
            tokenId: CIRCLE_GIFT_USDC_ASSET_ID,
            available: String(confidentialBalances[acct] ?? 0n),
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v0/quote')) {
      const reqBody = JSON.parse(String(init?.body || '{}'));
      oneClickQuotes.push(reqBody);
      assert.equal(reqBody.confidentiality, 'basic');
      assert.equal(reqBody.recipientType, 'CONFIDENTIAL_INTENTS');
      const depAddr =
        reqBody.depositType === 'INTENTS'
          ? 'pocket_to_escrow_conf_dep'
          : 'escrow_to_recip_conf_dep';
      quoteByDeposit.set(depAddr, reqBody);
      lastDepositAddr = depAddr;
      return new Response(
        JSON.stringify({
          quote: {
            depositAddress: depAddr,
            deadline: new Date(Date.now() + 600_000).toISOString(),
            amountIn: reqBody.amount,
            amountOut: reqBody.amount,
          },
          quoteRequest: {
            confidentiality: 'basic',
            depositType: reqBody.depositType,
            recipientType: reqBody.recipientType,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v0/generate-intent')) {
      const reqBody = JSON.parse(String(init?.body || '{}'));
      lastDepositAddr = reqBody.depositAddress;
      lastQuoteSigner = reqBody.signerId;
      return new Response(
        JSON.stringify({
          intent: {
            standard: 'nep413',
            payload: {
              message: JSON.stringify({
                signer_id: reqBody.signerId,
                verifying_contract: 'intents.near',
                deadline: new Date(Date.now() + 600_000).toISOString(),
                intents: [
                  {
                    intent: 'transfer',
                    receiver_id: reqBody.depositAddress,
                    tokens: {
                      [CIRCLE_GIFT_USDC_ASSET_ID]:
                        quoteByDeposit.get(reqBody.depositAddress)?.amount || '0',
                    },
                  },
                ],
              }),
              nonce: encodeVersionedNonce(
                saltFromHex('01020304'),
                new Date(Date.now() + 600_000),
                createTimestampedNonceBytes()
              ),
              recipient: 'intents.near',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v0/submit-intent')) {
      const reqBody = JSON.parse(String(init?.body || '{}'));
      const q = quoteByDeposit.get(lastDepositAddr);
      if (q) {
        const amt = BigInt(q.amount || '0');
        if (lastDepositAddr === 'pocket_to_escrow_conf_dep') {
          intentsBalances[pocket.accountId][CIRCLE_GIFT_USDC_ASSET_ID] -= amt;
          confidentialBalances['escrow.uprail.near'] += amt;
        } else if (lastDepositAddr === 'escrow_to_recip_conf_dep') {
          confidentialBalances['escrow.uprail.near'] -= amt;
          confidentialBalances[recipientMainAccount] += amt;
        }
      }
      assert.equal(lastQuoteSigner, JSON.parse(reqBody?.signedData?.payload?.message || '{}').signer_id);
      return new Response(
        JSON.stringify({ intentHash: `ih_${lastDepositAddr}` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v0/status')) {
      return new Response(
        JSON.stringify({
          status: 'SUCCESS',
          swapDetails: { intentHashes: ['ih_settled'] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('api.ref.finance/list-token')) {
      return new Response(
        JSON.stringify({
          'eth.omft.near': { symbol: 'ETH', name: 'Ethereum', decimals: 18, icon: '' },
          '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            icon: '',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('api.fastnear.com/v1/account/')) {
      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('rpc.testnet.near.org') || url.includes('fastnear.com')) {
      const rpcReq = JSON.parse(String(init?.body || '{}'));
      if (rpcReq.method === 'status') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { sync_info: { latest_block_hash: base58Encode(new Uint8Array(32).fill(0x44)) } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (rpcReq.method === 'broadcast_tx_commit') {
        lastIntentBroadcast = rpcReq.params?.[0];
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: {
              status: { SuccessValue: '' },
              transaction: { hash: `tx_pocket_${Date.now()}` },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const p = rpcReq.params || {};
      if (p.request_type === 'view_account') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { amount: '0' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (p.request_type === 'view_access_key') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { nonce: 1, permission: 'FullAccess' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (p.request_type === 'call_function') {
        const args = JSON.parse(Buffer.from(p.args_base64 || 'e30=', 'base64').toString('utf8'));
        let val: any = null;
        if (p.method_name === 'current_salt') {
          val = '01020304';
        } else if (p.method_name === 'has_public_key') {
          val = true;
        } else if (p.method_name === 'public_keys_by_account') {
          val = [escrowKey.publicKeyB58];
        } else if (p.method_name === 'mt_balance_of') {
          val = String(intentsBalances[args.account_id]?.[args.token_id] ?? 0n);
        } else if (p.method_name === 'mt_batch_balance_of') {
          val = (args.token_ids || []).map((tid: string) =>
            String(intentsBalances[args.account_id]?.[tid] ?? 0n)
          );
        } else if (p.method_name === 'storage_balance_of') {
          val = { total: '1250000000000000000000', available: '0' };
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { result: Array.from(new TextEncoder().encode(JSON.stringify(val))) },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    throw new Error(`Unexpected fetch URL in pocket test: ${url}`);
  }) as typeof fetch;

  try {
    // 1. Batch pocket reader finds $15.00 USDC in 1 RPC call
    const summary = await getAgentPocketBalances(env, senderMainAccount);
    assert.equal(summary.pocketAccount, pocket.accountId);
    assert.equal(summary.balances.length, 1);
    assert.equal(summary.balances[0].symbol, 'USDC');
    assert.equal(summary.balances[0].amountFormatted, '15');

    // 2. Main account only has $1 USDC, user wants $4 on main -> auto-pulls $3 shortfall from pocket!
    const refreshedMain = await ensureAgentPocketTopUpForMainAccount(
      env,
      senderMainAccount,
      CIRCLE_GIFT_USDC_ASSET_ID,
      4_000_000n,
      1_000_000n
    );
    assert.equal(refreshedMain, 4_000_000n, 'Auto-pull must return updated main balance covering required amount');

    // 3. Probe autonomous AI payment within pocket balance ($5 USDC <= $15 pocket)
    const probeCovered = await probeAgentPocketForPayment({
      env,
      nearAccount: senderMainAccount,
      asset: 'USDC',
      recipients: [{ handle: 'beta', amount: '5', amountNum: 5 }],
    });
    assert.equal(probeCovered.covered, true);

    // 4. Probe autonomous AI payment exceeding pocket balance ($25 USDC > $15 pocket) -> fallback to /approve
    const probeShort = await probeAgentPocketForPayment({
      env,
      nearAccount: senderMainAccount,
      asset: 'USDC',
      recipients: [{ handle: 'beta', amount: '25', amountNum: 25 }],
    });
    assert.equal(probeShort.covered, false);
    assert.equal(probeShort.reason, 'insufficient_pocket_balance');

    // 5. Execute zero-prompt self-custody @handle payment from Agent Pocket via Confidential Intents
    lastIntentBroadcast = null;
    const senderSession: any = {
      session_id: 's_alpha',
      x_id: 'xid_alpha',
      x_handle: 'alpha',
      x_name: 'Alpha',
      created_at: Date.now(),
      expires_at: Date.now() + 3600_000,
    };
    const sendResult = await executeAgentPocketSingleSend({
      env,
      senderSession,
      senderNearAccount: senderMainAccount,
      pocketAccount: pocket.accountId,
      coreAsset: probeCovered.coreAsset!,
      recipientHandle: 'beta',
      rawAmount: '5',
      memo: 'Coffee via MCP',
    });
    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.status, 201);
    assert.equal(sendResult.body.status, 'CLAIMED');
    assert.equal(sendResult.body.privacy, 'confidential');
    assert.equal(sendResult.body.privacyRail, 'confidential');
    assert.equal(sendResult.body.source, 'agent_pocket');
    assert.equal(sendResult.body.custodyMode, 'self');
    assert.ok(sendResult.body.txHash);
    assert.equal(lastIntentBroadcast, null, 'Agent Pocket send must NEVER broadcast a public intents.near transfer');
    assert.equal(intentsBalances[recipientMainAccount][CIRCLE_GIFT_USDC_ASSET_ID] ?? 0n, 0n, 'Recipient public Intents must receive 0');
    assert.equal(confidentialBalances[recipientMainAccount], 4_950_000n, 'Recipient Confidential Intents must receive net 4.95 USDC');
    assert.equal(confidentialBalances['escrow.uprail.near'], 50_000n, '1% protocol fee retained in escrow confidential balance');
    assert.equal(oneClickQuotes.length, 2, 'Two confidential 1Click hops: pocket->escrow and escrow->recipient');
    assert.equal(insertedPayments[0].privacy_rail, 'confidential');
    assert.equal(scrubbedPaymentCount, 1, 'Settled confidential leg links must be scrubbed immediately');
    assert.equal(insertedPayments[0].claim_tx_hash, null);
    assert.equal(insertedPayments[0].deposit_address, null);

    // Fail-closed: if Confidential rail is disabled, refuse rather than landing in public
    const disabledRes = await executeAgentPocketSingleSend({
      env: { ...env, CONFIDENTIAL_RAIL_ENABLED: 'false' },
      senderSession,
      senderNearAccount: senderMainAccount,
      pocketAccount: pocket.accountId,
      coreAsset: probeCovered.coreAsset!,
      recipientHandle: 'beta',
      rawAmount: '1',
    });
    assert.equal(disabledRes.ok, false);
    assert.equal(disabledRes.status, 503);
    assert.equal(disabledRes.body.code, 'CONFIDENTIAL_RAIL_REQUIRED');

    // 6. Execute zero-prompt NEAR ft_withdraw directly from Agent Pocket
    const withdrawResult = await tryExecuteAgentPocketWithdraw({
      env,
      session: senderSession,
      nearAccount: senderMainAccount,
      destinationAddress: 'treasury.near',
      destinationChain: 'near',
      asset: 'USDC',
      amountStr: '3',
      parsedAmount: 3,
    });
    assert.equal(withdrawResult.handled, true);
    assert.equal(withdrawResult.responseStatus, 200);
    assert.equal(withdrawResult.responseBody?.status, 'COMPLETED');
    assert.equal(withdrawResult.responseBody?.source, 'agent_pocket');
    assert.equal(insertedWithdrawals[0].status, 'COMPLETED');

    // 7. getAllAgentReadableBalances discovers ALL held tokens across Main Intents, Pocket, and extras (e.g. ETH)
    intentsBalances[senderMainAccount]['nep141:eth.omft.near'] = 500_000_000_000_000_000n; // 0.5 ETH
    const { getAllAgentReadableBalances } = await import('../src/services/agentPocketService');
    const allBals = await getAllAgentReadableBalances(env, senderSession);
    const ethRow = allBals.balances.find((b) => b.asset === 'ETH');
    const usdcRow = allBals.balances.find((b) => b.asset === 'USDC');
    assert.ok(ethRow && ethRow.balance === 0.5, 'Agents must read non-USDC/USDT/NEAR balances like ETH');
    assert.equal(
      usdcRow?.balance,
      11,
      'Agents must see unified USDC (Main + Pocket: 16 initial - 5 spent confidentially)'
    );
    assert.equal(allBals.agentAllowance.balances.length, 1);

    // 8. Reclaim all remaining pocket funds back to main vault
    const reclaimRes = await recallAllAgentPocketToMainAccount(env, senderMainAccount);
    assert.equal(reclaimRes.recalled, true);
    assert.ok(reclaimRes.txHash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webAuthnToContractProof emits web_authn and stNEAR 5.1 USDC Gift auto-unshields Confidential USDC shortfall', async () => {
  const { webAuthnToContractProof } = await import('../src/services/circleContract');
  const { prepareSelfCustodyGiftCreate } = await import('../src/services/selfCustodyVaultOps');
  const { CIRCLE_GIFT_USDC_ASSET_ID } = await import('../src/services/earnVaults');

  const contractProof = webAuthnToContractProof({
    standard: 'webauthn',
    payload: '{}',
    public_key: 'p256:testpk',
    authenticator_data: 'auth',
    client_data_json: '{}',
    signature: 'p256:sig',
  });
  assert.equal(contractProof.kind, 'web_authn');

  const senderAccount = 'u_sender_gift.escrow.uprail.near';
  let confidentialUsdcAvailable = '6000000'; // $6.00 private USDC
  const cacheMap = new Map<string, string>();
  const mockDb = createMockDb({
    identities: [
      {
        x_id: 'xid_gift_sender',
        x_handle: 'giftsender',
        near_account: senderAccount,
        custody_mode: 'self',
        is_activated: 1,
      },
    ],
    passkeys: [
      {
        id: 'pk_gift_sender',
        x_id: 'xid_gift_sender',
        credential_id: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        public_key: '',
        near_p256_pubkey: makeTestP256NearPubkey(0x55),
        onchain_added_at: Date.now() - 1000,
        created_at: Date.now() - 2000,
      },
    ],
  });

  const env: any = {
    ESCROW_PRIVATE_KEY: TEST_ESCROW_KP.priv,
    ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    INTENTS_CONTRACT_ID: 'intents.near',
    ONE_CLICK_API_KEY: 'test_1click_key',
    CONFIDENTIAL_RAIL_ENABLED: 'true',
    WEBAUTHN_RP_ID: 'uprail.world',
    WEBAUTHN_RP_NAME: 'UPRAIL',
    WEBAUTHN_ORIGIN: 'https://app.uprail.world',
    DB: mockDb,
    CACHE: {
      async get(key: string, type?: string) {
        if (key.startsWith('1click:user-session:')) {
          const val = {
            accessToken: 'test_oc_token',
            accountId: senderAccount,
            expiresAt: Date.now() + 600_000,
          };
          return type === 'json' ? val : JSON.stringify(val);
        }
        const raw = cacheMap.get(key) ?? null;
        return type === 'json' && raw ? JSON.parse(raw) : raw;
      },
      async put(key: string, val: string) {
        cacheMap.set(key, val);
      },
    },
  };

  const { prepareSelfCustodyStabilize } = await import('../src/services/selfCustodyActions');

  let publicUsdcAvailable = '20000'; // $0.02 public USDC
  confidentialUsdcAvailable = '6000000'; // $6.00 private USDC
  let publicStNearAvailable = '0';
  const expectedStNearOut = '1031258287495697600534552';
  let quotedAmount = '';
  let lastQuoteBody: any = null;
  let lastQuoteDepositAddr = '1click_unshield_dep_addr';
  let rejectStNearConfidential = false;

  await withMockFetch(
    {
      public_keys_by_account: () => [makeTestP256NearPubkey(0x55)],
      is_auth_by_predecessor_id_enabled: () => false,
      current_salt: () => '01020304',
      mt_balance_of: (args: any) => {
        if (String(args?.token_id || '').includes('meta-pool.near')) return publicStNearAvailable;
        return publicUsdcAvailable;
      },
      mt_batch_balance_of: (args: any) =>
        (args.token_ids || []).map((tid: string) =>
          String(tid).includes('meta-pool.near') ? publicStNearAvailable : publicUsdcAvailable
        ),
    },
    async () => {
      const baseFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/v0/account/balances')) {
          return new Response(
            JSON.stringify([
              {
                tokenId: CIRCLE_GIFT_USDC_ASSET_ID,
                available: confidentialUsdcAvailable,
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/v0/quote')) {
          const reqBody = JSON.parse(String(init?.body || '{}'));
          lastQuoteBody = reqBody;
          quotedAmount = String(reqBody.amount || '');
          if (
            rejectStNearConfidential &&
            reqBody.originAsset === 'nep141:meta-pool.near' &&
            reqBody.confidentiality === 'basic'
          ) {
            return new Response(
              JSON.stringify({ message: 'Confidential quotes not supported for stNEAR' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
          const isStnearOut = reqBody.destinationAsset === 'nep141:meta-pool.near';
          const isStabilizeToUsdc =
            reqBody.originAsset === 'nep141:meta-pool.near' &&
            reqBody.destinationAsset === CIRCLE_GIFT_USDC_ASSET_ID;
          lastQuoteDepositAddr = isStnearOut
            ? '1click_gift_swap_dep_addr'
            : isStabilizeToUsdc
            ? '1click_stabilize_stnear_dep'
            : '1click_unshield_dep_addr';
          return new Response(
            JSON.stringify({
              quote: {
                depositAddress: lastQuoteDepositAddr,
                deadline: new Date(Date.now() + 600_000).toISOString(),
                amountIn: reqBody.amount,
                amountOut: isStnearOut ? expectedStNearOut : '5000000',
              },
              quoteRequest: { confidentiality: reqBody.confidentiality || 'public' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/v0/generate-intent')) {
          const genBody = JSON.parse(String(init?.body || '{}'));
          const dep = genBody.depositAddress || lastQuoteDepositAddr;
          const { createTimestampedNonceBytes, encodeVersionedNonce, saltFromHex } = await import(
            '../src/services/intentsNonce'
          );
          return new Response(
            JSON.stringify({
              intent: {
                standard: 'webauthn',
                payload: JSON.stringify({
                  signer_id: senderAccount,
                  verifying_contract: 'intents.near',
                  deadline: new Date(Date.now() + 600_000).toISOString(),
                  nonce: encodeVersionedNonce(
                    saltFromHex('01020304'),
                    new Date(Date.now() + 600_000),
                    createTimestampedNonceBytes()
                  ),
                  intents: [
                    {
                      intent: 'transfer',
                      receiver_id: dep,
                      tokens: { [CIRCLE_GIFT_USDC_ASSET_ID]: quotedAmount },
                    },
                  ],
                }),
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/v0/status')) {
          return new Response(
            JSON.stringify({
              status: 'SUCCESS',
              swapDetails: { amountOut: expectedStNearOut },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('api.fastnear.com/v1/account/')) {
          return new Response(JSON.stringify({ tokens: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('api.ref.finance/list-token')) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return await baseFetch(input, init);
      }) as typeof fetch;

      const senderSession: any = {
        session_id: 's_gift',
        x_id: 'xid_gift_sender',
        x_handle: 'giftsender',
        x_name: 'Gift Sender',
        near_account: senderAccount,
        custody_mode: 'self',
        created_at: Date.now(),
        expires_at: Date.now() + 3600_000,
      };

      // Step 1: Confidential shortfall unshields $5.08 into public Intents
      const prep: any = await prepareSelfCustodyGiftCreate({
        env,
        session: senderSession,
        input: {
          recipientHandle: 'alice',
          vaultAsset: 'stNEAR',
          sourceAsset: CIRCLE_GIFT_USDC_ASSET_ID,
          amount: '5.1',
          timelockUntil: Date.now() + 86_400_000,
        },
      });
      assert.equal(prep.step, 'unshield');
      assert.equal(prep.nextStep, 'gift_create');
      assert.equal(prep.unshieldAmountFormatted, '5.08');
      assert.equal(quotedAmount, '5080000');

      // Step 2: Public USDC ($5.10) is ready -> swaps USDC into stNEAR in senderAccount
      publicUsdcAvailable = '5100000';
      const prepSwap: any = await prepareSelfCustodyGiftCreate({
        env,
        session: senderSession,
        input: {
          recipientHandle: 'alice',
          vaultAsset: 'stNEAR',
          sourceAsset: CIRCLE_GIFT_USDC_ASSET_ID,
          amount: '5.1',
          timelockUntil: Date.now() + 86_400_000,
        },
      });
      assert.equal(prepSwap.step, 'swap_to_vault');
      assert.equal(prepSwap.depositAddress, '1click_gift_swap_dep_addr');

      // Simulate user signing GIFT_CREATE_SWAP & 1Click delivering 1.031258 stNEAR (USDC now 0!)
      const swapAction = mockDb.state.pendingActions.find(
        (a: any) => a.action_type === 'GIFT_CREATE_SWAP'
      );
      assert.ok(swapAction);
      swapAction.used_at = Date.now();
      publicUsdcAvailable = '0';
      confidentialUsdcAvailable = '0';
      publicStNearAvailable = expectedStNearOut;

      // Step 3a: Continuation with completedSwapDepositAddress must NOT demand USDC again!
      const prepDeposit: any = await prepareSelfCustodyGiftCreate({
        env,
        session: senderSession,
        input: {
          recipientHandle: 'alice',
          vaultAsset: 'stNEAR',
          sourceAsset: CIRCLE_GIFT_USDC_ASSET_ID,
          amount: '5.1',
          timelockUntil: Date.now() + 86_400_000,
          completedSwapDepositAddress: '1click_gift_swap_dep_addr',
        },
      });
      assert.equal(prepDeposit.step, 'gift_create');
      const parsedDepositMsg = JSON.parse(String(prepDeposit.payloadStr || '{}'));
      const totalStNearTransferred = (parsedDepositMsg.intents || []).reduce(
        (sum: bigint, i: any) => sum + BigInt(i?.tokens?.['nep141:meta-pool.near'] || '0'),
        0n
      );
      assert.equal(
        totalStNearTransferred.toString(),
        expectedStNearOut,
        'Gift deposit must use exact 24-decimal stNEAR shares (99% escrow + 1% fee), never USDC 6-decimal units'
      );

      // Step 3b: Retrying WITHOUT completedSwapDepositAddress rescues stranded stNEAR from the recent swap
      const prepRescue: any = await prepareSelfCustodyGiftCreate({
        env,
        session: senderSession,
        input: {
          recipientHandle: 'alice',
          vaultAsset: 'stNEAR',
          sourceAsset: CIRCLE_GIFT_USDC_ASSET_ID,
          amount: '5',
          timelockUntil: Date.now() + 86_400_000,
        },
      });
      assert.equal(prepRescue.step, 'gift_create');

      // Step 4: Stabilizing stranded public stNEAR -> Confidential USDC works in 1 tap directly from INTENTS
      const prepStab: any = await prepareSelfCustodyStabilize(env, senderSession, {
        sourceAsset: 'nep141:meta-pool.near',
        targetAsset: CIRCLE_GIFT_USDC_ASSET_ID,
        amount: 'all',
      });
      assert.equal(prepStab.step, 'stabilize');
      assert.equal(lastQuoteBody.depositType, 'INTENTS');
      assert.equal(lastQuoteBody.recipientType, 'CONFIDENTIAL_INTENTS');
      assert.equal(lastQuoteBody.destinationAsset, CIRCLE_GIFT_USDC_ASSET_ID);

      // Step 4b: When 1Click rejects confidential swaps on stNEAR, fall back cleanly to public INTENTS -> INTENTS
      rejectStNearConfidential = true;
      const prepStabPublicFallback: any = await prepareSelfCustodyStabilize(env, senderSession, {
        sourceAsset: 'nep141:meta-pool.near',
        targetAsset: CIRCLE_GIFT_USDC_ASSET_ID,
        amount: 'all',
      });
      rejectStNearConfidential = false;
      assert.equal(prepStabPublicFallback.step, 'stabilize');
      assert.equal(lastQuoteBody.depositType, 'INTENTS');
      assert.equal(lastQuoteBody.recipientType, 'INTENTS');
      assert.equal(lastQuoteBody.confidentiality, undefined);
      assert.equal(lastQuoteBody.destinationAsset, CIRCLE_GIFT_USDC_ASSET_ID);
      const fallbackPendingAction = mockDb.state.pendingActions.find(
        (a: any) => a.id === prepStabPublicFallback.actionId
      );
      assert.ok(fallbackPendingAction);
      assert.equal(JSON.parse(fallbackPendingAction.meta_json).isConfidentialSwap, false);

      // When swap was already deposited and total USDC across all rails is genuinely short, reject cleanly
      const m = JSON.parse(swapAction.meta_json);
      swapAction.meta_json = JSON.stringify({ ...m, deposited: true });
      publicStNearAvailable = '0';
      publicUsdcAvailable = '20000';
      confidentialUsdcAvailable = '10000';
      await assert.rejects(
        () =>
          prepareSelfCustodyGiftCreate({
            env,
            session: senderSession,
            input: {
              recipientHandle: 'alice',
              vaultAsset: 'stNEAR',
              sourceAsset: CIRCLE_GIFT_USDC_ASSET_ID,
              amount: '5.1',
              timelockUntil: Date.now() + 86_400_000,
            },
          }),
        /0\.03 available, 5\.1 required/i
      );
    }
  );
});



