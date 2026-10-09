/**
 * Invite & Referral Service for UPRAIL
 * - Enforces 6 capital letter invite codes for first-time onboarding
 * - Allocates exactly 1 personal invite code per registered user in Settings
 * - Generates preloaded payment invites attached to send links
 * - Tracks who claimed each invite
 */

import type { Env, Invite, MyInviteResponse, RedeemInviteResponse } from '../types';

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

/**
 * Seeds genesis bootstrap invite codes if not already present.
 */
export async function ensureGenesisInvites(env: Env): Promise<void> {
  const genesisCodes = ['UPRAIL', 'LAUNCH', 'INTENT', 'ALPHA1', 'VAULTS', 'SECRET'];
  const now = Date.now();

  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        creator_x_id TEXT,
        creator_x_handle TEXT,
        claimed_by_x_id TEXT,
        claimed_by_x_handle TEXT,
        payment_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
      )`
    ).run();

    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS x_identities (
        x_id TEXT PRIMARY KEY,
        x_handle TEXT NOT NULL UNIQUE,
        x_name TEXT NOT NULL,
        near_account TEXT,
        is_activated INTEGER NOT NULL DEFAULT 0,
        personal_invite_code TEXT,
        invited_by_code TEXT,
        invited_by_handle TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
  } catch {}

  for (const code of genesisCodes) {
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

    if (row.status !== 'ACTIVE') {
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

/**
 * Redeems an invite code for a user, activating their account and
 * generating their 1 personal invite code to share.
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

  // 1. Mark invite as USED (user-generated personal invites are single-use; system bootstrap codes remain active)
  const isSystemGenesis = check.invite.creator_x_handle === 'system' || ['UPRAIL', 'LAUNCH', 'INTENT', 'ALPHA1', 'VAULTS', 'SECRET'].includes(code);
  if (!isSystemGenesis) {
    await env.DB.prepare(
      `UPDATE invites
       SET status = 'USED', claimed_by_x_id = ?, claimed_by_x_handle = ?, claimed_at = ?
       WHERE code = ? AND status = 'ACTIVE'`
    )
      .bind(user.x_id, cleanHandle, now, code)
      .run();
  }

  // 2. Generate exactly 1 personal invite code for the new user
  let personalCode = generateInviteCode();
  let attempts = 0;
  while (attempts < 5) {
    try {
      await env.DB.prepare(
        `INSERT INTO invites (code, creator_x_id, creator_x_handle, claimed_by_x_id, claimed_by_x_handle, payment_id, status, created_at, claimed_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 'ACTIVE', ?, NULL)`
      )
        .bind(personalCode, user.x_id, cleanHandle, now)
        .run();
      break;
    } catch {
      personalCode = generateInviteCode();
      attempts++;
    }
  }

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
 * Retrieves the user's 1 personal invite code and who used it.
 */
export async function getUserInvite(
  env: Env,
  xId: string,
  xHandle: string
): Promise<MyInviteResponse> {
  const cleanHandle = xHandle.toLowerCase();

  // 1. Fetch user identity to check personal_invite_code
  let identity = await env.DB.prepare(
    'SELECT is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
  )
    .bind(xId)
    .first<{ is_activated: number | null; personal_invite_code: string | null }>();

  let personalCode = identity?.personal_invite_code;

  // If activated but code missing, generate their 1 personal invite code
  if (!personalCode) {
    personalCode = generateInviteCode();
    const now = Date.now();
    try {
      await env.DB.prepare(
        `INSERT INTO invites (code, creator_x_id, creator_x_handle, claimed_by_x_id, claimed_by_x_handle, payment_id, status, created_at, claimed_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 'ACTIVE', ?, NULL)`
      )
        .bind(personalCode, xId, cleanHandle, now)
        .run();

      await env.DB.prepare(
        'UPDATE x_identities SET personal_invite_code = ?, updated_at = ? WHERE x_id = ?'
      )
        .bind(personalCode, now, xId)
        .run();
    } catch {}
  }

  // 2. Query personal invite record in DB to check claim status
  const inviteRecord = await env.DB.prepare(
    'SELECT * FROM invites WHERE code = ?'
  )
    .bind(personalCode)
    .first<Invite>();

  // 3. Query any payment-attached invites created by this user
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

  const origin = env.WEBAUTHN_ORIGIN || 'https://app.uprail.world';

  return {
    inviteCode: personalCode || '',
    status: inviteRecord?.status === 'USED' ? 'USED' : 'ACTIVE',
    claimedBy:
      inviteRecord?.status === 'USED' && inviteRecord.claimed_by_x_handle
        ? {
            handle: inviteRecord.claimed_by_x_handle,
            claimedAt: inviteRecord.claimed_at || Date.now(),
          }
        : null,
    inviteLink: `${origin}/login?invite=${personalCode}`,
    paymentInvites,
  };
}
