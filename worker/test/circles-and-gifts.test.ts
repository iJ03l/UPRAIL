import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURATED_EARN_VAULTS,
  resolveEarnVault,
  deriveEarnCustodyKey,
  normalizeAndValidateHandle,
  computeVaultPositionValuation,
  EarnVaultError,
} from '../src/services/earnVaults';
import {
  normalizeMemberAllocations,
  getCircleDetail,
  joinCircle,
  settleCircle,
  dissolveCircle,
  CircleError,
} from '../src/services/circles';
import {
  getAuthenticatedGift,
  getPublicGiftCardView,
  claimGift,
  GiftError,
} from '../src/services/gifts';

const TEST_ENV: any = {
  ESCROW_PRIVATE_KEY:
    'ed25519:3D4YudUQRE39Lc4JHghuB5WM8kbgDDa34mnrEP5DdTApVH81af7e2dWgNPEaiQfdJnZq1CNPp5im4Rg5b733oiMP',
  ESCROW_NEAR_ACCOUNT: 'escrow.uprail.near',
  FEE_COLLECTOR_ACCOUNT: 'fees.uprail.near',
  FEE_PERCENT: '0.01',
};

const PRELOADED_TOKENS: any[] = [
  {
    assetId: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    symbol: 'TLO',
    decimals: 8,
    blockchain: 'eth',
    price: 1.05,
  },
  {
    assetId: 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near',
    symbol: 'gtUSDCp',
    decimals: 18,
    blockchain: 'base',
    price: 0.00000112,
  },
  {
    assetId: 'nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near',
    symbol: 'kV-gtSOLb',
    decimals: 9,
    blockchain: 'sol',
    price: 185.0,
  },
  {
    assetId: 'nep141:meta-pool.near',
    symbol: 'stNEAR',
    decimals: 24,
    blockchain: 'near',
    price: 5.71,
  },
  {
    assetId: 'nep141:cnear.assetize.near',
    symbol: 'cNEAR',
    decimals: 24,
    blockchain: 'near',
    price: 3.75,
  },
  {
    assetId: 'nep141:eth-0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0.omft.near',
    symbol: 'wstETH',
    decimals: 18,
    blockchain: 'eth',
    price: 2590.0,
  },
];

test('resolveEarnVault allows all 6 curated Intents Earn vaults and rejects unknown symbols', async () => {
  assert.equal(CURATED_EARN_VAULTS.length, 6);
  for (const sym of ['TLO', 'gtUSDCp', 'kV-gtSOLb', 'stNEAR', 'cNEAR', 'wstETH']) {
    const v = await resolveEarnVault(TEST_ENV, sym, PRELOADED_TOKENS);
    assert.ok(v, `expected ${sym} to resolve`);
    const byId = await resolveEarnVault(TEST_ENV, v.assetId, PRELOADED_TOKENS);
    assert.equal(byId.symbol, v.symbol);
  }
  await assert.rejects(
    () => resolveEarnVault(TEST_ENV, 'FAKE_VAULT', PRELOADED_TOKENS),
    (err: any) => err instanceof EarnVaultError && err.code === 'UNSUPPORTED_EARN_VAULT'
  );
  await assert.rejects(
    () => resolveEarnVault(TEST_ENV, 'nep141:wrap.near', PRELOADED_TOKENS),
    (err: any) => err instanceof EarnVaultError && err.code === 'UNSUPPORTED_EARN_VAULT'
  );
});

test('deriveEarnCustodyKey derives unique deterministic 64-hex implicit NEAR accounts per item ID', async () => {
  const c1 = await deriveEarnCustodyKey(TEST_ENV, 'gft_0123456789abcdef01234567');
  const c1Repeat = await deriveEarnCustodyKey(TEST_ENV, 'gft_0123456789abcdef01234567');
  const c2 = await deriveEarnCustodyKey(TEST_ENV, 'circ_0123456789abcdef01234567');

  assert.equal(c1.accountId, c1Repeat.accountId);
  assert.notEqual(c1.accountId, c2.accountId);
  assert.match(c1.accountId, /^[0-9a-f]{64}$/);
  assert.match(c2.accountId, /^[0-9a-f]{64}$/);
  assert.equal(c1.privateKey.length, 32);
  assert.equal(c1.publicKey.length, 32);
});

