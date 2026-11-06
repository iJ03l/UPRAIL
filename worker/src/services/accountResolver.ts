import type { Env } from '../types';
export function normalizeHandle(rawHandle: string): string {
  return (rawHandle || '').trim().replace(/^@+/, '').toLowerCase();
}

export function isValidXHandle(handle: string): boolean {
  return /^[a-zA-Z0-9_]{1,15}$/.test(handle);
}

export interface ResolvedAccount {
  handle: string;
  cleanHandle: string;
  exists: boolean;
  isRegistered: boolean;
  name?: string;
  avatarUrl?: string;
  nearAccount?: string | null;
}

export type ResolveAccountResult =
  | { ok: true; account: ResolvedAccount }
  | { ok: false; error: string; code: string; status: number; handle: string };

const RESOLVE_CACHE_PREFIX = 'resolve:account:';
const CACHE_TTL_SECONDS = 10 * 60; // 10 minutes
const NEGATIVE_CACHE_TTL_SECONDS = 2 * 60; // 2 minutes

/**
 * Validates an X handle, checks if it is a real account, and resolves its
 * display picture (DP) and profile information.
 */
export async function resolveAccount(env: Env, rawHandle: string): Promise<ResolveAccountResult> {
  const clean = normalizeHandle(rawHandle || '');
  if (!clean || !isValidXHandle(clean)) {
    return {
      ok: false,
      error: 'Invalid 𝕏 handle. Handles must be 1 to 15 alphanumeric characters or underscores.',
      code: 'INVALID_HANDLE_FORMAT',
      status: 400,
      handle: rawHandle,
    };
  }

  const cacheKey = `${RESOLVE_CACHE_PREFIX}${clean.toLowerCase()}`;

  // 1. Check KV Cache
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.notFound) {
          return {
            ok: false,
            error: `Account @${clean} does not exist on 𝕏`,
            code: 'ACCOUNT_NOT_FOUND',
            status: 404,
            handle: `@${clean}`,
          };
        }
        return { ok: true, account: parsed };
      }
    } catch {}
  }

  // 2. Check D1 Database (registered UPRAIL users)
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT x_id, x_handle, x_name, near_account, is_activated
           FROM x_identities
          WHERE LOWER(x_handle) = LOWER(?)
          LIMIT 1`
      )
        .bind(clean)
        .first<{
          x_id: string;
          x_handle: string;
          x_name: string | null;
          near_account: string | null;
          is_activated: number | null;
        }>();

      if (row) {
        let avatarUrl: string | undefined;
        try {
          const avRow = await env.DB.prepare(
            `SELECT avatar_url FROM x_identities WHERE LOWER(x_handle) = LOWER(?) LIMIT 1`
          )
            .bind(clean)
            .first<{ avatar_url: string | null }>();
          if (avRow?.avatar_url) avatarUrl = avRow.avatar_url;
        } catch {}

        const account: ResolvedAccount = {
          handle: `@${row.x_handle || clean}`,
          cleanHandle: clean,
          exists: true,
          isRegistered: Boolean(row.near_account || row.is_activated),
          name: row.x_name || clean,
          avatarUrl: avatarUrl || `https://unavatar.io/x/${clean}`,
          nearAccount: row.near_account || null,
        };

        if (env.CACHE) {
          await env.CACHE.put(cacheKey, JSON.stringify(account), {
            expirationTtl: CACHE_TTL_SECONDS,
          }).catch(() => {});
        }

        return { ok: true, account };
      }
    } catch (err) {
      console.warn('[accountResolver] D1 check error:', err);
    }
  }

  // 3. Verify existence on 𝕏 via unavatar probe with fallback=false
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const probeUrl = `https://unavatar.io/x/${clean}?fallback=false`;
    const resp = await fetch(probeUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'UPRAIL/1.0 (+https://uprail.world)' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (resp.status === 404) {
      if (env.CACHE) {
        await env.CACHE.put(cacheKey, JSON.stringify({ notFound: true }), {
          expirationTtl: NEGATIVE_CACHE_TTL_SECONDS,
        }).catch(() => {});
      }

      return {
        ok: false,
        error: `Account @${clean} does not exist on 𝕏`,
        code: 'ACCOUNT_NOT_FOUND',
        status: 404,
        handle: `@${clean}`,
      };
    }

    // 200 or 3xx redirect implies valid profile exists
    const account: ResolvedAccount = {
      handle: `@${clean}`,
      cleanHandle: clean,
      exists: true,
      isRegistered: false,
      name: clean,
      avatarUrl: `https://unavatar.io/x/${clean}`,
    };

    return { ok: true, account };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[accountResolver] 𝕏 probe failed with error:', msg);
    return {
      ok: false,
      error: `Could not verify 𝕏 account @${clean}: ${msg}`,
      code: 'ACCOUNT_VERIFICATION_FAILED',
      status: 502,
      handle: `@${clean}`,
    };
  }
}
