import type { Env } from '../types';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { plainAmount, resolveShareTicker } from './share';

export interface CreatorFeeCardSummary {
  handle: string;
  asset: string;
  count: number;
  headline: string;
  subline: string;
  detail: string;
  version: string;
}

interface CreatorFeeRow {
  asset: string;
  amount: string;
  created_at: number;
}

interface FeeGroup {
  asset: string;
  amount: number;
  count: number;
  latest: number;
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
        `SELECT asset, amount, created_at
         FROM payments
         WHERE LOWER(recipient_handle) = ?
           AND LOWER(asset) = ?
           AND status = 'ESCROWED'
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

  const groups = new Map<string, FeeGroup>();
  let latest = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const asset = (row.asset || '').toLowerCase();
    const group = groups.get(asset) || {
      asset,
      amount: 0,
      count: 0,
      latest: 0,
    };
    group.amount += amount;
    group.count += 1;
    group.latest = Math.max(group.latest, Number(row.created_at) || 0);
    groups.set(asset, group);
    latest = Math.max(latest, group.latest);
  }

  const entries = [...groups.values()].sort((a, b) => b.latest - a.latest);
  if (entries.length === 0) return emptyCreatorFeeCardSummary(handle, assetFilter);

  const count = entries.reduce((sum, entry) => sum + entry.count, 0);
  const labels = await Promise.all(
    entries.slice(0, 3).map(async (entry) => {
      const ticker = await resolveShareTicker(env, entry.asset);
      return plainAmount(String(entry.amount), ticker) || `${entry.count} fees`;
    })
  );
  const primary = labels[0] || `${count} creator fees`;
  const others = labels.slice(1);
  if (entries.length > 3) others.push(`+${entries.length - 3} more`);

  return {
    handle,
    asset: assetFilter,
    count,
    headline: primary,
    subline: `@${handle} · ${count} creator fee${count === 1 ? '' : 's'} waiting`,
    detail: others.length
      ? `${others.join(' · ')} also waiting. Claim with Face ID or fingerprint.`
      : 'Claim with Face ID or fingerprint. Updates as fees arrive.',
    version: `${count}-${latest}-${Math.round(entries[0].amount * 1e6)}`,
  };
}
