/**
 * Launchpad creator-fee routing for UP (UPRAIL.app).
 *
 * Integrated launchpads bind a token to an X handle through the signed
 * registration endpoint; older launches still use the token description as a
 * fallback. UPRAIL detects each fee over NEAR RPC and routes it through the
 * SAME pipeline as a human send:
 *
 *   - known handle   → settled straight into the handle's vault (instant credit)
 *   - unknown handle → held as an ESCROWED receivable, claimable the moment the
 *                      handle signs up (via the normal claim flow)
 *
 * The standard protocol fee (FEE_PERCENT, 1%) is carved out at source, exactly
 * like a peer send: the launchpad pushes the gross token amount and the creator
 * is credited the net, with the 1% left in escrow (which is also the fee
 * account). A known-price fee below MIN_FEE_USD is held rather than settled
 * immediately, so escrow gas is never spent settling dust. Launchpad-sourced
 * rows carry `origin = 'launchpad:<name>'`, and are stamped with a far-future
 * expiry so the refund sweep can never claw a creator's fee back.
 */

import { PaymentStatus, type Env } from '../types';
import * as nearRpc from './nearRpc';
import { getLaunchpadTokenBinding, listLaunchpadTokenBindings } from './launchpadBindings';
import { isConfidentialRailEnabled, payEscrowPrivate } from './confidentialRail';

/** 2100-01-01. Launchpad fees never expire/refund; this keeps them out of sweeps. */
export const LAUNCHPAD_FEE_EXPIRES_AT = 4102444800000;

/** How long a successful escrow registration is remembered. */
const REG_CACHE_TTL_SECONDS = 30 * 24 * 3600;

/** Default daily cap on unauthenticated (zero-integration) registrations. */
const PUBLIC_REG_DAILY_CAP = 50;

export function escrowHoldingAccount(env: Env): string {
  return env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
}

/** Where the protocol fee is routed. Same escrow account by default. */
export function feeAccount(env: Env): string {
  return env.FEE_ACCOUNT_ID || escrowHoldingAccount(env);
}

/** The protocol fee rate as a percent float (FEE_PERCENT, default 1%). */
export function protocolFeePercent(env: Env): number {
  const p = parseFloat(env.FEE_PERCENT ?? '0.01');
  return Number.isFinite(p) && p >= 0 && p < 1 ? p : 0.01;
}

/** Creator-fee dust guard in USD (MIN_FEE_USD, default 1). */
export function minFeeUsd(env: Env): number {
  const p = parseFloat(env.MIN_FEE_USD ?? '1');
  return Number.isFinite(p) && p >= 0 ? p : 1;
}

/**
 * Balance-delta creator-fee routing is disabled until attribution is verified
 * against a transaction. Escrow also holds user funds, so a surplus can never
 * be assumed to be a creator fee. Default off.
 */
