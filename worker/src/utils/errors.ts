/**
 * Turns an internal error into a message that is safe to return to a client.
 *
 * Handlers otherwise echo `err.message` straight into the response, which is
 * how upstream bodies, absolute URLs (provider endpoints often embed API
 * tokens in the path/query) and stack fragments end up in front of users.
 *
 * Policy: keep our own short, human-readable messages; redact anything that
 * looks like a URL, cap the length, and fall back to a generic message when
 * nothing usable remains. Details always go to the logs instead.
 */

const GENERIC_FALLBACK = 'Internal Server Error';

export function publicErrorMessage(err: unknown, fallback: string = GENERIC_FALLBACK): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;

  const cleaned = raw
    // Absolute URLs — may carry provider tokens in query/path.
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted-url]')
    // Long opaque blobs (base64 payloads, JWTs, private keys).
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    // Longest message we are willing to hand to a client.
    .slice(0, 240);

  return cleaned || fallback;
}
