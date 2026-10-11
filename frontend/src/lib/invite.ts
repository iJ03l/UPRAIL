/**
 * Pending invite (ref code) hand-off.
 *
 * A share link arrives as `/claim/<payment>?invite=CODE`, but the recipient is
 * almost never logged in yet, so they get bounced /login -> passkey -> /parking
 * and every one of those hops drops the query string. The code has to survive
 * those hops or the recipient ends up typing it by hand, which is exactly what
 * the share link is supposed to prevent.
 */

const PENDING_KEY = 'uprail_pending_invite';

/** Accepts only what the parking page accepts: exactly 6 capital letters. */
export function sanitizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  return cleaned.length === 6 ? cleaned : null;
}

/** Stores a code seen anywhere (URL, backend payload) for later hops. */
export function rememberInvite(raw: string | null | undefined): string | null {
  const code = sanitizeInviteCode(raw);
  if (!code) return null;
  try {
    if (typeof window !== 'undefined') localStorage.setItem(PENDING_KEY, code);
  } catch {
    /* private mode / quota - caller still uses the returned value */
  }
  return code;
}

/** Reads a stored code without consuming it. */
export function peekInvite(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return sanitizeInviteCode(localStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

/** Reads + clears - used once the code has actually been redeemed. */
export function takeInvite(): string | null {
  const code = peekInvite();
  try {
    if (typeof window !== 'undefined') localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  return code;
}

/** Pulls an invite out of a location search string, storing it on the way. */
export function inviteFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('invite') || params.get('ref') || params.get('code');
  return rememberInvite(fromUrl);
}

/**
 * Best-known invite code right now: current URL first (the freshest signal),
 * then whatever was remembered on an earlier hop.
 */
export function currentInvite(): string | null {
  if (typeof window === 'undefined') return null;
  return inviteFromSearch(window.location.search) || peekInvite();
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** True for a same-origin absolute path (`/app/claim/abc`), false for URLs. */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('\u0000')) return null;
  if (CONTROL_CHARS.test(value)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}

/** Appends the pending invite to a path so redirects never lose it. */
export function withInvite(path: string): string {
  const code = currentInvite();
  if (!code) return path;
  try {
    const url = new URL(path, 'https://app.uprail.world');
    if (!url.searchParams.get('invite')) url.searchParams.set('invite', code);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}
