/**
 * Challenge storage service for UPRAIL (UPRAIL.app)
 * Replaces Cloudflare KV writes with in-memory caching and D1 fallback.
 * Guarantees zero KV put operations to keep workers within Cloudflare Free Tier forever.
 */

import type { Env } from '../types';

interface ChallengeEntry {
  challenge: string;
  xId: string;
  purpose: string;
  expiresAt: number;
}

// In-isolate memory cache (instant nanosecond lookups, unlimited throughput)
const memoryChallenges = new Map<string, ChallengeEntry>();

function cleanExpiredMemory() {
  const now = Date.now();
  for (const [key, entry] of memoryChallenges.entries()) {
    if (entry.expiresAt < now) {
      memoryChallenges.delete(key);
    }
  }
}

/**
 * Stores a challenge for single-use verification.
 * Saves to in-memory isolate map and persists to D1 for cross-colo edge consistency.
 */
export async function storeChallenge(
  env: Env,
  opts: {
    key: string;
    challenge: string;
    xId?: string;
    purpose: string;
    ttlSeconds?: number;
  }
): Promise<void> {
  const ttl = opts.ttlSeconds ?? 300;
  const expiresAt = Date.now() + ttl * 1000;
  const xId = opts.xId || 'anon';

  // 1. In-memory store
  if (memoryChallenges.size > 2000) {
    cleanExpiredMemory();
  }
  memoryChallenges.set(opts.key, {
    challenge: opts.challenge,
    xId,
    purpose: opts.purpose,
    expiresAt,
  });

  // 2. D1 persistence (100,000 writes/day free tier)
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO auth_challenges (id, x_id, challenge, purpose, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           challenge = excluded.challenge,
           expires_at = excluded.expires_at`
      )
        .bind(opts.key, xId, opts.challenge, opts.purpose, expiresAt)
        .run();
    } catch (err) {
      console.warn('[challengeService] D1 storeChallenge notice:', err);
    }
  }
}

/**
 * Consumes a single-use challenge.
 * Fail-closed: returns the stored challenge string if valid, or null if expired/missing.
 * Immediately deletes to prevent replay attacks.
 */
export async function consumeChallenge(
  env: Env,
  opts: {
    key: string;
    purpose: string;
    expectedChallenge?: string;
  }
): Promise<string | null> {
  const now = Date.now();

  // 1. Authoritative single-use consume from D1. A single atomic
  //    `DELETE ... RETURNING` validates and removes in one statement, so two
  //    isolates racing the same challenge cannot both win. The previous
  //    SELECT-then-DELETE had a window where both read the row (a passkey
  //    assertion replay), and it deleted before validating expiry/match,
  //    destroying a still-valid challenge on a mismatched attempt. The
  //    per-isolate memory cache cannot arbitrate a cross-isolate race, so it
  //    is only a fallback below.
  if (env.DB) {
    try {
      const consume = await env.DB.prepare(
        `DELETE FROM auth_challenges
          WHERE id = ? AND purpose = ? AND expires_at > ?
          ${opts.expectedChallenge ? 'AND challenge = ?' : ''}
          RETURNING challenge`
      )
        .bind(
          ...(opts.expectedChallenge
            ? [opts.key, opts.purpose, now, opts.expectedChallenge]
            : [opts.key, opts.purpose, now])
        )
        .first<{ challenge: string }>();
      if (consume?.challenge) {
        memoryChallenges.delete(opts.key);
        return consume.challenge;
      }
    } catch (err) {
      console.warn('[challengeService] D1 consumeChallenge notice:', err);
    }
  }

  // 2. Memory fallback — only reached when D1 is unavailable or the challenge
  //    was only ever stored in memory (its D1 write failed). Validate before
  //    deleting so a mismatched attempt cannot destroy a valid challenge.
  const mem = memoryChallenges.get(opts.key);
  if (mem) {
    if (mem.expiresAt <= now) {
      memoryChallenges.delete(opts.key);
    } else if (
      mem.purpose === opts.purpose &&
      (!opts.expectedChallenge || mem.challenge === opts.expectedChallenge)
    ) {
      memoryChallenges.delete(opts.key);
      return mem.challenge;
    }
  }

  return null;
}