test('normalizeAndValidateHandle strips @, enforces valid X handle format, and blocks reserved paths', () => {
  assert.equal(normalizeAndValidateHandle('@Alice_123'), 'alice_123');
  assert.equal(normalizeAndValidateHandle('illia'), 'illia');
  assert.throws(
    () => normalizeAndValidateHandle('bad-handle!'),
    (err: any) => err instanceof EarnVaultError && err.code === 'INVALID_HANDLE'
  );
  assert.throws(
    () => normalizeAndValidateHandle('circles'),
    (err: any) => err instanceof EarnVaultError && err.code === 'RESERVED_HANDLE'
  );
  assert.throws(
    () => normalizeAndValidateHandle('gifts'),
    (err: any) => err instanceof EarnVaultError && err.code === 'RESERVED_HANDLE'
  );
  assert.throws(
    () => normalizeAndValidateHandle('system'),
    (err: any) => err instanceof EarnVaultError && err.code === 'RESERVED_HANDLE'
  );
});

test('normalizeMemberAllocations enforces unique members and exact 100.00% (10,000 bps) total', () => {
  const valid = normalizeMemberAllocations(
    [
      { handle: '@alice', percentageShare: 60 },
      { handle: '@bob', percentageShare: 40 },
    ],
    100000 // $1,000.00 target
  );
  assert.equal(valid.length, 2);
  assert.equal(valid[0].shareBps, 6000);
  assert.equal(valid[0].quotaUsdCents, 60000);
  assert.equal(valid[1].shareBps, 4000);
  assert.equal(valid[1].quotaUsdCents, 40000);

  // Under 100%
  assert.throws(
    () =>
      normalizeMemberAllocations(
        [
          { handle: 'alice', percentageShare: 50 },
          { handle: 'bob', percentageShare: 40 },
        ],
        10000
      ),
    (err: any) => err instanceof CircleError && err.code === 'PERCENTAGE_SUM_MISMATCH'
  );

  // Duplicate handles
  assert.throws(
    () =>
      normalizeMemberAllocations(
        [
          { handle: '@Alice', percentageShare: 50 },
          { handle: 'alice', percentageShare: 50 },
        ],
        10000
      ),
    (err: any) => err instanceof CircleError && err.code === 'DUPLICATE_MEMBER'
  );

  // Empty members
  assert.throws(
    () => normalizeMemberAllocations([], 10000),
    (err: any) => err instanceof CircleError && err.code === 'INVALID_MEMBERS'
  );
});

test('computeVaultPositionValuation calculates live share value and positive yield delta', () => {
  const val = computeVaultPositionValuation({
    sharesAtomic: '10000000000', // 100 TLO (8 decimals)
    vaultDecimals: 8,
    sharePriceUsd: 1.045, // $104.50 current value
    principalUsdCents: 10000, // $100.00 principal
  });
  assert.equal(val.sharesFormatted, '100');
  assert.equal(val.currentValueUsdCents, 10450);
  assert.equal(val.yieldUsdCents, 450);
  assert.equal(val.yieldPct, 4.5);
});

