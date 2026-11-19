/**
 * Invite & Referral Service for UPRAIL
 * - Enforces 6 capital letter invite codes for first-time onboarding
 * - Allocates 1 reusable personal ref code per registered user in Settings
 * - Generates preloaded single-use payment invites attached to send links
 * - Tracks who claimed each invite
 */

import type { Env, Invite, MyInviteResponse, RedeemInviteResponse } from '../types';
import { resolveOrigin } from './webauthnConfig';

const CAPITAL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates a random 6 capital letter invite code.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CAPITAL_LETTERS[bytes[i] % CAPITAL_LETTERS.length];
  }
  return code;
}

/**
 * Normalizes an invite code: trim and uppercase
 */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Validates format: exactly 6 capital letters
 */
export function isValidInviteCodeFormat(code: string): boolean {
  return /^[A-Z]{6}$/.test(code);
}

export const SYSTEM_GENESIS_CODES = [
  'UPRAIL',
  'LAUNCH',
  'INTENT',
  'ALPHA1',
  'VAULTS',
  'SECRET',
  'TRENCH',
] as const;

export const SKIP_SYSTEM_CODES = [
  'UPRAIL',
  'LAUNCH',
  'INTENT',
  'VAULTS',
  'SECRET',
  'TRENCH',
] as const;

/**
 * Selects one of the reusable 6-letter system bootstrap codes when a user skips
 * entering a friend's referral code at signup.
 */
export function pickSystemInviteCode(): string {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return SKIP_SYSTEM_CODES[buf[0] % SKIP_SYSTEM_CODES.length];
}

/**
 * Seeds genesis bootstrap invite codes if not already present.
 */
