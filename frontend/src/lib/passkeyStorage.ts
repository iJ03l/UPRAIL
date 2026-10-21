import type { XUser } from '../types';

export interface StoredPasskeyInfo {
  credentialId: string;
  handle: string;
  createdAt: string;
  algorithm: string;
  deviceLabel: string;
}

export const PASSKEY_STORAGE_KEY = 'uprail_registered_passkeys';

function normalizeHandle(handle?: string | null): string {
  return (handle || '').replace(/^@/, '').toLowerCase();
}

export function readStoredPasskeys(): StoredPasskeyInfo[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const list = JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeStoredPasskeys(list: StoredPasskeyInfo[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export function hasLocalPasskey(handle?: string): boolean {
  const list = readStoredPasskeys();
  if (!handle) return list.length > 0;
  const clean = normalizeHandle(handle);
  return list.some((p) => normalizeHandle(p.handle) === clean);
}

export function getRegisteredPasskeys(): StoredPasskeyInfo[] {
  return readStoredPasskeys();
}

/**
 * The device remembers exactly one account's credentials. Saving a passkey
 * for a handle drops records belonging to any previous account.
 */
export function saveStoredPasskey(info: StoredPasskeyInfo): void {
  const clean = normalizeHandle(info.handle);
  // One account per device. The newest credential replaces every older marker,
  // including stale records for this same handle.
  writeStoredPasskeys([{ ...info, handle: clean }]);
}

/** Keep only the remembered account's passkeys; null/undefined clears all. */
export function pruneStoredPasskeys(keepHandle?: string | null): void {
  const clean = normalizeHandle(keepHandle);
  if (!clean) {
    try {
      localStorage.removeItem(PASSKEY_STORAGE_KEY);
    } catch {}
    return;
  }
  writeStoredPasskeys(
    readStoredPasskeys().filter((p) => normalizeHandle(p.handle) === clean)
  );
}

export function removeStoredPasskeys(handle: string): void {
  const clean = normalizeHandle(handle);
  writeStoredPasskeys(
    readStoredPasskeys().filter((p) => normalizeHandle(p.handle) !== clean)
  );
}

export function clearStoredPasskeys(): void {
  try {
    localStorage.removeItem(PASSKEY_STORAGE_KEY);
  } catch {}
}

/**
 * Writes the single remembered X identity. If the user changed, purge every
 * account-scoped cache first so the next account cannot see the old one's
 * balances, history, pending payments, receipts, or passkey records.
 */
export function rememberLastAuth(user: XUser): void {
  if (typeof window === 'undefined') return;
  const next = normalizeHandle(user.handle);
  const previous = normalizeHandle(localStorage.getItem('uprail_last_handle'));

  if (previous !== next) {
    clearAccountCaches();
    if (previous) removeStoredPasskeys(previous);
  }

  try {
    localStorage.setItem('uprail_has_signed_up', 'true');
    localStorage.setItem('uprail_last_handle', next);
    if (user.name) localStorage.setItem('uprail_last_name', user.name);
    if (user.avatarUrl) localStorage.setItem('uprail_last_avatar', user.avatarUrl);
  } catch {}
}

const ACCOUNT_CACHE_KEYS = [
  'uprail_x_user',
  'uprail_user',
  'uprail_user_cache_v1',
  'uprail_payments',
  'uprail_shielded_balances',
  'uprail_payment_history_cache',
  'uprail_pending_payments_cache',
  'uprail_onchain_cache',
  'uprail_seen_receipts',
];

export function clearAccountCaches(): void {
  if (typeof window === 'undefined') return;
  for (const key of ACCOUNT_CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}
