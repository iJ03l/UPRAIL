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

/**
 * A FULL page load whose URL carries no invite param means the preloaded
 * code was cleared (the user wiped the query string / opened the base URL)
 * — drop the remembered copy so every page starts fresh instead of
 * resurrecting a dead code in the login banner, parking field, and
 * withInvite() redirects. Client-side hops never re-run this module, and
 * every legit hop (OAuth callback, withInvite redirects) re-attaches the
 * param to the URL, so mid-flow bounces keep their code. An auth-error
 * bounce is not a user clear, so it keeps the code too.
 */
function dropInviteOnBarePageLoad(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('invite') || params.get('ref') || params.get('code');
    if (!fromUrl && !params.get('error')) localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode — nothing stored anyway */
  }
}
dropInviteOnBarePageLoad();

/** Clears any stored invite code immediately. */
export function clearInvite(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
    }
  } catch {}
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
  clearInvite();
  return code;
}

/** Pulls an invite out of a location search string, storing it on the way. */
export function inviteFromSearch(search: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(search);
  const fromUrl = params.get('invite') || params.get('ref') || params.get('code');
  if (fromUrl) {
    return rememberInvite(fromUrl);
  }
  // If the search string has no invite parameter and is not an error bounce,
  // the user has cleared the URL — drop any previously stored code.
  if (!params.get('error')) {
    clearInvite();
  }
  return null;
}

/**
 * Best-known invite code right now:
 * If the current URL has an invite param, remember and return it.
 * If the current URL has NO invite param, wipe local storage and return null.
 * Stored invite never survives clearing the URL.
 */
export function currentInvite(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('invite') || params.get('ref') || params.get('code');
  if (fromUrl) {
    return rememberInvite(fromUrl);
  }
  if (!params.get('error')) {
    clearInvite();
    return null;
  }
  return peekInvite();
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