export function creatorFeesEnabled(env: Env): boolean {
  const value = (env.CREATOR_FEES_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * Splits a gross atomic amount into (net, fee) using integer math only, so no
 * wei is ever lost to float rounding. The fee is floored; the net absorbs the
 * remainder. Returns fee 0n when the rate is zero.
 */
export function splitProtocolFee(
  grossAtomic: bigint,
  percent: number
): { netAtomic: bigint; feeAtomic: bigint } {
  if (grossAtomic <= 0n || percent <= 0) return { netAtomic: grossAtomic, feeAtomic: 0n };
  const bps = BigInt(Math.round(percent * 10000));
  const feeAtomic = (grossAtomic * bps) / 10000n;
  return { netAtomic: grossAtomic - feeAtomic, feeAtomic };
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
  /** Live USD price from the registry when known; absent for brand-new tokens. */
  priceUsd?: number;
  /** NEP-141 description, when the contract exposes one. */
  description?: string;
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
  token: unknown,
  includeDescription = false
): Promise<LaunchpadToken | null> {
  const contractId = contractFromToken(token);
  if (!contractId) return null;

  try {
    const tokens = await nearRpc.getSupportedTokens(env);
    const hit = nearRpc.resolveTokenForAsset(contractId, tokens) ||
      (await nearRpc.resolveRheaToken(env, contractId));
    if (hit && hit.nearContractId) {
      let description: string | undefined;
      if (includeDescription) {
        const meta = await nearRpc.getFtContractMetadata(env, hit.nearContractId);
        description = meta?.description;
      }
      return {
        contractId: hit.nearContractId,
        decimals: hit.decimals ?? 18,
        symbol: hit.symbol || '',
        asset: hit.defuse_asset_id || `nep141:${hit.nearContractId}`,
        priceUsd: typeof hit.priceUsd === 'number' ? hit.priceUsd : undefined,
        description,
      };
    }
  } catch {
    // fall through to on-chain metadata
  }

  const meta = await nearRpc.getFtContractMetadata(env, contractId);
  if (!meta) return null;
  return {
    contractId,
    decimals: meta.decimals,
    symbol: meta.symbol,
    asset: `nep141:${contractId}`,
    description: meta.description,
  };
}

/**
 * Shared base contracts that hold multi-user pooled funds in escrow.uprail.near
 * and must never be attributed to a single creator by whole-account balance delta.
 */
const SHARED_POOL_CONTRACTS = new Set([
  'wrap.near',
  'usdc.token.near',
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  'usdt.tether-token.near',
  'eth.bridge.near',
  'sol.omft.near',
  'btc.omft.near',
  '853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near',
  'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near',
]);

export function isSharedPoolContract(contractId: string): boolean {
  const c = (contractId || '').trim().toLowerCase();
  if (!c) return true;
  if (SHARED_POOL_CONTRACTS.has(c)) return true;
  if (c.endsWith('.omft.near') || c.endsWith('.factory.bridge.near')) return true;
  return false;
}

export function inferLaunchpadFromContract(contractId: string): string {
  const c = (contractId || '').toLowerCase();
  if (c.includes('nearlytrade') || c.includes('nearlypad') || c.includes('nearly')) return 'nearly';
  if (c.includes('justhoot')) return 'justhoot';
  if (c.includes('meme-cooking') || c.includes('cookinglabs')) return 'meme-cooking';
  if (c.includes('launch.intear.near') || c.includes('intear')) return 'intear';
  return 'direct';
}

export interface TrackedLaunchpadToken {
  contractId: string;
  handle: string | null;
  launchpad: string;
  updatedAt: number;
}

const TRACKED_TOKENS_LIST_KEY = 'fees:tracked_tokens:v1';
const TRACKED_TOKEN_META_KEY = (contractId: string) => `fees:token_meta:v1:${contractId.toLowerCase()}`;
const TRACKED_TOKEN_TTL_SECONDS = 90 * 24 * 3600;

/**
 * Remembers a launchpad token (and optional creator handle) in KV and D1 so
 * automatic RPC balance-delta sync knows to watch it even before FastNEAR
 * indexes the first transfer.
 */
export async function trackLaunchpadToken(
  env: Env,
  params: { contractId: string; handle?: string | null; launchpad?: string }
): Promise<void> {
  const contractId = contractFromToken(params.contractId);
  if (!contractId || isSharedPoolContract(contractId)) return;
  const handle = normalizeHandle(params.handle);
  const launchpad = params.launchpad || inferLaunchpadFromContract(contractId);
  const now = Date.now();

  if (env.CACHE) {
    try {
      const existing = (await env.CACHE.get(TRACKED_TOKEN_META_KEY(contractId), 'json').catch(() => null)) as
        | TrackedLaunchpadToken
        | null;
      const meta: TrackedLaunchpadToken = {
        contractId,
        handle: handle || existing?.handle || null,
        launchpad: params.launchpad || existing?.launchpad || launchpad,
        updatedAt: now,
      };
      await env.CACHE.put(TRACKED_TOKEN_META_KEY(contractId), JSON.stringify(meta), {
        expirationTtl: TRACKED_TOKEN_TTL_SECONDS,
      });

      const listRaw = (await env.CACHE.get(TRACKED_TOKENS_LIST_KEY, 'json').catch(() => null)) as string[] | null;
      const list = Array.isArray(listRaw) ? listRaw : [];
      const next = [contractId, ...list.filter((x) => x !== contractId)].slice(0, 200);
      await env.CACHE.put(TRACKED_TOKENS_LIST_KEY, JSON.stringify(next), {
        expirationTtl: TRACKED_TOKEN_TTL_SECONDS,
      });
    } catch (err) {
      console.warn('[launchpadFees] KV trackLaunchpadToken failed:', err);
    }
  }

  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO launchpad_events (id, partner_id, event_id, type, token, handle, tx_hash, status, error, created_at)
         VALUES (?, 'auto', ?, 'token.tracked', ?, ?, NULL, 'tracked', NULL, ?)
         ON CONFLICT(partner_id, event_id) DO UPDATE SET
           handle = COALESCE(excluded.handle, launchpad_events.handle),
           created_at = excluded.created_at`
      )
        .bind(`lpe_${crypto.randomUUID()}`, `track:${contractId}`, contractId, handle, now)
        .run();
    } catch {
      // D1 table is optional in unit tests
    }
  }
}

export async function getTrackedLaunchpadToken(
  env: Env,
  contractId: string
): Promise<TrackedLaunchpadToken | null> {
  const c = contractFromToken(contractId);
  if (!c) return null;
  if (env.CACHE) {
    try {
      const meta = (await env.CACHE.get(TRACKED_TOKEN_META_KEY(c), 'json')) as TrackedLaunchpadToken | null;
      if (meta && typeof meta === 'object' && meta.contractId) return meta;
    } catch {}
  }
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT token, handle, created_at FROM launchpad_events
         WHERE token = ? AND handle IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      )
        .bind(c)
        .first<{ token: string; handle: string | null; created_at: number }>();
      if (row) {
        return {
          contractId: c,
          handle: normalizeHandle(row.handle),
          launchpad: inferLaunchpadFromContract(c),
          updatedAt: row.created_at || Date.now(),
        };
      }
    } catch {}
  }
  return null;
}

/**
 * Reads a creator-fee recipient handle straight from a token's NEP-141
 * description. Recognizes the canonical line and falls back to the first
 * `@handle` mentioned:
 *
 *   "Fees to @handle via UPRAIL"  → handle
 */
export function deriveHandleFromDescription(description: unknown): string | null {
  if (typeof description !== 'string' || !description) return null;
  const canonical = description.match(/fees\s+to\s+@?([a-z0-9_]{1,15})\s+via\s+uprail/i);
  if (canonical) return normalizeHandle(canonical[1]);
  const first = description.match(/@([a-z0-9_]{1,15})\b/i);
  return first ? normalizeHandle(first[1]) : null;
}

/**
 * Handle carried by an adapter payout. Only the canonical memo counts.
 * A launchpad's own fee memo, such as `{"role":"token_owner"}`, is not a handle.
 */
export function deriveHandleFromMemo(memo: unknown): string | null {
  if (typeof memo !== 'string' || !memo) return null;
  const canonical = memo.match(/fees\s+to\s+@?([a-z0-9_]{1,15})\s+via\s+uprail/i);
  return canonical ? normalizeHandle(canonical[1]) : null;
}

export function uprailFeeMemo(handle: string): string {
  const normalized = normalizeHandle(handle);
  if (!normalized) throw new Error('A valid X handle is required.');
  return `Fees to @${normalized} via UPRAIL`;
}

/**
 * Escrow registration for the zero-integration path. A token that points its
 * creator fees at escrow can be prepared by anyone. Abuse (a stranger making
 * escrow spend storage gas) is bounded by the same per-contract KV cache plus a
 * global daily counter, so the first registration of a token is the only one
 * that can cost anything.
 */
export async function registerEscrowForTokenPublic(
  env: Env,
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

  const cap = parseInt(env.PUBLIC_REG_DAILY_CAP ?? '', 10);
  const dailyCap = Number.isFinite(cap) && cap >= 0 ? cap : PUBLIC_REG_DAILY_CAP;
  const day = new Date().toISOString().slice(0, 10);
  const counterKey = `fees:pubreg:${day}`;
  let used = 0;
  if (env.CACHE) {
    try {
      used = parseInt((await env.CACHE.get(counterKey)) || '0', 10) || 0;
    } catch {
      // treat an unreadable counter as 0
    }
    if (used >= dailyCap) {
      return { registered: false, reason: 'Daily public escrow-registration cap reached.' };
    }
  }

  const res = await nearRpc.ensureEscrowStorageRegistered(env, contractId);
  if (res.registered && env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, '1', { expirationTtl: REG_CACHE_TTL_SECONDS });
      await env.CACHE.put(counterKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 });
    } catch {
      // Best-effort; the in-isolate cache still prevents repeat txs.
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
 * a caller cannot mint balance by reporting a hash that did not pay us.
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
    if ((t.to || '').toLowerCase() !== escrow.toLowerCase()) continue;
    if (t.kind === 'ft') {
      if (t.contract && t.contract.toLowerCase() !== contractId.toLowerCase()) continue;
    } else if (t.kind === 'native' && contractId.toLowerCase() === 'wrap.near') {
      // Allow native NEAR transfers into escrow when routed as wrap.near / NEAR
    } else {
      continue;
    }
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
  token: unknown;
  txHash: string;
  memo?: string;
}

export interface RecordFeeResult {
  ok: boolean;
  id?: string;
  asset?: string;
  amount?: string;
  /** Protocol fee carved out of the gross (5% by default). */
  fee?: string;
  routing?: 'direct' | 'escrow';
  status?: PaymentStatus;
  claimTxHash?: string;
  /** True when a known-price dust fee was held instead of settled immediately. */
  deferred?: boolean;
  error?: string;
}

/**
 * Calculates the exact atomic amount of `contractId` currently sitting in
 * `escrow.uprail.near` that is ALREADY accounted for in D1 `payments`:
 *   - ESCROWED rows: net `amount` + protocol `fee` (both still in escrow)
 *   - CLAIMED launchpad rows: protocol `fee` (which stays in escrow), plus
 *     `amount` ONLY if `claim_tx_hash` is synthetic (i.e. net never left escrow on-chain).
 */
export async function getAccountedEscrowAtomic(
  env: Env,
  contractId: string,
  canonicalAsset: string,
  decimals: number
): Promise<bigint> {
  if (!env.DB) return 0n;
  const escrow = escrowHoldingAccount(env).toLowerCase();
  const cLower = contractId.toLowerCase();
  const aLower = canonicalAsset.toLowerCase();

  try {
    const { results } = await env.DB.prepare(
      `SELECT amount, fee, fee_recipient, status, claim_tx_hash, origin
       FROM payments
       WHERE (LOWER(asset) = ? OR LOWER(asset) = ?)
         AND status IN ('ESCROWED', 'CLAIMED', 'PENDING', 'DEPOSIT_WAITING')`
    )
      .bind(aLower, cLower)
      .all<{
        amount: string;
        fee: string | null;
        fee_recipient: string | null;
        status: string;
        claim_tx_hash: string | null;
        origin: string | null;
      }>();

    let total = 0n;
    for (const row of results || []) {
      const amtAtomic = BigInt(nearRpc.toBaseUnits(row.amount || '0', decimals) || '0');
      const feeAtomic = BigInt(nearRpc.toBaseUnits(row.fee || '0', decimals) || '0');
      const isLaunchpad = (row.origin || '').startsWith('launchpad:');
      const feeInEscrow = isLaunchpad || (row.fee_recipient || '').toLowerCase() === escrow;

      if (row.status === PaymentStatus.ESCROWED) {
        total += amtAtomic + (feeInEscrow ? feeAtomic : 0n);
      } else if (row.status === PaymentStatus.CLAIMED) {
        if (feeInEscrow) total += feeAtomic;
        if (isLaunchpad && nearRpc.isSyntheticTxHash(row.claim_tx_hash)) {
          total += amtAtomic;
        }
      }
    }
    return total;
  } catch (err) {
    console.warn('[launchpadFees] getAccountedEscrowAtomic failed:', err);
    return 0n;
  }
}

export async function creditVerifiedFeeAtomic(
  env: Env,
  opts: {
    launchpad: string;
    handle: string;
    token: LaunchpadToken;
    grossAtomic: bigint;
    intentHash: string;
    memo?: string;
  }
): Promise<RecordFeeResult> {
  const { launchpad, handle, token, grossAtomic, intentHash } = opts;
  const origin = `launchpad:${launchpad}`;

  const { netAtomic, feeAtomic } = splitProtocolFee(grossAtomic, protocolFeePercent(env));
  const netAtomicStr = netAtomic.toString();
  const amount = fromAtomic(netAtomicStr, token.decimals);
  const fee = fromAtomic(feeAtomic.toString(), token.decimals);
  const feeRecipient = feeAccount(env);

  const netUsd =
    typeof token.priceUsd === 'number' && token.priceUsd > 0
      ? parseFloat(amount) * token.priceUsd
      : null;
  const dustGuard = netUsd !== null && netUsd < minFeeUsd(env);

  const identity = await env.DB.prepare(
    'SELECT x_id, x_handle, near_account FROM x_identities WHERE LOWER(x_handle) = ?'
  )
    .bind(handle)
    .first<{ x_id: string; x_handle: string; near_account: string | null }>();

  const id = `fee_${crypto.randomUUID()}`;
  const now = Date.now();
  const memo = opts.memo || `${launchpad} creator fees`;
  const privacyRail = isConfidentialRailEnabled(env) ? 'confidential' : 'public';

  if (!identity || dustGuard) {
    await env.DB.prepare(
      `INSERT INTO payments (
         id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
         asset, amount, fee, fee_recipient, memo, status, intent_hash,
         created_at, expires_at, updated_at, origin, privacy_rail, settlement_status,
         claim_deposit_address, confirmed_at
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        origin,
        handle,
        identity?.x_id ?? null,
        token.asset,
        amount,
        fee,
        feeRecipient,
        memo,
        PaymentStatus.ESCROWED,
        intentHash,
        now,
        LAUNCHPAD_FEE_EXPIRES_AT,
        now,
        origin,
        privacyRail,
        null,
        null,
        null
      )
      .run();
    return {
      ok: true,
      id,
      asset: token.asset,
      amount,
      fee,
      routing: 'escrow',
      status: PaymentStatus.ESCROWED,
      deferred: dustGuard && !!identity,
    };
  }

  let claimTxHash: string | undefined;
  let claimDepositAddress: string | null = null;
  let settlementStatus: string | null = null;
  let confirmedAt: number | null = null;
  let settled = false;

  if (privacyRail === 'confidential') {
    try {
      const vault = await nearRpc.resolveUserNearAccount(env, {
        x_id: identity.x_id,
        x_handle: identity.x_handle,
        near_account: identity.near_account,
      });
      const payout = await payEscrowPrivate(env, {
        asset: token.asset,
        amount,
        recipientAccount: vault,
      });
      claimDepositAddress = payout.depositAddress;
      settlementStatus = payout.status;
      if (payout.status === 'SUCCESS') {
        claimTxHash = payout.intentHash;
        confirmedAt = now;
        settled = true;
      } else if (payout.status === 'FAILED' || payout.status === 'REFUNDED') {
        console.warn(
          `[launchpadFees] private instant credit ${payout.status.toLowerCase()}, holding in escrow`
        );
      } else {
        // Funds may have moved. Reserve the row as CLAIMED so a retry cannot
        // double-pay; reconciliation resolves the terminal status.
        claimTxHash = payout.intentHash;
        settled = true;
      }
    } catch (err: any) {
      console.warn(
        '[launchpadFees] private instant credit threw, holding in escrow:',
        err?.message || err
      );
    }
  } else {
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
        netAtomicStr
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
  }

  await env.DB.prepare(
    `INSERT INTO payments (
       id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
       asset, amount, fee, fee_recipient, memo, status, intent_hash, claim_tx_hash,
       created_at, expires_at, updated_at, origin, privacy_rail, settlement_status,
       claim_deposit_address, confirmed_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      origin,
      handle,
      identity.x_id,
      token.asset,
      amount,
      fee,
      feeRecipient,
      memo,
      settled ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED,
      intentHash,
      claimTxHash ?? null,
      now,
      LAUNCHPAD_FEE_EXPIRES_AT,
      now,
      origin,
      privacyRail,
      settlementStatus,
      claimDepositAddress,
      confirmedAt
    )
    .run();

  return {
    ok: true,
    id,
    asset: token.asset,
    amount,
    fee,
    routing: settled ? 'direct' : 'escrow',
    status: settled ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED,
    claimTxHash,
  };
}

export interface AdapterFeeLeg {
  ok: boolean;
  handle?: string;
  token?: string;
  amount?: string;
  fee?: string;
  id?: string;
  routing?: 'direct' | 'escrow';
  status?: PaymentStatus;
  error?: string;
}

/**
 * Credits every adapter payout in a finalized transaction.
 * The launchpad keeps its own fee receiver. Its payout code sends `ft_transfer`
 * to escrow with memo `Fees to @handle via UPRAIL`. The handle is read from
 * that memo, never from the API caller, `fee_to`, or `dev_id`.
 */
export async function recordAdapterFees(
  env: Env,
  txHash: string
): Promise<{ ok: boolean; legs: AdapterFeeLeg[]; error?: string }> {
  const hash = (txHash || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(hash)) {
    return { ok: false, legs: [], error: 'A transaction hash is required.' };
  }
  const probe = await nearRpc.probeNearTransaction(env, hash);
  if (!probe.found) return { ok: false, legs: [], error: probe.error || 'transaction not found' };
  if (!probe.success) return { ok: false, legs: [], error: 'transaction did not succeed' };

  const escrow = escrowHoldingAccount(env).toLowerCase();
  const legs: AdapterFeeLeg[] = [];
  for (const transfer of probe.transfers) {
    if (transfer.kind !== 'ft') continue;
    if ((transfer.to || '').toLowerCase() !== escrow) continue;
    const handle = deriveHandleFromMemo(transfer.memo);
    const contractId = (transfer.contract || '').toLowerCase();
    if (!handle || !contractId) continue;
    let amountAtomic: bigint;
    try {
      amountAtomic = BigInt(transfer.amountAtomic || '0');
    } catch {
      continue;
    }
    if (amountAtomic <= 0n) continue;

    const token = await resolveLaunchpadToken(env, contractId, true);
    if (!token) {
      legs.push({ ok: false, handle, token: contractId, error: 'Unknown or non-NEP-141 token contract.' });
      continue;
    }
    const credited = await creditVerifiedFeeAtomic(env, {
      launchpad: 'adapter',
      handle,
      token,
      grossAtomic: amountAtomic,
      intentHash: `adapter:${hash}:${contractId}:${handle}:${amountAtomic.toString()}`,
      memo: uprailFeeMemo(handle),
    });
    legs.push({
      ok: credited.ok,
      handle,
      token: contractId,
      amount: credited.amount,
      fee: credited.fee,
      id: credited.id,
      routing: credited.routing,
      status: credited.status,
      error: credited.error,
    });
  }
  if (legs.length === 0) {
    return {
      ok: false,
      legs: [],
      error: 'No ft_transfer to escrow with memo "Fees to @handle via UPRAIL" was found in that transaction.',
    };
  }
  return { ok: legs.some((leg) => leg.ok), legs };
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

  const binding = await getLaunchpadTokenBinding(env, token.contractId);
  const handle = binding?.handle || deriveHandleFromDescription(token.description);
  if (!handle) {
    return {
      ok: false,
      error: 'No creator handle found. Add "Fees to @handle via UPRAIL" to the token description.',
    };
  }
  const launchpad = params.launchpad || binding?.launchpad || inferLaunchpadFromContract(token.contractId);

  await trackLaunchpadToken(env, {
    contractId: token.contractId,
    handle,
    launchpad,
  });

  // Idempotency: the same inbound tx must never be credited twice.
  try {
    const existing = await env.DB.prepare(
      'SELECT id, amount, status, fee, claim_tx_hash FROM payments WHERE intent_hash = ? LIMIT 1'
    )
      .bind(params.txHash)
      .first<{ id: string; amount: string; status: string; fee: string | null; claim_tx_hash: string | null }>();
    if (existing) {
      return {
        ok: true,
        id: existing.id,
        asset: token.asset,
        amount: existing.amount,
        fee: existing.fee || undefined,
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

  const grossAtomic = BigInt(inbound.amountAtomic);

  // Guard against double-crediting if automatic RPC balance-delta sync already
  // routed this transfer before the route/sync call arrived.
  if (!isSharedPoolContract(token.contractId)) {
    try {
      const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
      const liveAtomic = await nearRpc.getPlainFtBalanceStrict(
        rpcUrl,
        token.contractId,
        escrowHoldingAccount(env)
      );
      if (liveAtomic !== null) {
        const accounted = await getAccountedEscrowAtomic(env, token.contractId, token.asset, token.decimals);
        if (liveAtomic - accounted < grossAtomic) {
          const autoRow = await env.DB.prepare(
            `SELECT id, amount, status, fee, claim_tx_hash FROM payments
             WHERE (LOWER(asset) = ? OR LOWER(asset) = ?)
               AND intent_hash LIKE 'auto:%'
             ORDER BY created_at DESC LIMIT 1`
          )
            .bind(token.asset.toLowerCase(), token.contractId.toLowerCase())
            .first<{ id: string; amount: string; status: string; fee: string | null; claim_tx_hash: string | null }>();
          if (autoRow) {
            await env.DB.prepare('UPDATE payments SET intent_hash = ? WHERE id = ?')
              .bind(params.txHash, autoRow.id)
              .run()
              .catch(() => {});
            return {
              ok: true,
              id: autoRow.id,
              asset: token.asset,
              amount: autoRow.amount,
              fee: autoRow.fee || undefined,
              routing: autoRow.status === PaymentStatus.CLAIMED ? 'direct' : 'escrow',
              status: autoRow.status as PaymentStatus,
              claimTxHash: autoRow.claim_tx_hash || undefined,
            };
          }
        }
      }
    } catch {}
  }

  return await creditVerifiedFeeAtomic(env, {
    launchpad,
    handle,
    token,
    grossAtomic,
    intentHash: params.txHash,
    memo: params.memo,
  });
}

/**
 * Automatically checks a launchpad token's live balance on `escrow.uprail.near`
 * via `NEAR_RPC_URL` (`ft_balance_of`) and routes any uncredited surplus to the
 * token's creator `@handle` — no `txHash` required!
 */
export async function syncTokenLaunchpadFees(
  env: Env,
  rawToken: unknown,
  opts?: { launchpad?: string; memo?: string }
): Promise<RecordFeeResult & { synced: boolean; handle?: string }> {
  if (!creatorFeesEnabled(env)) {
    return {
      ok: false,
      synced: false,
      error:
        'Creator-fee balance-delta routing is disabled. Send a verified transaction hash instead.',
    };
  }
  const contractId = contractFromToken(rawToken);
  if (!contractId) {
    return { ok: false, synced: false, error: 'A valid NEP-141 token contract is required.' };
  }
  if (isSharedPoolContract(contractId)) {
    return {
      ok: false,
      synced: false,
      error: 'Shared pool tokens require a transaction hash to attribute to a recipient.',
    };
  }

  const token = await resolveLaunchpadToken(env, contractId, true);
  if (!token) {
    return { ok: false, synced: false, error: 'Unknown or non-NEP-141 token contract.' };
  }

  const binding = await getLaunchpadTokenBinding(env, contractId);
  const tracked = await getTrackedLaunchpadToken(env, contractId);
  const handle = binding?.handle || deriveHandleFromDescription(token.description);

  if (!handle) {
    return {
      ok: false,
      synced: false,
      error: 'No creator handle found. Add "Fees to @handle via UPRAIL" to the token description.',
    };
  }

  const launchpad =
    opts?.launchpad || binding?.launchpad || tracked?.launchpad || inferLaunchpadFromContract(contractId);
  await trackLaunchpadToken(env, { contractId, handle, launchpad });

  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const escrow = escrowHoldingAccount(env);
  const liveAtomic = await nearRpc.getPlainFtBalanceStrict(rpcUrl, token.contractId, escrow);
  if (liveAtomic === null) {
    return { ok: false, synced: false, handle, error: 'Could not read escrow token balance from NEAR RPC.' };
  }

  const accountedAtomic = await getAccountedEscrowAtomic(env, token.contractId, token.asset, token.decimals);
  const unroutedGrossAtomic = liveAtomic > accountedAtomic ? liveAtomic - accountedAtomic : 0n;

  if (unroutedGrossAtomic <= 0n) {
    return {
      ok: true,
      synced: false,
      handle,
      asset: token.asset,
      amount: '0',
    };
  }

  const res = await creditVerifiedFeeAtomic(env, {
    launchpad,
    handle,
    token,
    grossAtomic: unroutedGrossAtomic,
    intentHash: `auto:${token.contractId}:${liveAtomic.toString()}:${Date.now()}`,
    memo: opts?.memo,
  });

  return {
    ...res,
    synced: res.ok,
    handle,
  };
}

/**
 * Discovers all launchpad tokens held by `escrow.uprail.near` or registered via
 * `/api/fees/prepare` and automatically routes any uncredited fee surpluses
 * using `NEAR_RPC_URL`.
 */
export async function syncAllLaunchpadFees(
  env: Env,
  opts?: { handle?: string; maxTokens?: number }
): Promise<{ checked: number; routed: number; results: Array<RecordFeeResult & { token: string; handle?: string }> }> {
  if (!creatorFeesEnabled(env)) {
    return { checked: 0, routed: 0, results: [] };
  }
  const filterHandle = normalizeHandle(opts?.handle);
  const maxTokens = opts?.maxTokens ?? (filterHandle ? 8 : 15);
  const candidates = new Map<string, string | null>(); // contractId -> known handle

  // 1. Pull tracked tokens from D1 launchpad_events
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT token, handle FROM launchpad_events
         WHERE token IS NOT NULL
         ORDER BY created_at DESC LIMIT 50`
      ).all<{ token: string; handle: string | null }>();
      for (const r of results || []) {
        const c = contractFromToken(r.token);
        if (!c || isSharedPoolContract(c)) continue;
        const h = normalizeHandle(r.handle);
        if (!candidates.has(c) || (!candidates.get(c) && h)) {
          candidates.set(c, h);
        }
      }
    } catch {}
  }

  // 2. Pull integrated tokens that use launchpad-native bindings.
  for (const binding of await listLaunchpadTokenBindings(env, 50)) {
    const c = contractFromToken(binding.token);
    if (!c || isSharedPoolContract(c)) continue;
    const current = candidates.get(c);
    if (!candidates.has(c) || !current) candidates.set(c, binding.handle);
  }

  // 3. Pull tracked tokens from KV list
  if (env.CACHE) {
    try {
      const list = (await env.CACHE.get(TRACKED_TOKENS_LIST_KEY, 'json')) as string[] | null;
      if (Array.isArray(list)) {
        for (const item of list) {
          const c = contractFromToken(item);
          if (c && !isSharedPoolContract(c) && !candidates.has(c)) {
            candidates.set(c, null);
          }
        }
      }
    } catch {}
  }

  // 4. Discover any NEP-141 token held by escrow.uprail.near (zero-API tokens!)
  try {
    const escrow = escrowHoldingAccount(env);
    const held = await nearRpc.fetchAccountFtBalancesStrict(escrow);
    for (const h of held || []) {
      const c = contractFromToken(h.contractId);
      if (c && !isSharedPoolContract(c) && !candidates.has(c)) {
        candidates.set(c, null);
      }
    }
  } catch {}

  // Prioritize tokens that match `filterHandle` (or have an unknown handle that might match via description)
  const ordered = Array.from(candidates.entries())
    .filter(([, knownHandle]) => !filterHandle || !knownHandle || knownHandle === filterHandle)
    .slice(0, maxTokens);

  const results: Array<RecordFeeResult & { token: string; handle?: string }> = [];
  let routed = 0;

  for (const [contractId] of ordered) {
    try {
      const res = await syncTokenLaunchpadFees(env, contractId);
      if (res.synced) {
        routed++;
        results.push({ ...res, token: contractId });
      }
    } catch (err) {
      console.warn(`[launchpadFees] syncTokenLaunchpadFees(${contractId}) failed:`, err);
    }
  }

  return { checked: ordered.length, routed, results };
}

