/**
 * Launchpad creator-fee routing for UP (UPRAIL.app).
 *
 * A launchpad points creator fees at an X handle and reports each fee by
 * webhook. The paired token is pushed to the pooled escrow account and rides
 * the SAME pipeline as a human send:
 *
 *   - known handle   → settled straight into the handle's vault (instant credit)
 *   - unknown handle → held as an ESCROWED receivable, claimable the moment the
 *                      handle signs up (via the normal claim flow)
 *
 * Tokens are held as-is; no protocol fee is taken. Launchpad-sourced rows carry
 * `origin = 'launchpad:<name>'`, and are stamped with a far-future expiry so the
 * refund sweep can never claw a creator's fee back to the launchpad.
 */

import { PaymentStatus, type Env } from '../types';
import * as nearRpc from './nearRpc';
import type { LaunchpadPartner } from './launchpadKeys';

/** 2100-01-01. Launchpad fees never expire/refund; this keeps them out of sweeps. */
export const LAUNCHPAD_FEE_EXPIRES_AT = 4102444800000;

/** How long a successful escrow registration is remembered. */
const REG_CACHE_TTL_SECONDS = 30 * 24 * 3600;

export function escrowHoldingAccount(env: Env): string {
  return env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
}

/** Normalizes '@Handle ' → 'handle'. Returns null when it is not a valid handle. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(h) ? h : null;
}

/** Exact decimal string from atomic units (no precision loss, no exponent). */
export function fromAtomic(atomic: string, decimals: number): string {
  const s = (atomic || '0').replace(/^\+/, '').replace(/^-/, '');
  if (!/^\d+$/.test(s)) return '0';
  const padded = s.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const intTrimmed = intPart.replace(/^0+(?=\d)/, '');
  return frac ? `${intTrimmed}.${frac}` : intTrimmed;
}

/** Extracts a NEP-141 contract id from `nep141:<contract>` or a bare contract. */
export function contractFromToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;
  const contract = (t.toLowerCase().startsWith('nep141:') ? t.slice(7) : t).toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(contract) ? contract : null;
}

export interface LaunchpadToken {
  contractId: string;
  decimals: number;
  symbol: string;
  /** Canonical asset string stored on the payment row. */
  asset: string;
}

/**
 * Resolves a launchpad token to its contract, decimals, symbol and canonical
 * asset string. Prefers the curated/Rhea registries (which know live launchpad
 * tokens) and falls back to reading `ft_metadata` straight from the contract so
 * a brand-new token is still routable. Returns null when the contract does not
 * answer as a NEP-141.
 */
export async function resolveLaunchpadToken(
  env: Env,
  token: unknown
): Promise<LaunchpadToken | null> {
  const contractId = contractFromToken(token);
  if (!contractId) return null;

  try {
    const tokens = await nearRpc.getSupportedTokens(env);
    const hit = nearRpc.resolveTokenForAsset(contractId, tokens) ||
      (await nearRpc.resolveRheaToken(env, contractId));
    if (hit && hit.nearContractId) {
      return {
        contractId: hit.nearContractId,
        decimals: hit.decimals ?? 18,
        symbol: hit.symbol || '',
        asset: hit.defuse_asset_id || `nep141:${hit.nearContractId}`,
      };
    }
  } catch {
    // fall through to on-chain metadata
  }

  const meta = await nearRpc.getFtContractMetadata(env, contractId);
  if (!meta) return null;
  return { contractId, decimals: meta.decimals, symbol: meta.symbol, asset: `nep141:${contractId}` };
}

/**
 * Registers escrow on a token so a launchpad's push is accepted. Idempotent and
 * memoized in KV; consumes one unit of the partner's daily registration quota
 * only when a real registration is attempted. Each registration costs escrow
 * gas, so the quota bounds the damage a compromised partner key can do.
 */
export async function registerEscrowForToken(
  env: Env,
  partner: LaunchpadPartner,
  contractId: string
): Promise<{ registered: boolean; reason?: string }> {
  const cacheKey = `fees:reg:${contractId}`;
  if (env.CACHE) {
    try {
      if (await env.CACHE.get(cacheKey)) return { registered: true };
    } catch {
      // KV miss on error: fall through and (re)register.
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const regsToday = partner.regs_day === today ? partner.regs_today : 0;
  if (regsToday >= (partner.daily_reg_cap ?? 25)) {
    return { registered: false, reason: 'Daily escrow-registration quota reached for this partner.' };
  }

  const res = await nearRpc.ensureEscrowStorageRegistered(env, contractId);
  if (res.registered && env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, '1', { expirationTtl: REG_CACHE_TTL_SECONDS });
    } catch {
      // Best-effort; the in-isolate cache still prevents repeat txs.
    }
  }
  if (res.registered && env.DB) {
    try {
      await env.DB.prepare(
        'UPDATE launchpad_partners SET regs_day = ?, regs_today = ? WHERE id = ?'
      )
        .bind(today, regsToday + 1, partner.id)
        .run();
    } catch (err) {
      console.warn('[launchpadFees] registration quota update failed:', err);
    }
  }
  return res;
}

export interface InboundFee {
  ok: boolean;
  amountAtomic?: string;
  error?: string;
}

/**
 * Confirms an on-chain transaction actually moved `contractId` tokens into the
 * escrow holding account. Everything credited to a handle is gated on this, so
 * a partner cannot mint balance by reporting a hash that did not pay us.
 */
