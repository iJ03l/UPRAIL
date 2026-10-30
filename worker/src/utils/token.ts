/**
 * Token symbol cleaning and normalization utilities.
 */

export const NATIVE_NEAR_ALIASES = new Set([
  'near',
  'wnear',
  'wrap.near',
  'native:near',
  'nep141:near',
  'nep141:wrap.near',
]);

/**
 * Strips launchpad pool discriminators, contract suffixes, and raw prefixes
 * from token symbols, names, and contract labels to return the clean, human-readable
 * token name (e.g. "RAEN-E1328C" -> "RAEN", "raen-e1328c.launchpad.justhoot.near" -> "RAEN",
 * "abg-966.meme-cooking.near" -> "ABG", "uptober-2.nearlytrade.near" -> "UPTOBER").
 */
export function cleanMemeSymbol(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  const lower = s.toLowerCase();
  if (NATIVE_NEAR_ALIASES.has(lower)) {
    return 'NEAR';
  }
  if (
    lower.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1') ||
    lower === 'usdc' ||
    lower === 'nep141:usdc' ||
    lower === 'native:usdc'
  ) {
    return 'USDC';
  }
  if (lower === 'usdt' || lower === 'nep141:usdt' || lower === 'native:usdt') {
    return 'USDT';
  }

  // Strip nep141: or native: prefix
  if (lower.startsWith('nep141:')) s = s.slice(7).trim();
  else if (lower.startsWith('native:')) s = s.slice(7).trim();

  // If contract id like 'raen-e1328c.launchpad.justhoot.near' or 'token.0xshitzu.near'
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts[0].toLowerCase() === 'token' && parts.length > 2) {
      s = parts[1];
    } else {
      s = parts[0];
    }
  }

  // Strip 0x prefix if followed by letters (e.g. 0xshitzu -> shitzu)
  s = s.replace(/^0x([a-z]+)/i, '$1');

  // Strip launchpad pool discriminator suffix:
  // e.g. -e1328c (hex hash >=4 chars) or -966 (digits)
  s = s.replace(/-([0-9a-f]{4,12}|[0-9]+)$/i, '');

  // 64-char hex addresses fail symbol validation
  if (/^[0-9a-f]{64}$/i.test(s)) return '';

  return s.toUpperCase();
}
