import type { Env } from '../types';

const CHALLENGE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Drops expired WebAuthn/OAuth challenges. They are single-use and rejected
 * once expired, so keeping a day of rows only preserves recent auth debugging
 * context while stopping the table from growing forever.
 */
export async function pruneExpiredAuthChallenges(
  env: Env,
  now = Date.now()
): Promise<number> {
  const cutoff = now - CHALLENGE_GRACE_MS;
  const result = await env.DB.prepare(
    'DELETE FROM auth_challenges WHERE expires_at < ?'
  )
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