export async function verifyInboundFeeTx(
  env: Env,
  txHash: string,
  contractId: string
): Promise<InboundFee> {
  const escrow = escrowHoldingAccount(env);
  const probe = await nearRpc.probeNearTransaction(env, txHash);
  if (!probe.found) return { ok: false, error: probe.error || 'transaction not found' };
  if (!probe.success) return { ok: false, error: 'transaction did not succeed' };

  let best: bigint | null = null;
  for (const t of probe.transfers) {
    if (t.kind !== 'ft') continue;
    if ((t.to || '').toLowerCase() !== escrow.toLowerCase()) continue;
    if (t.contract && t.contract.toLowerCase() !== contractId.toLowerCase()) continue;
    try {
      const amt = BigInt(t.amountAtomic || '0');
      if (best === null || amt > best) best = amt;
    } catch {
      // ignore unparseable amounts
    }
  }
  if (best === null || best <= 0n) {
    return { ok: false, error: `no ${contractId} transfer into the escrow account found in that tx` };
  }
  return { ok: true, amountAtomic: best.toString() };
}

export interface RecordFeeParams {
  launchpad: string;
  handle: string;
  token: unknown;
  txHash: string;
  memo?: string;
}

export interface RecordFeeResult {
  ok: boolean;
  id?: string;
  asset?: string;
  amount?: string;
  routing?: 'direct' | 'escrow';
  status?: PaymentStatus;
  claimTxHash?: string;
  error?: string;
}

/**
 * Records and routes one creator fee. Verifies the inbound transaction, then:
 *  - known handle   → escrow → vault transfer, row inserted CLAIMED
 *  - unknown handle → row inserted ESCROWED, claimable on sign-up
 * Idempotent on the inbound tx hash.
 */
export async function recordLaunchpadFee(
  env: Env,
  params: RecordFeeParams
): Promise<RecordFeeResult> {
  const token = await resolveLaunchpadToken(env, params.token);
  if (!token) return { ok: false, error: 'Unknown or non-NEP-141 token contract.' };

  const origin = `launchpad:${params.launchpad}`;

  // Idempotency: the same inbound tx must never be credited twice.
  try {
    const existing = await env.DB.prepare(
      'SELECT id, status, claim_tx_hash FROM payments WHERE intent_hash = ? LIMIT 1'
    )
      .bind(params.txHash)
      .first<{ id: string; status: string; claim_tx_hash: string | null }>();
    if (existing) {
      return {
        ok: true,
        id: existing.id,
        asset: token.asset,
        routing: existing.status === PaymentStatus.CLAIMED ? 'direct' : 'escrow',
        status: existing.status as PaymentStatus,
        claimTxHash: existing.claim_tx_hash || undefined,
      };
    }
  } catch (err) {
    console.warn('[launchpadFees] dedupe check failed:', err);
  }

  const inbound = await verifyInboundFeeTx(env, params.txHash, token.contractId);
  if (!inbound.ok || !inbound.amountAtomic) {
    return { ok: false, error: inbound.error || 'inbound verification failed' };
  }
  const amount = fromAtomic(inbound.amountAtomic, token.decimals);

  const identity = await env.DB.prepare(
    'SELECT x_id, x_handle, near_account FROM x_identities WHERE LOWER(x_handle) = ?'
  )
    .bind(params.handle)
    .first<{ x_id: string; x_handle: string; near_account: string | null }>();

  const id = `fee_${crypto.randomUUID()}`;
  const now = Date.now();
  const memo = params.memo || `${params.launchpad} creator fees`;

  // Unknown handle: hold as an escrowed receivable.
  if (!identity) {
    await env.DB.prepare(
      `INSERT INTO payments (
         id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
         asset, amount, fee, fee_recipient, memo, status, intent_hash,
         created_at, expires_at, updated_at, origin
       ) VALUES (?, NULL, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        origin,
        params.handle,
        token.asset,
        amount,
        memo,
        PaymentStatus.ESCROWED,
        params.txHash,
        now,
        LAUNCHPAD_FEE_EXPIRES_AT,
        now,
        origin
      )
      .run();
    return { ok: true, id, asset: token.asset, amount, routing: 'escrow', status: PaymentStatus.ESCROWED };
  }

  // Known handle: settle straight into the vault (instant credit).
  let claimTxHash: string | undefined;
  let settled = false;
  try {
    const vault = await nearRpc.resolveUserNearAccount(env, {
      x_id: identity.x_id,
      x_handle: identity.x_handle,
      near_account: identity.near_account,
    });
    const payout = await nearRpc.executeEscrowFtTransferByContract(
      env,
      token.contractId,
      vault,
      inbound.amountAtomic
    );
    if (payout.success && payout.txHash) {
      claimTxHash = payout.txHash;
      settled = true;
    } else {
      console.warn('[launchpadFees] instant credit failed, falling back to escrow:', payout.error);
    }
  } catch (err: any) {
    console.warn('[launchpadFees] instant credit threw, falling back to escrow:', err?.message || err);
  }

  await env.DB.prepare(
    `INSERT INTO payments (
       id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
       asset, amount, fee, fee_recipient, memo, status, intent_hash, claim_tx_hash,
       created_at, expires_at, updated_at, origin
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      origin,
      params.handle,
      identity.x_id,
      token.asset,
      amount,
      memo,
      settled ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED,
      params.txHash,
      claimTxHash ?? null,
      now,
      settled ? now : LAUNCHPAD_FEE_EXPIRES_AT,
      now,
      origin
    )
    .run();

  return {
    ok: true,
    id,
    asset: token.asset,
    amount,
    routing: settled ? 'direct' : 'escrow',
    status: settled ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED,
    claimTxHash,
  };
}