test('Gift anti-IDOR and timelock enforcement protect sender/recipient data and block premature claims', async () => {
  const now = Date.now();
  const futureTimelock = now + 10 * 86400 * 1000;
  const giftId = 'gft_0123456789abcdef01234567';
  const giftRow = {
    id: giftId,
    sender_x_id: 'xid_alice',
    sender_handle: 'alice',
    recipient_handle: 'bob',
    recipient_x_id: null,
    occasion: 'CHRISTMAS',
    message: 'Enjoy the compounded yield!',
    show_amount: 0,
    vault_asset_id: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    vault_symbol: 'TLO',
    vault_decimals: 8,
    source_asset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    source_symbol: 'USDC',
    source_decimals: 6,
    gross_atomic: '100000000',
    principal_usd_cents: 9900,
    custody_account: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    deposit_address: null,
    deposit_memo: null,
    quoted_shares_atomic: '9900000000',
    balance_before_atomic: '0',
    shares_atomic: '9900000000',
    fee_shares_atomic: '100000000',
    fee_status: 'PAID',
    fee_tx_hash: 'tx_fee_1',
    timelock_until: futureTimelock,
    status: 'LOCKED',
    intent_hash: 'intent_1',
    claim_tx_hash: null,
    expires_at: now + 3600000,
    created_at: now - 5 * 86400 * 1000,
    updated_at: now,
    funded_at: now - 5 * 86400 * 1000,
    claimed_at: null,
  };

  const mockEnv: any = {
    ...TEST_ENV,
    DB: {
      prepare(sql: string) {
        return {
          bind(..._args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM gifts WHERE id = ?')) return { ...giftRow };
                return null;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  // 1. Public view hides principalUsdCents when show_amount = 0
  const pubView = await getPublicGiftCardView(mockEnv, giftId);
  assert.equal(pubView.principalUsdCents, undefined);
  assert.equal(pubView.isUnlocked, false);

  // 2. Unrelated user (@mallory) gets 403 FORBIDDEN on authenticated endpoint (anti-IDOR)
  await assert.rejects(
    () =>
      getAuthenticatedGift(
        mockEnv,
        {
          id: 'sess_m',
          x_id: 'xid_mallory',
          x_handle: 'mallory',
          x_name: 'Mallory',
        } as any,
        giftId
      ),
    (err: any) => err instanceof GiftError && err.code === 'FORBIDDEN' && err.httpStatus === 403
  );

  // 3. Recipient (@bob) sees full principal + live accrued yield even while locked
  const bobView = await getAuthenticatedGift(
    mockEnv,
    {
      id: 'sess_b',
      x_id: 'xid_bob',
      x_handle: 'bob',
      x_name: 'Bob',
    } as any,
    giftId
  );
  assert.equal(bobView.role, 'RECIPIENT');
  assert.equal(bobView.principalUsdCents, 9900);
  assert.equal(bobView.canClaim, false);

  // 4. Recipient attempting to claim before timelock_until is rejected with 403 GIFT_LOCKED
  await assert.rejects(
    () =>
      claimGift(
        mockEnv,
        {
          id: 'sess_b',
          x_id: 'xid_bob',
          x_handle: 'bob',
          x_name: 'Bob',
        } as any,
        giftId
      ),
    (err: any) => err instanceof GiftError && err.code === 'GIFT_LOCKED' && err.httpStatus === 403
  );

  // 5. Sender attempting to claim gift is rejected with 403 FORBIDDEN
  await assert.rejects(
    () =>
      claimGift(
        mockEnv,
        {
          id: 'sess_a',
          x_id: 'xid_alice',
          x_handle: 'alice',
          x_name: 'Alice',
        } as any,
        giftId
      ),
    (err: any) => err instanceof GiftError && err.code === 'FORBIDDEN' && err.httpStatus === 403
  );
});

test('Circle anti-IDOR blocks non-members from viewing and non-creators from settling/dissolving', async () => {
  const now = Date.now();
  const circleId = 'circ_0123456789abcdef01234567';
  const circleRow = {
    id: circleId,
    creator_x_id: 'xid_alice',
    creator_handle: 'alice',
    name: 'Tokyo Trip Fund',
    purpose: 'TRIP',
    note: 'Summer trip to Tokyo',
    target_usd_cents: 100000,
    vault_asset_id: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    vault_symbol: 'TLO',
    vault_decimals: 8,
    payout_handle: 'alice',
    custody_account: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    status: 'ACTIVE',
    created_at: now - 3 * 86400 * 1000,
    updated_at: now,
    closed_at: null,
    payout_tx_hash: null,
  };

  const memberRows = [
    {
      id: 'cmem_0123456789abcdef01234567',
      circle_id: circleId,
      x_handle: 'alice',
      x_id: 'xid_alice',
      share_bps: 5000,
      quota_usd_cents: 50000,
      contributed_usd_cents: 50000,
      shares_atomic: '5000000000',
      refunded_at: null,
      refund_tx_hash: null,
      joined_at: now,
      created_at: now,
    },
    {
      id: 'cmem_abcdef0123456789abcdef01',
      circle_id: circleId,
      x_handle: 'bob',
      x_id: 'xid_bob',
      share_bps: 5000,
      quota_usd_cents: 50000,
      contributed_usd_cents: 0,
      shares_atomic: '0',
      refunded_at: null,
      refund_tx_hash: null,
      joined_at: null,
      created_at: now,
    },
  ];

  const mockEnv: any = {
    ...TEST_ENV,
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM circles WHERE id = ?')) return { ...circleRow };
                if (sql.includes('FROM circle_members')) {
                  const [, callerXId, callerHandle] = args;
                  return (
                    memberRows.find(
                      (m) => m.x_id === callerXId || m.x_handle.toLowerCase() === callerHandle
                    ) || null
                  );
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM circle_members')) return { results: memberRows };
                if (sql.includes('FROM circle_contributions')) return { results: [] };
                return { results: [] };
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  // 1. Unrelated user (@mallory) gets 403 FORBIDDEN on getCircleDetail
  await assert.rejects(
    () =>
      getCircleDetail(
        mockEnv,
        {
          id: 'sess_m',
          x_id: 'xid_mallory',
          x_handle: 'mallory',
          x_name: 'Mallory',
        } as any,
        circleId
      ),
    (err: any) => err instanceof CircleError && err.code === 'FORBIDDEN' && err.httpStatus === 403
  );

  // 2. Non-creator member (@bob) can view the Circle (stays unsigned until joinCircle)
  const bobDetail = await getCircleDetail(
    mockEnv,
    {
      id: 'sess_b',
      x_id: 'xid_bob',
      x_handle: 'bob',
      x_name: 'Bob',
    } as any,
    circleId
  );
  assert.equal(bobDetail.isCreator, false);
  assert.equal(bobDetail.isMember, true);
  assert.equal(bobDetail.hasSigned, false);
  assert.equal(bobDetail.members.length, 2);

  // 3. When @bob calls joinCircle (passkey-gated), joined_at is set and hasSigned becomes true
  circleRow.purpose = 'CUSTOM:Family Emergency Fund';
  memberRows[1].joined_at = now;
  const bobJoined = await joinCircle(
    mockEnv,
    {
      id: 'sess_b',
      x_id: 'xid_bob',
      x_handle: 'bob',
      x_name: 'Bob',
    } as any,
    circleId
  );
  assert.equal(bobJoined.hasSigned, true);
  assert.equal(bobJoined.purpose, 'CUSTOM');
  assert.equal(bobJoined.purposeLabel, 'Family Emergency Fund');

  await assert.rejects(
    () =>
      settleCircle(
        mockEnv,
        {
          id: 'sess_b',
          x_id: 'xid_bob',
          x_handle: 'bob',
          x_name: 'Bob',
        } as any,
        circleId
      ),
    (err: any) => err instanceof CircleError && err.code === 'FORBIDDEN' && err.httpStatus === 403
  );

  // 4. Non-contributor (@bob with 0 shares) cannot activate dissolve
  await assert.rejects(
    () =>
      dissolveCircle(
        mockEnv,
        {
          id: 'sess_b',
          x_id: 'xid_bob',
          x_handle: 'bob',
          x_name: 'Bob',
        } as any,
        circleId
      ),
    (err: any) => err instanceof CircleError && err.code === 'FORBIDDEN' && err.httpStatus === 403
  );

  // 5. When both @alice and @bob are contributors, one contributor signing dissolve records 1/2 approval without dissolving yet
  memberRows[1].shares_atomic = '5000000000';
  memberRows[1].contributed_usd_cents = 50000;
  const afterAliceDissolveSign = await dissolveCircle(
    mockEnv,
    {
      id: 'sess_a',
      x_id: 'xid_alice',
      x_handle: 'alice',
      x_name: 'Alice',
    } as any,
    circleId
  );
  assert.equal(afterAliceDissolveSign.status, 'ACTIVE');
  assert.equal(afterAliceDissolveSign.hasApprovedDissolve, true);
  assert.equal(afterAliceDissolveSign.dissolveApprovalsCount, 1);
  assert.equal(afterAliceDissolveSign.dissolveRequiredCount, 2);
});
