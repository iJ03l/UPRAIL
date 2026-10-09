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

  // 1. Try memory cache first
  const mem = memoryChallenges.get(opts.key);
  if (mem) {
    memoryChallenges.delete(opts.key);
    if (mem.expiresAt > now && mem.purpose === opts.purpose) {
      if (!opts.expectedChallenge || mem.challenge === opts.expectedChallenge) {
        // Asynchronously delete from D1 as well
        if (env.DB) {
          env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?')
            .bind(opts.key)
            .run()
            .catch(() => {});
        }
        return mem.challenge;
      }
    }
  }

  // 2. Fallback to D1 database
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT challenge, expires_at FROM auth_challenges WHERE id = ? AND purpose = ?'
      )
        .bind(opts.key, opts.purpose)
        .first<{ challenge: string; expires_at: number }>();

      if (row) {
        // Delete immediately (single-use)
        await env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?')
          .bind(opts.key)
          .run()
          .catch(() => {});

        if (row.expires_at > now) {
          if (!opts.expectedChallenge || row.challenge === opts.expectedChallenge) {
            return row.challenge;
          }
        }
      }
    } catch (err) {
      console.warn('[challengeService] D1 consumeChallenge notice:', err);
    }
  }

  return null;
}
