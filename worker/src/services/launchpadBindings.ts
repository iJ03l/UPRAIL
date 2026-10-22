import type { Env } from '../types';

export interface LaunchpadTokenBinding {
  token: string;
  launchpad: string;
  launchpadName: string;
  handle: string;
  authority: string;
  verificationJson: string;
  claimJson: string | null;
  launchId: string | null;
  verifiedFeeTo: string;
  pendingClaimTx: string | null;
  pendingClaimAt: number | null;
  pendingClaimTokenAtomic: string | null;
  pendingClaimQuoteAtomic: string | null;
  createdAt: number;
  updatedAt: number;
}

interface BindingRow {
  token: string;
  launchpad: string;
  launchpad_name: string | null;
  handle: string;
  authority: string | null;
  verification_json: string | null;
  claim_json: string | null;
  launch_id: string | null;
  verified_fee_to: string;
  pending_claim_tx: string | null;
  pending_claim_at: number | null;
  pending_claim_token_atomic: string | null;
  pending_claim_quote_atomic: string | null;
  created_at: number;
  updated_at: number;
}

function fromRow(row: BindingRow): LaunchpadTokenBinding {
  return {
    token: row.token,
    launchpad: row.launchpad,
    launchpadName: row.launchpad_name || row.launchpad,
    handle: row.handle,
    authority: row.authority || '',
    verificationJson: row.verification_json || '{}',
    claimJson: row.claim_json || null,
    launchId: row.launch_id,
    verifiedFeeTo: row.verified_fee_to,
    pendingClaimTx: row.pending_claim_tx,
    pendingClaimAt: row.pending_claim_at,
    pendingClaimTokenAtomic: row.pending_claim_token_atomic,
    pendingClaimQuoteAtomic: row.pending_claim_quote_atomic,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLaunchpadTokenBinding(
  env: Env,
  token: string
): Promise<LaunchpadTokenBinding | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT token, launchpad, launchpad_name, handle, authority,
              verification_json, claim_json, launch_id, verified_fee_to,
              pending_claim_tx, pending_claim_at, pending_claim_token_atomic,
              pending_claim_quote_atomic, created_at, updated_at
       FROM launchpad_token_bindings WHERE token = ? LIMIT 1`
    )
      .bind(token.toLowerCase())
      .first<BindingRow>();
    return row ? fromRow(row) : null;
  } catch {
    return null;
  }
}

export async function findLaunchpadTokenBindingByPendingClaim(
  env: Env,
  txHash: string
): Promise<LaunchpadTokenBinding | null> {
  if (!env.DB || !txHash) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT token, launchpad, launchpad_name, handle, authority,
              verification_json, claim_json, launch_id, verified_fee_to,
              pending_claim_tx, pending_claim_at, pending_claim_token_atomic,
              pending_claim_quote_atomic, created_at, updated_at
       FROM launchpad_token_bindings WHERE pending_claim_tx = ? LIMIT 1`
    )
      .bind(txHash)
      .first<BindingRow>();
    return row ? fromRow(row) : null;
  } catch {
    return null;
  }
}

export async function listPendingLaunchpadClaims(
  env: Env,
  launchpad: string,
  limit = 10
): Promise<LaunchpadTokenBinding[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT token, launchpad, launchpad_name, handle, authority,
              verification_json, claim_json, launch_id, verified_fee_to,
              pending_claim_tx, pending_claim_at, pending_claim_token_atomic,
              pending_claim_quote_atomic, created_at, updated_at
       FROM launchpad_token_bindings
       WHERE launchpad = ? AND pending_claim_tx IS NOT NULL
       ORDER BY pending_claim_at ASC LIMIT ?`
    )
      .bind(launchpad, limit)
      .all<BindingRow>();
    return (results || []).map(fromRow);
  } catch {
    return [];
  }
}

export async function listLaunchpadTokenBindings(
  env: Env,
  limit = 50
): Promise<LaunchpadTokenBinding[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT token, launchpad, launchpad_name, handle, authority,
              verification_json, claim_json, launch_id, verified_fee_to,
              pending_claim_tx, pending_claim_at, pending_claim_token_atomic,
              pending_claim_quote_atomic, created_at, updated_at
       FROM launchpad_token_bindings ORDER BY created_at DESC LIMIT ?`
    )
      .bind(limit)
      .all<BindingRow>();
    return (results || []).map(fromRow);
  } catch {
    return [];
  }
}

