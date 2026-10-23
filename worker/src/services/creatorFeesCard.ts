import type { Env } from '../types';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { plainAmount, resolveShareTicker } from './share';

export interface CreatorFeeCardSummary {
  handle: string;
  asset: string;
  count: number;
  pendingCount: number;
  headline: string;
  subline: string;
  detail: string;
  version: string;
}

interface CreatorFeeRow {
  asset: string;
  amount: string;
  status: string;
  created_at: number;
}

const HANDLE_RE = /^[a-z0-9_]{1,15}$/;
const ASSET_RE = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

export function normalizeCreatorFeeHandle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const handle = value.trim().replace(/^@+/, '').toLowerCase();
  return HANDLE_RE.test(handle) ? handle : '';
}

export function normalizeCreatorFeeAsset(value: unknown): string {
  if (typeof value !== 'string') return '';
  const asset = value.trim().toLowerCase();
  return ASSET_RE.test(asset) ? asset : '';
}

function creatorFeeCardPayload(handle: string, asset: string): string {
  return `creator-fees:${handle}:${asset}`;
}

export async function creatorFeeCardKey(
  env: Env,
  handle: string,
  rawAsset: string
): Promise<string> {
  const secret = env.SESSION_SECRET;
  const asset = normalizeCreatorFeeAsset(rawAsset);
  if (!secret || !HANDLE_RE.test(handle) || !asset) return '';
  try {
    return await signPayload(creatorFeeCardPayload(handle, asset), secret);
  } catch {
    return '';
  }
}

export async function creatorFeeCardKeyValid(
  env: Env,
  handle: string,
  rawAsset: string,
  key: string | null | undefined
): Promise<boolean> {
  const secret = env.SESSION_SECRET;
  const asset = normalizeCreatorFeeAsset(rawAsset);
  if (!secret || !key || !HANDLE_RE.test(handle) || !asset) return false;
  try {
    return (await verifyAndUnpack(key, secret)) === creatorFeeCardPayload(handle, asset);
  } catch {
    return false;
  }
}

export function emptyCreatorFeeCardSummary(
  handle: string,
  rawAsset = ''
): CreatorFeeCardSummary {
  const asset = normalizeCreatorFeeAsset(rawAsset);
  return {
    handle,
    asset,
    count: 0,
    pendingCount: 0,
    headline: `@${handle}`,
    subline: 'Creator fees on UPRAIL',
    detail: 'No fees yet. This card updates as they arrive.',
    version: '0',
  };
}

export async function getCreatorFeeCardSummary(
  env: Env,
  rawHandle: string,
  rawAsset: string
): Promise<CreatorFeeCardSummary> {
  const handle = normalizeCreatorFeeHandle(rawHandle);
  const assetFilter = normalizeCreatorFeeAsset(rawAsset);
  if (!handle || !assetFilter) return emptyCreatorFeeCardSummary(handle, assetFilter);

  let rows: CreatorFeeRow[] = [];
  if (env.DB) {
    try {
      const result = await env.DB.prepare(
        `SELECT asset, amount, status, created_at
         FROM payments
         WHERE LOWER(recipient_handle) = ?
           AND LOWER(asset) = ?
           AND status IN ('ESCROWED', 'CLAIMED')
           AND origin LIKE 'launchpad:%'
         ORDER BY created_at DESC
         LIMIT 100`
      )
        .bind(handle, assetFilter)
        .all<CreatorFeeRow>();
      rows = result.results || [];
    } catch {
      rows = [];
    }
  }

  let total = 0;
  let pending = 0;
  let count = 0;
  let pendingCount = 0;
  let latest = 0;
  for (const row of rows) {
    if (row.status !== 'ESCROWED' && row.status !== 'CLAIMED') continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    count += 1;
    if (row.status === 'ESCROWED') {
      pending += amount;
      pendingCount += 1;
    }
    latest = Math.max(latest, Number(row.created_at) || 0);
  }

  if (count === 0) return emptyCreatorFeeCardSummary(handle, assetFilter);

  const ticker = await resolveShareTicker(env, assetFilter);
  const totalLabel = plainAmount(String(total), ticker) || `${count} creator fees`;
  const pendingLabel = plainAmount(String(pending), ticker);

  return {
    handle,
    asset: assetFilter,
    count,
    pendingCount,
    headline: totalLabel,
    subline:
      pendingCount > 0
        ? `@${handle} · ${count} creator fee${count === 1 ? '' : 's'} · ${pendingCount} pending`
        : `@${handle} · ${count} creator fee${count === 1 ? '' : 's'} settled`,
    detail:
      pendingCount > 0
        ? `${pendingLabel} ready to claim with Face ID or fingerprint.`
        : 'No pending fees. Settled to your UPRAIL balance.',
    version: `${count}-${pendingCount}-${latest}-${Math.round(total * 1e6)}-${Math.round(pending * 1e6)}`,
  };
}