export async function ensureGenesisInvites(env: Env): Promise<void> {
  const now = Date.now();

  // Schema is owned by worker/src/db/migrations — never CREATE TABLE here.

  for (const code of SYSTEM_GENESIS_CODES) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO invites (code, creator_x_id, creator_x_handle, claimed_by_x_id, claimed_by_x_handle, payment_id, status, created_at, claimed_at)
         VALUES (?, NULL, 'system', NULL, NULL, NULL, 'ACTIVE', ?, NULL)`
      )
        .bind(code, now)
        .run();
    } catch {}
  }
}

/**
 * Checks if a user is activated on the platform
 */
export async function isUserActivated(env: Env, xId: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      'SELECT is_activated FROM x_identities WHERE x_id = ?'
    )
      .bind(xId)
      .first<{ is_activated: number | null }>();

    return row?.is_activated === 1;
  } catch {
    return false;
  }
}

function isSystemGenesisInvite(
  row: Pick<Invite, 'code' | 'creator_x_handle' | 'payment_id'>
): boolean {
  return (
    !row.payment_id &&
    (row.creator_x_handle === 'system' ||
      (SYSTEM_GENESIS_CODES as readonly string[]).includes(row.code))
  );
}

function isPersonalRefInvite(row: Pick<Invite, 'creator_x_id' | 'payment_id'>): boolean {
  return Boolean(row.creator_x_id) && !row.payment_id;
}

function isReusableInviteRow(
  row: Pick<Invite, 'code' | 'creator_x_id' | 'creator_x_handle' | 'payment_id'>
): boolean {
  return isSystemGenesisInvite(row) || isPersonalRefInvite(row);
}

/**
 * Validates an invite code without consuming it
 */
export async function validateInviteCode(
  env: Env,
  rawCode: string
): Promise<{ valid: boolean; reason?: string; invite?: Invite }> {
  const code = normalizeInviteCode(rawCode);
  if (!code) {
    return { valid: false, reason: 'Invite code is required' };
  }
  if (!isValidInviteCodeFormat(code)) {
    return { valid: false, reason: 'Invite code must be exactly 6 capital letters' };
  }

  try {
    await ensureGenesisInvites(env);

    const row = await env.DB.prepare(
      'SELECT * FROM invites WHERE code = ?'
    )
      .bind(code)
      .first<Invite>();

    if (!row) {
      return { valid: false, reason: 'Invite code does not exist' };
    }

    if (row.status === 'EXPIRED') {
      return { valid: false, reason: 'Invite code has expired' };
    }

    if (!isReusableInviteRow(row) && row.status !== 'ACTIVE') {
      return {
        valid: false,
        reason: row.claimed_by_x_handle
          ? `Invite code was already claimed by @${row.claimed_by_x_handle}`
          : 'Invite code has already been used',
      };
    }

    return { valid: true, invite: row };
  } catch (err: any) {
    return { valid: false, reason: err.message || 'Database error validating invite code' };
  }
}

async function allocatePersonalInviteCode(
  env: Env,
  xId: string,
  cleanHandle: string,
  now: number
): Promise<string> {
  let personalCode = generateInviteCode();
  for (let attempts = 0; attempts < 5; attempts++) {
    try {
      await env.DB.prepare(
        `INSERT INTO invites (code, creator_x_id, creator_x_handle, claimed_by_x_id, claimed_by_x_handle, payment_id, status, created_at, claimed_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 'ACTIVE', ?, NULL)`
      )
        .bind(personalCode, xId, cleanHandle, now)
        .run();
      return personalCode;
    } catch {
      personalCode = generateInviteCode();
    }
  }
  return personalCode;
}

/**
 * Redeems an invite code for a user, activating their account and
 * generating their reusable personal ref code to share.
 */
export async function redeemInvite(
  env: Env,
  rawCode: string,
  user: { x_id: string; x_handle: string }
): Promise<RedeemInviteResponse> {
  const check = await validateInviteCode(env, rawCode);
  if (!check.valid || !check.invite) {
    throw new Error(check.reason || 'Invalid invite code');
  }

  const code = check.invite.code;
  const now = Date.now();
  const cleanHandle = user.x_handle.toLowerCase();

  // Prevent using own invite code
  if (check.invite.creator_x_id && check.invite.creator_x_id === user.x_id) {
    throw new Error('You cannot redeem your own invite code');
  }

  // Check if user is already activated so repeat logins via a ?invite= link never
  // rotate their existing personal ref code or overwrite their referrer attribution.
  const existingIdentity = await env.DB.prepare(
    'SELECT is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
  )
    .bind(user.x_id)
    .first<{ is_activated: number | null; personal_invite_code: string | null }>()
    .catch(() => null);

  if (
    !check.invite.payment_id &&
    existingIdentity?.is_activated === 1 &&
    existingIdentity?.personal_invite_code
  ) {
    return {
      success: true,
      message: 'Your account is already active.',
      personalInviteCode: existingIdentity.personal_invite_code,
      isActivated: true,
    };
  }

  // If this invite is tied to an escrow payment, bind it strictly to the recipient!
  if (check.invite.payment_id) {
    const payment = await env.DB.prepare(
      'SELECT recipient_handle, recipient_x_id FROM payments WHERE id = ?'
    )
      .bind(check.invite.payment_id)
      .first<{ recipient_handle: string; recipient_x_id: string | null }>();

    if (payment) {
      const isExpected = payment.recipient_x_id
        ? payment.recipient_x_id === user.x_id
        : payment.recipient_handle.toLowerCase() === cleanHandle;
      if (!isExpected) {
        throw new Error(`This invite code is bound exclusively to @${payment.recipient_handle}`);
      }
    }
  }

  // 1. Only single-use invites (e.g. payment-attached invites) transition to USED.
  // System bootstrap codes and user personal ref codes remain ACTIVE for reuse.
  const reusable = isReusableInviteRow(check.invite);
  if (!reusable) {
    const claimResult = await env.DB.prepare(
      `UPDATE invites
       SET status = 'USED', claimed_by_x_id = ?, claimed_by_x_handle = ?, claimed_at = ?
       WHERE code = ? AND status = 'ACTIVE'`
    )
      .bind(user.x_id, cleanHandle, now, code)
      .run();

    // Atomic single-claim guard: if a concurrent request consumed this code
    // between our validateInviteCode() read and this UPDATE, changes === 0.
    // Refuse to activate the account on a lost race.
    if ((claimResult.meta?.changes ?? 0) === 0) {
      throw new Error('Invite code was already claimed');
    }
  } else if (isPersonalRefInvite(check.invite) && check.invite.status === 'USED') {
    // Heal legacy personal ref codes that were marked USED before reuse was enabled.
    await env.DB.prepare(
      `UPDATE invites
       SET status = 'ACTIVE'
       WHERE code = ? AND status = 'USED' AND payment_id IS NULL AND creator_x_id IS NOT NULL`
    )
      .bind(code)
      .run()
      .catch(() => {});
  }

  // Keep existing personal ref code if an activated user is claiming a payment invite.
  if (existingIdentity?.is_activated === 1 && existingIdentity?.personal_invite_code) {
    return {
      success: true,
      message: 'Your account is already active.',
      personalInviteCode: existingIdentity.personal_invite_code,
      isActivated: true,
    };
  }

  // 2. Generate reusable personal ref code for the new user
  const personalCode = await allocatePersonalInviteCode(env, user.x_id, cleanHandle, now);

  // 3. Mark user identity as activated
  await env.DB.prepare(
    `UPDATE x_identities
     SET is_activated = 1, personal_invite_code = ?, invited_by_code = ?, invited_by_handle = ?, updated_at = ?
     WHERE x_id = ?`
  )
    .bind(
      personalCode,
      code,
      check.invite.creator_x_handle || 'system',
      now,
      user.x_id
    )
    .run();

  return {
    success: true,
    message: 'Welcome to UPRAIL! Your account is now active.',
    personalInviteCode: personalCode,
    isActivated: true,
  };
}

/**
 * Activates a first-time user who skipped manual ref-code entry by applying one
 * of the reusable system bootstrap codes under the hood.
 */
export async function redeemSystemSkipInvite(
  env: Env,
  user: { x_id: string; x_handle: string }
): Promise<RedeemInviteResponse> {
  return redeemInvite(env, pickSystemInviteCode(), user);
}

/**
 * Creates an invite code attached to an outgoing payment
 * (the preloaded claim invite link).
 */
export async function createPaymentInvite(
  env: Env,
  paymentId: string,
  senderXId?: string | null,
  senderHandle?: string | null
): Promise<string> {
  let code = generateInviteCode();
  const now = Date.now();
  let attempts = 0;

  while (attempts < 5) {
    try {
      await env.DB.prepare(
        `INSERT INTO invites (code, creator_x_id, creator_x_handle, claimed_by_x_id, claimed_by_x_handle, payment_id, status, created_at, claimed_at)
         VALUES (?, ?, ?, NULL, NULL, ?, 'ACTIVE', ?, NULL)`
      )
        .bind(code, senderXId || null, senderHandle || null, paymentId, now)
        .run();
      break;
    } catch {
      code = generateInviteCode();
      attempts++;
    }
  }

  return code;
}

/**
 * Retrieves the user's reusable personal ref code and everyone who used it.
 */
export async function getUserInvite(
  env: Env,
  xId: string,
  xHandle: string
): Promise<MyInviteResponse> {
  const cleanHandle = xHandle.toLowerCase();

  // 1. Fetch user identity to check personal_invite_code
  const identity = await env.DB.prepare(
    'SELECT is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
  )
    .bind(xId)
    .first<{ is_activated: number | null; personal_invite_code: string | null }>();

  let personalCode = identity?.personal_invite_code;

  // If code is missing, allocate their reusable personal ref code
  if (!personalCode) {
    const now = Date.now();
    personalCode = await allocatePersonalInviteCode(env, xId, cleanHandle, now);
    try {
      await env.DB.prepare(
        'UPDATE x_identities SET personal_invite_code = ?, updated_at = ? WHERE x_id = ?'
      )
        .bind(personalCode, now, xId)
        .run();
    } catch {}
  }

  // 2. Query personal invite record in DB and heal legacy single-use personal codes
  const inviteRecord = await env.DB.prepare(
    'SELECT * FROM invites WHERE code = ?'
  )
    .bind(personalCode)
    .first<Invite>();

  if (inviteRecord && inviteRecord.status === 'USED' && isPersonalRefInvite(inviteRecord)) {
    await env.DB.prepare(
      `UPDATE invites
       SET status = 'ACTIVE'
       WHERE code = ? AND status = 'USED' AND payment_id IS NULL AND creator_x_id IS NOT NULL`
    )
      .bind(personalCode)
      .run()
      .catch(() => {});
  }

  // 3. Query all activated accounts that redeemed this personal ref code
  let useCount = 0;
  const recentClaims: Array<{ handle: string; claimedAt: number }> = [];
  if (personalCode) {
    try {
      const [countRow, claimsRows] = await Promise.all([
        env.DB.prepare(
          'SELECT COUNT(*) AS cnt FROM x_identities WHERE invited_by_code = ? AND is_activated = 1'
        )
          .bind(personalCode)
          .first<{ cnt: number }>(),
        env.DB.prepare(
          `SELECT x_handle, updated_at, created_at
           FROM x_identities
           WHERE invited_by_code = ? AND is_activated = 1
           ORDER BY updated_at DESC
           LIMIT 25`
        )
          .bind(personalCode)
          .all<{ x_handle: string; updated_at: number | null; created_at: number | null }>(),
      ]);

      useCount = Number(countRow?.cnt || 0);
      const seenHandles = new Set<string>();
      for (const r of claimsRows.results || []) {
        const handle = (r.x_handle || '').trim();
        if (!handle || seenHandles.has(handle.toLowerCase())) continue;
        seenHandles.add(handle.toLowerCase());
        recentClaims.push({
          handle,
          claimedAt: Number(r.updated_at || r.created_at || Date.now()),
        });
      }

      // Preserve any historical single claim recorded on invites if missing from x_identities
      if (
        inviteRecord?.claimed_by_x_handle &&
        !seenHandles.has(inviteRecord.claimed_by_x_handle.toLowerCase())
      ) {
        useCount = Math.max(useCount + 1, 1);
        recentClaims.push({
          handle: inviteRecord.claimed_by_x_handle,
          claimedAt: Number(inviteRecord.claimed_at || Date.now()),
        });
      }

      useCount = Math.max(useCount, recentClaims.length);
    } catch {}
  }

  // 4. Query any payment-attached invites created by this user
  let paymentInvites: Array<{
    code: string;
    paymentId: string;
    recipientHandle: string;
    status: 'ACTIVE' | 'USED';
  }> = [];

  try {
    const rows = await env.DB.prepare(
      `SELECT i.code, i.payment_id, i.status, p.recipient_handle
       FROM invites i
       LEFT JOIN payments p ON p.id = i.payment_id
       WHERE i.creator_x_id = ? AND i.payment_id IS NOT NULL
       ORDER BY i.created_at DESC LIMIT 10`
    )
      .bind(xId)
      .all<{
        code: string;
        payment_id: string;
        status: string;
        recipient_handle: string;
      }>();

    paymentInvites = (rows.results || []).map((r) => ({
      code: r.code,
      paymentId: r.payment_id,
      recipientHandle: r.recipient_handle || 'unknown',
      status: r.status === 'USED' ? 'USED' : 'ACTIVE',
    }));
  } catch {}

  const origin = resolveOrigin(env);

  return {
    inviteCode: personalCode || '',
    status: inviteRecord?.status === 'EXPIRED' ? 'USED' : 'ACTIVE',
    reusable: true,
    useCount,
    recentClaims,
    claimedBy: recentClaims[0] || null,
    inviteLink: `${origin}/login?invite=${personalCode}`,
    paymentInvites,
  };
}