export async function listLaunchpadClaimBindings(
  env: Env,
  limit = 50
): Promise<LaunchpadTokenBinding[]> {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT token, launchpad, launchpad_name, handle, authority,
              verification_json, claim_json, launch_id, verified_fee_to,
              pending_claim_tx, pending_claim_at, pending_claim_token_atomic,
              pending_claim_quote_atomic, created_at, updated_at
       FROM launchpad_token_bindings
       WHERE claim_json IS NOT NULL
       ORDER BY updated_at ASC LIMIT ?`
    )
      .bind(limit)
      .all<BindingRow>();
    return (results || []).map(fromRow);
  } catch {
    return [];
  }
}

export async function touchLaunchpadTokenBinding(env: Env, token: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'UPDATE launchpad_token_bindings SET updated_at = ? WHERE token = ?'
    )
      .bind(Date.now(), token.toLowerCase())
      .run();
  } catch {}
}

export async function hasRoutedLaunchpadFees(env: Env, token: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM payments
       WHERE origin LIKE 'launchpad:%'
         AND (
           LOWER(asset) = ? OR LOWER(asset) = ?
           OR (intent_hash LIKE 'claim:%' AND instr(intent_hash, ?) > 0)
         )
       LIMIT 1`
    )
      .bind(token.toLowerCase(), `nep141:${token.toLowerCase()}`, `:${token.toLowerCase()}`)
      .first<{ id: string }>();
    return !!row;
  } catch {
    return false;
  }
}

export async function upsertLaunchpadTokenBinding(
  env: Env,
  input: {
    token: string;
    launchpad: string;
    launchpadName?: string;
    handle: string;
    authority: string;
    verificationJson: string;
    claimJson: string | null;
    launchId?: string | null;
    verifiedFeeTo: string;
    createdAt?: number;
  }
): Promise<LaunchpadTokenBinding | null> {
  if (!env.DB) return null;
  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  try {
    await env.DB.prepare(
      `INSERT INTO launchpad_token_bindings (
         token, launchpad, launchpad_name, handle, authority, verification_json,
         claim_json, launch_id, verified_fee_to, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         launchpad = excluded.launchpad,
         launchpad_name = excluded.launchpad_name,
         handle = excluded.handle,
         authority = excluded.authority,
         verification_json = excluded.verification_json,
         claim_json = excluded.claim_json,
         launch_id = excluded.launch_id,
         verified_fee_to = excluded.verified_fee_to,
         updated_at = excluded.updated_at`
    )
      .bind(
        input.token.toLowerCase(),
        input.launchpad,
        input.launchpadName || input.launchpad,
        input.handle,
        input.authority,
        input.verificationJson,
        input.claimJson,
        input.launchId ?? null,
        input.verifiedFeeTo,
        createdAt,
        now
      )
      .run();
    return await getLaunchpadTokenBinding(env, input.token);
  } catch {
    return null;
  }
}

export async function setPendingLaunchpadClaim(
  env: Env,
  token: string,
  params: {
    txHash: string;
    tokenAtomic: string;
    quoteAtomic: string;
  }
): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const result = await env.DB.prepare(
      `UPDATE launchpad_token_bindings
       SET pending_claim_tx = ?, pending_claim_at = ?,
           pending_claim_token_atomic = ?, pending_claim_quote_atomic = ?,
           updated_at = ?
       WHERE token = ? AND pending_claim_tx IS NULL`
    )
      .bind(
        params.txHash,
        Date.now(),
        params.tokenAtomic,
        params.quoteAtomic,
        Date.now(),
        token.toLowerCase()
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function clearPendingLaunchpadClaim(
  env: Env,
  token: string,
  txHash?: string
): Promise<void> {
  if (!env.DB) return;
  try {
    if (txHash) {
      await env.DB.prepare(
        `UPDATE launchpad_token_bindings
         SET pending_claim_tx = NULL, pending_claim_at = NULL,
             pending_claim_token_atomic = NULL, pending_claim_quote_atomic = NULL,
             updated_at = ?
         WHERE token = ? AND pending_claim_tx = ?`
      )
        .bind(Date.now(), token.toLowerCase(), txHash)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE launchpad_token_bindings
         SET pending_claim_tx = NULL, pending_claim_at = NULL,
             pending_claim_token_atomic = NULL, pending_claim_quote_atomic = NULL,
             updated_at = ?
         WHERE token = ?`
      )
        .bind(Date.now(), token.toLowerCase())
        .run();
    }
  } catch {}
}
