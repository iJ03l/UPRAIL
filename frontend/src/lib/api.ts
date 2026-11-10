import {
  Token,
  PaymentIntent,
  PaymentQuote,
  CreatePaymentRequest,
  XUser,
  ClaimPaymentResult,
  ShieldedBalance,
  MyInviteResponse,
  RedeemInviteResponse,
  WithdrawalReceipt,
  AgentKey,
  CreatedAgentKey,
  NearcomDestination,
  NearcomWithdrawResponse,
  Contact,
  PaymentRequest,
} from '../types';
import { fetchOnchainTokens } from './onchainApi';
import { pruneStoredPasskeys } from './passkeyStorage';
import type { WithdrawChain } from './withdrawChains';

/**
 * Canonical claim link base. In production the origin is app.uprail.world
 * (enforced by the worker's host routing); localhost/apex origins are only
 * used during local development, with app.uprail.world as the SSR fallback.
 */
function claimBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/claim`;
  }
  return 'https://app.uprail.world/claim';
}

/**
 * Bump when the share-card metadata or artwork changes. Social platforms cache
 * previews per exact URL, so a new version makes re-shares get re-crawled
 * instead of showing the old card.
 */
export const SHARE_CARD_VERSION = '2';

function claimUrlFor(paymentId: string, inviteCode?: string | null): string {
  const params = new URLSearchParams({ v: SHARE_CARD_VERSION });
  if (inviteCode) params.set('invite', inviteCode);
  return `${claimBaseUrl()}/${paymentId}?${params.toString()}`;
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_ACCOUNT_RE =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)*$/;
const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;

/**
 * Normalizes a recipient entered in either send mode:
 * - X handle: strips leading '@' and lowercases (handles are case-insensitive)
 * - Raw wallet address ("Send to Wallet"): EVM / Solana base58 / NEAR named or
 *   implicit account. EVM and NEAR named accounts are case-insensitive and
 *   canonicalized to lowercase; Solana base58 and 64-hex implicit accounts are
 *   case-sensitive and MUST be preserved byte-for-byte.
 * Mirrors classifyRecipient() in worker/src/routes/payments.ts.
 */
export function normalizeRecipientInput(raw: string): { recipient: string; isAddress: boolean } {
  const t = (raw || '').trim();
  if (!t) return { recipient: '', isAddress: false };
  if (EVM_ADDRESS_RE.test(t)) return { recipient: t.toLowerCase(), isAddress: true };
  if (IMPLICIT_ACCOUNT_RE.test(t)) return { recipient: t, isAddress: true };
  if (SOLANA_ADDRESS_RE.test(t)) return { recipient: t, isAddress: true };
  if (t.includes('.') && NEAR_ACCOUNT_RE.test(t)) return { recipient: t.toLowerCase(), isAddress: true };
  return { recipient: t.replace(/^@+/, '').toLowerCase(), isAddress: false };
}

/**
 * Resolves a backend `asset` value onto a known Token. Backend rows may store
 * a short token id ('usdc'), a symbol, a NEAR contract id, or a defuse asset
 * id (`nep141:usdc.near`, `near:wrap.near`) — all of which must resolve to
 * the same display token.
 */
/**
 * Every representation of native NEAR that can reach a stored payment or asset id.
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

/**
 * Builds a token for an asset the curated registry does not carry.
 *
 * The registry head is 484 tokens; a launchpad meme is not in it. Returning
 * `tokens[0]` for such an asset labelled a UPTOBER payment as NEAR in history,
 * shares and any other place that renders a payment's token. Derive the
 * identity from the NEP-141 contract id instead — "nep141:uptober.nearlytrade.near"
 * is UPTOBER on uptober.nearlytrade.near, and saying so is always better than
 * substituting a different asset.
 */
function tokenFromAssetId(asset: string): Token {
  const lower = (asset || '').trim().toLowerCase();
  const contract = lower.startsWith('nep141:') ? lower.slice('nep141:'.length) : '';
  const bare = contract || lower;
  const symbol = cleanMemeSymbol(bare || 'UNKNOWN');
  return {
    id: lower || 'unknown',
    symbol,
    name: symbol,
    iconUrl: getOnchainIcon(cleanMemeSymbol(bare)) || getOnchainIcon(bare.split('.')[0] || '') || getOnchainIcon(symbol.toLowerCase()) || '',
    decimals: bare === 'wrap.near' ? 24 : 18,
    priceUsd: undefined,
    nearContractId: contract,
    chain: 'near',
    badge: contract ? 'NEAR' : '—',
    category: 'all',
    balance: '0.00',
  };
}

function resolveTokenForAsset(asset: string | null | undefined, tokens: Token[]): Token {
  const fallback = tokens[0] || SUPPORTED_TOKENS[0];
  const a = (asset || '').trim();
  if (!a) return fallback;
  const lower = a.toLowerCase();

  const byExact = tokens.find(
    (t) => t.id.toLowerCase() === lower || t.symbol.toLowerCase() === lower
  );
  if (byExact) return byExact;

  const byContract = tokens.find(
    (t) => t.nearContractId && t.nearContractId.toLowerCase() === lower
  );
  if (byContract) return byContract;

  // Defuse ids carry a chain prefix (`nep141:...`, `near:...`) — match on the
  // unprefixed part against contract ids and token ids.
  const suffix = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower;
  const bySuffix = tokens.find((t) => {
    const contract = (t.nearContractId || '').toLowerCase();
    const id = t.id.toLowerCase();
    return contract === suffix || id === suffix || contract.endsWith(`.${suffix}`) || suffix.endsWith(`.${id}`);
  });
  // Registry miss: never substitute another asset — synthesize one from the id.
  return bySuffix || tokenFromAssetId(lower);
}

/**
 * Maps the backend PaymentStatus enum (PENDING / DEPOSIT_WAITING / ESCROWED /
 * CLAIMED / EXPIRED / REFUNDED / CANCELLED) onto the frontend status union.
 */
function mapBackendStatus(status: string | null | undefined): PaymentIntent['status'] {
  switch ((status || '').toUpperCase()) {
    case 'CLAIMED':
      return 'claimed';
    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';
    case 'REFUNDED':
      return 'refunded';
    case 'ESCROWED':
      return 'ready';
    case 'PENDING':
    case 'DEPOSIT_WAITING':
    default:
      return 'pending';
  }
}

/**
 * Formats a recipient for display: X handles get an '@' prefix; wallet
 * addresses (EVM / Solana / NEAR) are shown shortened, never '@'-prefixed.
 */
export function formatRecipientDisplay(handle: string | null | undefined): string {
  const t = (handle || '').trim();
  if (!t) return 'unknown';
  const looksLikeAddress =
    EVM_ADDRESS_RE.test(t) || IMPLICIT_ACCOUNT_RE.test(t) || t.includes('.') || t.length > 15;
  if (looksLikeAddress) {
    return t.length > 20 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t;
  }
  return `@${t}`;
}

/**
 * Maps a backend payment row (D1/Postgres) onto the frontend PaymentIntent,
 * using the real backend fee, memo, status, and defuse-aware token resolution.
 */
function mapPaymentRow(p: any, tokens: Token[]): PaymentIntent {
  const token = resolveTokenForAsset(p.asset, tokens);
  const numAmount = parseFloat(p.amount) || 0;
  const fee = p.fee != null && p.fee !== '' ? String(p.fee) : '0';
  const numFee = parseFloat(fee) || 0;
  const grossAmount = numFee > 0 ? Number((numAmount + numFee).toFixed(8)).toString() : p.amount;
  const numGross = numFee > 0 ? numAmount + numFee : numAmount;
  const price = tokenUsdPrice(token);
  // Launchpad creator fees are reported with origin 'launchpad:<name>' and a
  // namespaced sender handle ('launchpad:nearly'). Present them as a fee from
  // the launchpad rather than a peer send.
  const origin = typeof p.origin === 'string' ? p.origin : undefined;
  const isCreatorFee = !!origin && origin.startsWith('launchpad:');
  const creatorLaunchpad = isCreatorFee ? origin!.slice('launchpad:'.length) : undefined;
  return {
    id: p.id,
    claimCode: p.id,
    senderHandle: isCreatorFee ? '' : p.sender_x_handle || '',
    senderName: isCreatorFee
      ? creatorLaunchpad
        ? `${creatorLaunchpad} creator fees`
        : 'Creator fees'
      : p.sender_x_handle
      ? `@${p.sender_x_handle}`
      : undefined,
    recipientHandle: p.recipient_handle || '',
    token,
    amount: p.amount,
    grossAmount,
    amountUsd: price === null ? null : numAmount * price,
    grossAmountUsd: price === null ? null : numGross * price,
    fee,
    feeUsd: price === null ? null : numFee * price,
    feeRecipient: p.fee_recipient || 'escrow.uprail.near',
    origin,
    isCreatorFee,
    creatorLaunchpad,
    inviteCode: p.invite_code || undefined,
    memo: p.memo || '',
    status: mapBackendStatus(p.status),
    cancelReason: p.cancel_reason || null,
    cancelCode: p.cancel_code || null,
    depositAddress: p.deposit_address || 'escrow.uprail.near',
    claimTxHash: p.claim_tx_hash || undefined,
    claimLink: claimUrlFor(p.id, p.invite_code),
    createdAt: new Date(p.created_at).toISOString(),
    expiresAt: new Date(p.expires_at).toISOString(),
  };
}

/**
 * Protocol fee rate charged on sends (mirrors the worker's FEE_PERCENT var).
 * Used only when the backend quote is unreachable — the backend's own number
 * always wins when it is available.
 */
export const PROTOCOL_FEE_RATE = 0.01;

/**
 * Live USD price for a token, or null when the registry gave us none.
 *
 * There is deliberately no peg pin, no oracle table and no last-known-good
 * number here: a missing price stays missing so callers can render "—"
 * instead of a confidently wrong figure.
 */
export function tokenUsdPrice(token: { symbol?: string; priceUsd?: number } | null | undefined): number | null {
  const p = token?.priceUsd;
  return typeof p === 'number' && isFinite(p) && p > 0 ? p : null;
}

/** True when a live price exists — use it to decide between $ and —. */
export function hasUsdPrice(token: { priceUsd?: number } | null | undefined): boolean {
  return tokenUsdPrice(token) !== null;
}

/**
 * Resolve the asset a quote is for.
 *
 * A quote priced and labelled for the wrong token is worse than no quote at
 * all: `createPayment` sends exactly `q.token.id`, so a silent fallback to
 * `tokens[0]` (which the priority sort puts NEAR) would quote, label and then
 * move a different asset than the one the user picked. Held launchpad tokens
 * such as UPTOBER are absent from the curated head — the Rhea merge caps the
 * list and scores shortest tickers first — so they only ever resolve through
 * the caller's already-resolved token.
 *
 * The caller's token is therefore authoritative when supplied; an id that
 * resolves to nothing is a hard error rather than a plausible-looking guess.
 */
async function resolveQuoteToken(tokenId: string, knownToken?: Token): Promise<Token> {
  const needle = (tokenId || '').trim().toLowerCase();
  const matches = (t: Token): boolean =>
    t.id.toLowerCase() === needle || (t.symbol || '').toLowerCase() === needle;

  if (knownToken && matches(knownToken)) return knownToken;

  try {
    const tokens = await api.getTokens();
    const found = tokens.find(matches);
    if (found) return found;
  } catch (err) {
    console.warn('[api] token list unavailable while resolving quote asset:', err);
  }

  // Nothing resolved — including the caller's token, which would mean the
  // id and the object disagree. Falling back to tokens[0] here is what used
  // to quote and send held launchpad assets as wNEAR, so refuse instead.
  throw new Error(
    `Unknown asset "${tokenId}" — refusing to quote a different token than the one selected`
  );
}

/**
 * Sums USD figures that may individually be unknown. One unpriced holding
 * makes the total unknown too — a partial total reads as a real one.
 */
export function sumUsd(values: (number | null | undefined)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    total += v;
  }
  return total;
}

/**
 * Formats a USD figure. `null`/`undefined`/NaN render as an em dash: those
 * mean "we have no live price for this", which is different from $0.00.
 */
export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
  if (value === 0) return '$0.00';
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a token amount for display. Normal amounts get exactly two decimal
 * places ("12.3437283" -> "12.34"); sub-cent amounts keep up to eight so a
 * real balance never collapses to "0". Never use this for on-chain math.
 */
export function formatTokenAmount(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '0';
  const str = typeof raw === 'string' ? raw.trim() : String(raw);
  if (!str) return '0';
  const num = Number(str);
  if (!isFinite(num)) return str;
  if (num === 0) return '0.00';
  const abs = Math.abs(num);
  if (abs >= 0.01) {
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const formatted = stripTrailingZeros(num.toFixed(8));
  return formatted === '0' ? '<0.00000001' : formatted;
}

/** Picks the compact magnitude suffix for a number's absolute value. */
function compactMagnitude(abs: number): { scaled: number; suffix: string } {
  if (abs >= 1e12) return { scaled: abs / 1e12, suffix: 'T' };
  if (abs >= 1e9) return { scaled: abs / 1e9, suffix: 'B' };
  if (abs >= 1e6) return { scaled: abs / 1e6, suffix: 'M' };
  if (abs >= 1e3) return { scaled: abs / 1e3, suffix: 'K' };
  return { scaled: abs, suffix: '' };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function compactFixed(scaled: number): string {
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return stripTrailingZeros(scaled.toFixed(digits));
}

/**
 * Abbreviates large amounts for compact display: "12.5K", "3.4M". Values
 * below 1,000 keep the caller's full-precision string so small balances are
 * never lossily rounded. Frontend-only presentation helper.
 */
export function formatCompactAmount(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '0';
  const str = typeof raw === 'string' ? raw.trim() : String(raw);
  const num = parseFloat(str);
  if (!isFinite(num)) return str || '0';
  const abs = Math.abs(num);
  if (abs < 1000) return formatTokenAmount(str);
  const { scaled, suffix } = compactMagnitude(abs);
  return `${num < 0 ? '-' : ''}${compactFixed(scaled)}${suffix}`;
}

/**
 * Compact USD: abbreviates to "$12.5K"/"$3.4M" at 1,000+ and otherwise defers
 * to `formatUsd` (so cents and the em-dash for missing prices are preserved).
 */
export function formatUsdCompact(value: number | null | undefined): string {
  if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
  if (Math.abs(value) < 1000) return formatUsd(value);
  const { scaled, suffix } = compactMagnitude(Math.abs(value));
  return `${value < 0 ? '-$' : '$'}${compactFixed(scaled)}${suffix}`;
}

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  (typeof process !== 'undefined' && process.env?.API_URL) ||
  '';

import { getOnchainIcon } from './onchainIcons';
import { currentInvite, sanitizeReturnPath, takeInvite } from './invite';

/**
 * Offline fallback token list, used ONLY when both `/api/tokens` and the
 * onchain registry are unreachable. It deliberately carries NO prices: when
 * we cannot reach a live feed the UI shows "—" instead of a made-up number.
 */
export const SUPPORTED_TOKENS: Token[] = [
  {
    id: 'nep141:wrap.near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    iconUrl: getOnchainIcon('near') || '',
    decimals: 24,
    nearContractId: 'wrap.near',
    chain: 'near',
    badge: 'NEAR',
    balance: '0.00',
  },
  {
    id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    symbol: 'USDC',
    name: 'USD Coin',
    iconUrl: getOnchainIcon('usdc') || '',
    decimals: 6,
    nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    chain: 'near',
    badge: 'NEAR',
    balance: '0.00',
  },
  {
    id: 'nep141:usdt.tether-token.near',
    symbol: 'USDT',
    name: 'Tether USD',
    iconUrl: getOnchainIcon('usdt') || '',
    decimals: 6,
    nearContractId: 'usdt.tether-token.near',
    chain: 'near',
    badge: 'NEAR',
    balance: '0.00',
  },
  {
    id: 'nep141:eth.bridge.near',
    symbol: 'ETH',
    name: 'Ethereum',
    iconUrl: getOnchainIcon('eth') || '',
    decimals: 18,
    nearContractId: 'eth.bridge.near',
    chain: 'near',
    badge: 'NEAR',
    balance: '0.00',
  },
  {
    id: 'nep141:2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near',
    symbol: 'BTC',
    name: 'Bitcoin',
    iconUrl: getOnchainIcon('wbtc') || '',
    decimals: 8,
    nearContractId: '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near',
    chain: 'near',
    badge: 'NEAR',
    balance: '0.00',
  },
  {
    id: 'nep141:blackdragon.tkn.near',
    symbol: 'BLACKDRAGON',
    name: 'Black Dragon',
    iconUrl: getOnchainIcon('blackdragon') || '',
    decimals: 24,
    nearContractId: 'blackdragon.tkn.near',
    chain: 'near',
    badge: 'NEAR Meme',
    category: 'memes',
    balance: '0.00',
  },
  {
    id: 'nep141:token.0xshitzu.near',
    symbol: 'SHITZU',
    name: 'Shitzu',
    iconUrl: getOnchainIcon('shitzu') || '',
    decimals: 18,
    nearContractId: 'token.0xshitzu.near',
    chain: 'near',
    badge: 'NEAR Meme',
    category: 'memes',
    balance: '0.00',
  },
  {
    id: 'nep141:token.lonkingnearbackto2024.near',
    symbol: 'LONK',
    name: 'LONK',
    iconUrl: getOnchainIcon('lonk') || '',
    decimals: 8,
    nearContractId: 'token.lonkingnearbackto2024.near',
    chain: 'near',
    badge: 'NEAR Meme',
    category: 'memes',
    balance: '0.00',
  },
];

const STORAGE_KEYS = {
  USER: 'uprail_x_user',
  PAYMENTS: 'uprail_payments',
  SHIELDED: 'uprail_shielded_balances',
  PASSKEYS: 'uprail_passkeys',
};

// Every localStorage key the app writes.
export const ALL_APP_STORAGE_KEYS = [
  STORAGE_KEYS.USER,
  STORAGE_KEYS.PAYMENTS,
  STORAGE_KEYS.SHIELDED,
  'uprail_user_cache_v1', // useXAuth global user cache
  'uprail_user', // legacy user cache key (still read back as a fallback)
  'uprail_pending_payments_cache', // useClaimFlow pending list cache
  'uprail_onchain_cache', // useOnchainData tokens/balances/history snapshot
  'uprail_payment_history_cache', // usePayments history snapshot
  'uprail_seen_receipts', // AppHome dismissed-receipt fingerprints
];

/** Keys related to device hardware passkeys, kept across logout for 1-click returning login */
export const DEVICE_PASSKEY_STORAGE_KEYS = [
  STORAGE_KEYS.PASSKEYS,
  'uprail_registered_passkeys',
  'uprail_has_signed_up',
  'uprail_last_handle',
  'uprail_last_name',
  'uprail_last_avatar',
];

/** Removes session & cache localStorage entries on logout, optionally clearing passkey device records */
export function clearAppStorage(clearPasskeys: boolean = false): void {
  for (const key of ALL_APP_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  if (clearPasskeys) {
    for (const key of DEVICE_PASSKEY_STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  } else {
    // Signing out keeps only the last account's passkey records so a returning
    // user still gets 1-click login without leaking the previous account.
    let keepHandle: string | null = null;
    try {
      keepHandle = localStorage.getItem('uprail_last_handle');
    } catch {}
    pruneStoredPasskeys(keepHandle);
  }
}

/**
 * Normalizes one backend token row into a frontend Token. Shared by
 * getTokens and searchTokens so the curated list and the Rhea long tail
 * shape identically. A missing price stays missing ("—", never a guess).
 */
function mapApiToken(t: any): Token {
  const rawSym = (t.symbol || '').trim();
  const tokenChain = (t.chain || t.blockchain || 'near').toLowerCase();
  const isNativeNear =
    (rawSym.toLowerCase() === 'wnear' || rawSym.toLowerCase() === 'near') &&
    (tokenChain === 'near' || t.nearContractId === 'wrap.near' || t.id === 'nep141:wrap.near');
  const symbol = isNativeNear ? 'NEAR' : rawSym || 'UNKNOWN';
  const name = isNativeNear ? 'NEAR Protocol' : (t.name || symbol);
  const iconUrl =
    (isNativeNear ? getOnchainIcon('near') : undefined) ||
    t.iconUrl ||
    t.icon ||
    getOnchainIcon(t.nearContractId) ||
    getOnchainIcon(symbol.toLowerCase()) ||
    getOnchainIcon(rawSym.toLowerCase()) ||
    '';
  return {
    id: t.id || t.defuse_asset_id || (isNativeNear ? 'nep141:wrap.near' : rawSym.toLowerCase()),
    symbol,
    name,
    iconUrl,
    decimals: t.decimals ?? (isNativeNear ? 24 : 18),
    priceUsd: t.priceUsd,
    nearContractId: t.nearContractId || (isNativeNear ? 'wrap.near' : ''),
    chain: tokenChain,
    badge: t.badge || tokenChain.toUpperCase(),
    category: t.category || (isNativeNear ? 'popular' : 'all'),
    balance: t.balance || '0.00',
  };
}

/**
 * Auth-state write barrier.
 *
 * Bumping this invalidates every in-flight getAuthStatus() result. Without it,
 * a checkSession() that started BEFORE logout can resolve AFTER api.logout()
 * has cleared storage and re-write the old user into localStorage — which
 * re-hydrates the session mid-redirect and bounces the user back to the
 * dashboard instead of a clean sign-out. logout() bumps the epoch first; any
 * getAuthStatus() still in flight then finds it stale and drops its result.
 */
let authEpoch = 0;
export function invalidateInFlightAuth(): void {
  authEpoch += 1;
}

export const api = {
  // Auth endpoints
  async getAuthStatus(): Promise<{ user: XUser | null; stale?: boolean }> {
    const epoch = authEpoch;
    const stale = () => authEpoch !== epoch;
    try {
      const url = API_BASE ? `${API_BASE}/auth/status` : '/auth/status';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // A logout happened while this request was in flight. Report the
        // result as stale so the caller can distinguish it from a real 401
        // and avoid wiping shared auth state that logout already reset.
        if (stale()) return { user: null, stale: true };
        if (data?.authenticated && data?.user) {
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
          localStorage.setItem('uprail_user_cache_v1', JSON.stringify(data.user));
          return { user: data.user };
        } else {
          localStorage.removeItem(STORAGE_KEYS.USER);
          localStorage.removeItem('uprail_user_cache_v1');
          return { user: null };
        }
      } else if (res.status === 401) {
        if (!stale()) {
          localStorage.removeItem(STORAGE_KEYS.USER);
          localStorage.removeItem('uprail_user_cache_v1');
        }
        return { user: null, stale: stale() };
      } else {
        // 5xx / 429: the server answered but not with a verdict we can act on.
        // Do NOT clear the cache here — a transient outage must not sign a
        // still-valid session out. Fall through to the cached read below.
        console.warn(`Backend /auth/status returned ${res.status}, using cached session`);
        const cached = localStorage.getItem(STORAGE_KEYS.USER) || localStorage.getItem('uprail_user_cache_v1');
        if (cached) {
          try {
            return { user: JSON.parse(cached) };
          } catch {}
        }
      }
    } catch (e) {
      // Only a genuine network failure reaches here (fetch threw). The cache is
      // a graceful offline read for a still-signed-in tab — it is NOT a logout
      // path. Sign-out clears both keys before this runs, so a logged-out tab
      // has nothing to resurrect even when the API is unreachable.
      console.warn('Backend /auth/status unreachable, checking cached session', e);
      const cached = localStorage.getItem(STORAGE_KEYS.USER) || localStorage.getItem('uprail_user_cache_v1');
      if (cached) {
        try {
          return { user: JSON.parse(cached) };
        } catch {}
      }
    }
    return { user: null };
  },

  async loginWithX(inviteCode?: string): Promise<never> {
    const invite = inviteCode || currentInvite() || undefined;
    const params = new URLSearchParams();
    if (invite) params.set('invite', invite.trim().toUpperCase());

    // Send the user back to where they were heading (the claim deep link, for
    // a recipient opening a share link) instead of dumping them on /login.
    let returnTo = '/login';
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      returnTo =
        sanitizeReturnPath(search.get('return_to')) ||
        sanitizeReturnPath(`${window.location.pathname}${window.location.search}`) ||
        '/login';
    }
    params.set('return_to', returnTo);
    const query = `?${params.toString()}`;
    const origin =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? window.location.origin
        : 'https://app.uprail.world';

    // 1. Fetch real X OAuth authorize URL directly from backend endpoint
    try {
      const initUrl = API_BASE ? `${API_BASE}/auth/x/init${query}` : `${origin}/auth/x/init${query}`;
      const res = await fetch(initUrl, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          window.location.assign(data.url);
          return new Promise<never>(() => {});
        }
      }
    } catch (e) {
      console.warn('Direct OAuth URL fetch failed, falling back to server redirect:', e);
    }

    // 2. Direct server redirect fallback
    const fallbackUrl = API_BASE ? `${API_BASE}/auth/x/login${query}` : `${origin}/auth/x/login${query}`;
    window.location.assign(fallbackUrl);
    return new Promise<never>(() => {});
  },

  async logout(): Promise<void> {
    // Invalidate every in-flight getAuthStatus() BEFORE clearing storage.
    // Any checkSession() still awaiting a response would otherwise resolve
    // after this function returns and re-write the old user into localStorage,
    // re-hydrating the session and bouncing the user back to the dashboard.
    invalidateInFlightAuth();
    try {
      const url = API_BASE ? `${API_BASE}/auth/logout` : '/auth/logout';
      await fetch(url, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Backend logout failed', e);
    }
    clearAppStorage();
  },

  /**
   * Full device reset: destroys the server session cookie AND clears every
   * local key, including the device passkey records a normal logout keeps.
   *
   * Used when a user is stuck mid-onboarding (e.g. the platform passkey
   * manager will not respond) and needs to start over. A stale
   * `uprail_registered_passkeys` marker otherwise makes the client LOOK FOR a
   * passkey that this device never actually created, instead of creating one.
   */
  async disconnect(): Promise<void> {
    // Same write barrier as logout(): drop any in-flight getAuthStatus() so it
    // cannot resurrect the session after storage is cleared.
    invalidateInFlightAuth();
    try {
      const url = API_BASE ? `${API_BASE}/auth/logout` : '/auth/logout';
      await fetch(url, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Backend disconnect/logout failed', e);
    }
    clearAppStorage(true);
  },

  // Passkey Login Endpoints
  async getPasskeyLoginOptions(handle?: string) {
    const query = handle ? `?handle=${encodeURIComponent(handle)}` : '';
    const url = API_BASE ? `${API_BASE}/auth/passkey/login-options${query}` : `/auth/passkey/login-options${query}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get passkey login options');
    }
    return await res.json();
  },

  async verifyPasskeyLogin(assertion: unknown): Promise<{ success: boolean; user: XUser }> {
    const url = API_BASE ? `${API_BASE}/auth/passkey/login-verify` : '/auth/passkey/login-verify';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Passkey verification failed');
    }
    const data = await res.json();
    if (data?.user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
    }
    return data;
  },

  /**
   * Completes the passkey second factor for the current X session. Unlike
   * verifyPasskeyLogin this cannot switch accounts: the worker binds the
   * assertion to the session's x_id.
   */
  async confirmPasskey(assertion: unknown): Promise<{
    success: boolean;
    passkeyVerified: boolean;
    hasRecoveryCodes?: boolean;
    recoveryCodesRemaining?: number;
  }> {
    const url = API_BASE ? `${API_BASE}/auth/passkey/confirm` : '/auth/passkey/confirm';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Passkey confirmation failed');
    }
    return await res.json();
  },

  async getRecoveryStatus(): Promise<{ hasCodes: boolean; remaining: number; viewable: number }> {
    const url = API_BASE ? `${API_BASE}/auth/recovery/status` : '/auth/recovery/status';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Could not load recovery codes');
    }
    return await res.json();
  },

  async getRecoveryCodes(assertion: unknown): Promise<{
    success: boolean;
    codes: string[];
    remaining: number;
    legacy: number;
  }> {
    const url = API_BASE ? `${API_BASE}/auth/recovery/codes` : '/auth/recovery/codes';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Could not load recovery codes');
    }
    return await res.json();
  },

  async verifyRecoveryCode(code: string): Promise<{ success: boolean; remaining: number }> {
    const url = API_BASE ? `${API_BASE}/auth/recovery/verify` : '/auth/recovery/verify';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'That recovery code is invalid or has already been used.');
    }
    return await res.json();
  },

  async regenerateRecoveryCodes(assertion: unknown): Promise<{
    success: boolean;
    recoveryCodes: string[];
    remaining: number;
  }> {
    const url = API_BASE ? `${API_BASE}/auth/recovery/regenerate` : '/auth/recovery/regenerate';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Could not generate recovery codes');
    }
    return await res.json();
  },

  // Token list
  async getTokens(): Promise<Token[]> {
    try {
      const url = API_BASE ? `${API_BASE}/api/tokens` : '/api/tokens';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.tokens && Array.isArray(data.tokens) ? data.tokens : []);
        if (list.length > 0) {
          const priorityOrder: Record<string, number> = {
            NEAR: 1,
            USDC: 2,
            USDT: 3,
            ETH: 4,
            WBTC: 5,
            BTC: 6,
            SOL: 7,
            DAI: 8,
          };
          const mapped: Token[] = list.map(mapApiToken);

          mapped.sort((a, b) => {
            const pA = priorityOrder[a.symbol.toUpperCase()] ?? 999;
            const pB = priorityOrder[b.symbol.toUpperCase()] ?? 999;
            if (pA !== pB) return pA - pB;
            const isNatA = a.chain === 'near' || a.chain === a.symbol.toLowerCase();
            const isNatB = b.chain === 'near' || b.chain === b.symbol.toLowerCase();
            if (isNatA && !isNatB) return -1;
            if (!isNatA && isNatB) return 1;
            return a.symbol.localeCompare(b.symbol);
          });

          return mapped;
        }
      }
    } catch (e) {
      console.warn('Backend /api/tokens unavailable, trying onchainApi', e);
    }
    try {
      const onchainTokens = await fetchOnchainTokens();
      if (onchainTokens.length > 0) return onchainTokens as unknown as Token[];
    } catch {}
    return SUPPORTED_TOKENS;
  },

  /**
   * Searches the full Rhea (Ref) native token long tail — launchpad memes
   * like `*.nearlytrade.near` that do not fit the curated /api/tokens head.
   * Returns [] for short queries and on any failure (picker keeps local
   * results; search is additive, never load-bearing).
   */
  async searchTokens(query: string): Promise<Token[]> {
    const q = (query || '').trim();
    if (q.length < 2) return [];
    try {
      const url = API_BASE
        ? `${API_BASE}/api/tokens/search?q=${encodeURIComponent(q)}`
        : `/api/tokens/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.tokens && Array.isArray(data.tokens) ? data.tokens : []);
      return list.map(mapApiToken);
    } catch {
      return [];
    }
  },

  /**
   * Resolves an X handle: validates format, verifies it is a real account,
   * and fetches profile information & display picture (avatarUrl).
   */
  async resolveHandle(handle: string): Promise<{
    handle: string;
    cleanHandle: string;
    resolved: boolean;
    exists: boolean;
    isRegistered: boolean;
    name?: string;
    avatarUrl?: string;
    nearAccount?: string | null;
    message?: string;
  }> {
    const clean = (handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!clean) {
      throw new Error('Please enter an 𝕏 handle');
    }
    const url = API_BASE
      ? `${API_BASE}/api/resolve?handle=${encodeURIComponent(clean)}`
      : `/api/resolve?handle=${encodeURIComponent(clean)}`;
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Account @${clean} does not exist on 𝕏`);
    }
    return data;
  },

  // Payment quote calculation with cryptographic backend binding
  async getQuote(
    tokenId: string,
    amount: string,
    recipientHandle = 'escrow',
    knownToken?: Token
  ): Promise<PaymentQuote> {
    const numAmount = parseFloat(amount) || 0;
    const token = await resolveQuoteToken(tokenId, knownToken);
    // One live price drives every USD figure in the quote; without it every
    // figure is null and the UI shows "—" rather than three different guesses.
    const price = tokenUsdPrice(token);
    const usd = (v: number) => (price === null ? null : v * price);
    const amountUsd = usd(numAmount);

    try {
      const url = API_BASE ? `${API_BASE}/api/quote` : '/api/quote';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientHandle: recipientHandle || 'escrow',
          asset: token.id,
          amount: amount || '0',
        }),
      });

      if (res.ok) {
        const q = await res.json();
        const networkFee = q.estimatedFees || (token.id.includes('near') ? '0.005' : '0.01');
        const networkFeeUsd = usd(parseFloat(networkFee));
        const protocolFee = q.protocolFee !== undefined ? q.protocolFee : (numAmount * PROTOCOL_FEE_RATE).toFixed(6).replace(/\.?0+$/, '') || '0';
        const protocolFeeUsd = usd(parseFloat(protocolFee));
        const protocolFeeRecipient = q.feeRecipient || 'escrow.uprail.near';
        // The protocol fee is carved out of the amount being sent, so the
        // sender's balance only ever drops by the amount they entered.
        const recipientAmount =
          q.recipientAmount !== undefined
            ? q.recipientAmount
            : Math.max(0, numAmount - parseFloat(protocolFee)).toFixed(6).replace(/\.?0+$/, '') || '0';
        const recipientAmountUsd = usd(parseFloat(recipientAmount));
        const totalAmount = numAmount.toFixed(token.decimals > 6 ? 4 : 2);
        const totalUsd = usd(numAmount);

        return {
          token,
          amount: amount || '0',
          amountUsd,
          recipientAmount,
          recipientAmountUsd,
          networkFee,
          networkFeeUsd,
          protocolFee,
          protocolFeeUsd,
          protocolFeeRecipient,
          totalAmount,
          totalUsd,
          depositAddress: q.depositAddress || 'escrow.uprail.near',
          quoteId: q.quoteId,
          quoteSignature: q.quoteSignature,
          expiresAt: q.expiresAt,
          rail: q.rail === 'native' ? 'native' : 'intents',
          estimatedTimeSeconds: 2,
        };
      }
    } catch (e) {
      console.warn('Backend /api/quote call error:', e);
    }

    const networkFee = token.id.includes('near') ? '0.005' : '0.01';
    const networkFeeUsd = usd(parseFloat(networkFee));
    const protocolFee = (numAmount * PROTOCOL_FEE_RATE).toFixed(6).replace(/\.?0+$/, '') || '0';
    const protocolFeeUsd = usd(parseFloat(protocolFee));
    const protocolFeeRecipient = 'escrow.uprail.near';
    const recipientAmount =
      Math.max(0, numAmount - parseFloat(protocolFee)).toFixed(6).replace(/\.?0+$/, '') || '0';
    const recipientAmountUsd = usd(parseFloat(recipientAmount));
    const totalAmount = numAmount.toFixed(token.decimals > 6 ? 4 : 2);
    const totalUsd = usd(numAmount);

    return {
      token,
      amount: amount || '0',
      amountUsd,
      recipientAmount,
      recipientAmountUsd,
      networkFee,
      networkFeeUsd,
      protocolFee,
      protocolFeeUsd,
      protocolFeeRecipient,
      totalAmount,
      totalUsd,
      depositAddress: 'escrow.uprail.near',
      estimatedTimeSeconds: 2,
    };
  },

  // Create payment intent with authentic quote signature
  async createPayment(params: CreatePaymentRequest): Promise<PaymentIntent> {
    const url = API_BASE ? `${API_BASE}/api/send` : '/api/send';
    const cleanHandle = normalizeRecipientInput(params.recipientHandle).recipient;

    // If quoteSignature is not provided, obtain a real cryptographic quote first
    let quoteSignature = params.quoteSignature;
    let depositAddress = params.depositAddress;

    if (!quoteSignature || !depositAddress) {
      const q = await api.getQuote(params.tokenId, params.amount, cleanHandle, params.token);
      quoteSignature = q.quoteSignature;
      depositAddress = q.depositAddress;
      // Send exactly the asset id the quote was signed for — /api/send
      // verifies the signature with an exact (non-fuzzy) asset comparison.
      // Only adopt the quote's id when it really is the selected asset;
      // blindly overwriting here is how a held launchpad token used to be
      // sent as wNEAR after the quote silently fell back to tokens[0].
      if (q.token.id === params.tokenId || q.token.symbol.toLowerCase() === params.tokenId.toLowerCase()) {
        params = { ...params, tokenId: q.token.id };
      } else {
        throw new Error(
          `Quote was signed for ${q.token.id} but ${params.tokenId} was selected — refusing to send a different asset`
        );
      }
    }

    if (!quoteSignature) {
      throw new Error('Unable to obtain cryptographically signed quote for payment');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        recipientHandle: cleanHandle,
        asset: params.tokenId,
        amount: params.amount,
        memo: params.memo || undefined,
        quoteSignature,
        depositAddress: depositAddress || 'escrow.uprail.near',
        passkeyAssertion: params.passkeyAssertion,
        requestId: params.requestId || undefined,
      }),
    });

    const tokens = await api.getTokens();
    const token = resolveTokenForAsset(params.tokenId, tokens);
    const price = tokenUsdPrice(token);

    if (res.ok) {
      const backendData = await res.json();
      // The recipient-facing amount is what they can actually claim
      // (amount − fee); the fee column carries the carved-out protocol fee.
      const netAmount = backendData.recipientAmount || params.amount;
      const numNet = parseFloat(netAmount) || 0;
      const grossAmount = params.amount || netAmount;
      const numGross = parseFloat(grossAmount) || numNet;
      const feeVal = backendData.fee || '0';
      const numFee = parseFloat(feeVal) || 0;
      return {
        id: backendData.paymentId,
        claimCode: backendData.paymentId,
        senderHandle: '',
        recipientHandle: cleanHandle,
        token,
        amount: netAmount,
        grossAmount,
        amountUsd: price === null ? null : numNet * price,
        grossAmountUsd: price === null ? null : numGross * price,
        fee: feeVal,
        feeUsd: price === null ? null : numFee * price,
        feeRecipient: backendData.feeRecipient || 'escrow.uprail.near',
        inviteCode: backendData.inviteCode,
        memo: params.memo || '',
        status: mapBackendStatus(backendData.status),
        depositAddress: backendData.depositAddress || depositAddress || 'escrow.uprail.near',
        claimLink: backendData.shareLink || (backendData.isDirect ? '' : claimUrlFor(backendData.paymentId, backendData.inviteCode)),
        isDirect: backendData.isDirect,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(backendData.expiresAt || Date.now() + 86400000 * 30).toISOString(),
      };
    }

    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || 'Failed to create payment intent');
  },

  // Get payment by ID / code
  async getPaymentByCode(code: string): Promise<PaymentIntent | null> {
    try {
      const cleanCode = code.trim();
      const url = API_BASE ? `${API_BASE}/api/payments/${encodeURIComponent(cleanCode)}` : `/api/payments/${encodeURIComponent(cleanCode)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const p = data.payment;
        if (!p) return null;
        const tokens = await api.getTokens().catch(() => SUPPORTED_TOKENS);
        return mapPaymentRow(p, tokens);
      }
    } catch (e) {
      console.warn('Backend getPaymentByCode error', e);
    }
    return null;
  },

  // Get user payments (sent & received)
  async getPaymentHistory(): Promise<PaymentIntent[]> {
    try {
      const url = API_BASE ? `${API_BASE}/api/payments` : '/api/payments';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const paymentsList = data.payments || [];
        const tokens = await api.getTokens().catch(() => SUPPORTED_TOKENS);
        return paymentsList.map((p: any) => mapPaymentRow(p, tokens));
      }
    } catch (e) {
      console.warn('Backend getPaymentHistory error', e);
    }
    return [];
  },

  // Passkey Registration Options
  // The server MUST issue the challenge and rpId — a locally generated
  // challenge can never be verified server-side, so failure here is fatal.
  async getPasskeyRegisterOptions(
    handle: string
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const url = API_BASE ? `${API_BASE}/api/claim/register-options` : '/api/claim/register-options';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Failed to get passkey registration options');
    }
    const options = await res.json();
    if (!options?.challenge) {
      throw new Error('Server returned invalid registration options');
    }
    return options;
  },

  // Registers a new passkey attestation on the server (sets API_BASE correctly)
  async registerPasskeyAttestation(attestation: unknown): Promise<any> {
    const url = API_BASE ? `${API_BASE}/api/claim/register` : '/api/claim/register';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ attestation }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Failed to register passkey with server');
    }
    return await res.json();
  },

  /**
   * Issues a single-use `tx_auth` challenge for a fund-moving action
   * (send / claim / withdraw). Required by requirePasskeyAuth().
   */
  async getTxAuthOptions(): Promise<{ challenge: string; rpId?: string; timeout?: number }> {
    const url = API_BASE ? `${API_BASE}/api/auth-challenge` : '/api/auth-challenge';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(err.error || 'Failed to get transaction challenge');
    }
    const options = await res.json();
    if (!options?.challenge) {
      throw new Error('Server returned invalid transaction challenge');
    }
    return options;
  },

  // Get pending payments sent to the authenticated user (no code or link needed!)
  async getPendingPayments(): Promise<PaymentIntent[]> {
    try {
      const url = API_BASE ? `${API_BASE}/api/claim/pending` : '/api/claim/pending';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const paymentsList = data.payments || [];
        const tokens = await api.getTokens().catch(() => SUPPORTED_TOKENS);
        return paymentsList.map((p: any) => mapPaymentRow(p, tokens));
      }
    } catch (e) {
      console.warn('Backend getPendingPayments error', e);
    }
    return [];
  },

  // Claim Payment with Passkey verification
  async claimPayment(claimCode: string, _recipientHandle: string, passkeyAuthPayload: unknown): Promise<ClaimPaymentResult> {
    const url = API_BASE ? `${API_BASE}/api/claim/execute` : '/api/claim/execute';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        paymentIds: [claimCode],
        passkeyAssertion: passkeyAuthPayload,
        passkeySignature: typeof passkeyAuthPayload === 'string' ? passkeyAuthPayload : JSON.stringify(passkeyAuthPayload),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const firstResult = data.results?.[0];
      return {
        success: firstResult?.status === 'CLAIMED',
        shieldedTxHash: firstResult?.txHash || '',
        message: 'Payment successfully settled into your confidential NEAR vault!',
      };
    }

    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to claim payment');
  },

  // Batch Claim Multiple Payments with a Single Passkey verification
  async claimAllPayments(claimCodes: string[], _recipientHandle: string, passkeyAuthPayload: unknown): Promise<ClaimPaymentResult> {
    const url = API_BASE ? `${API_BASE}/api/claim/execute` : '/api/claim/execute';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        paymentIds: claimCodes,
        passkeyAssertion: passkeyAuthPayload,
        passkeySignature: typeof passkeyAuthPayload === 'string' ? passkeyAuthPayload : JSON.stringify(passkeyAuthPayload),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const allSuccess = data.results?.every((r: any) => r.status === 'CLAIMED');
      return {
        success: allSuccess,
        shieldedTxHash: data.results?.[0]?.txHash || '',
        message: `Successfully claimed ${data.results?.filter((r: any) => r.status === 'CLAIMED').length || 0} payments!`,
      };
    }

    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to claim payments');
  },

  // Shielded balances
  async getShieldedBalances(): Promise<ShieldedBalance[]> {
    try {
      const url = API_BASE ? `${API_BASE}/api/claim/balance` : '/api/claim/balance';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.balances && Array.isArray(data.balances)) {
          return data.balances;
        }
      }
    } catch (e) {
      console.warn('Backend getShieldedBalances error', e);
    }
    return [];
  },

  /** Destination networks a spendable asset can settle to (live from 1Click). */
  async getWithdrawChains(asset: string): Promise<WithdrawChain[]> {
    const q = `asset=${encodeURIComponent(asset)}`;
    const url = API_BASE ? `${API_BASE}/api/claim/withdraw-chains?${q}` : `/api/claim/withdraw-chains?${q}`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.chains) ? (data.chains as WithdrawChain[]) : [];
    } catch {
      return [];
    }
  },

  // Withdraw shielded funds from virtual vault to external blockchain address
  async withdraw(params: {
    destinationAddress: string;
    asset?: string;
    amount?: string;
    destinationChain?: string;
    passkeyAssertion: unknown;
  }): Promise<{
    success: boolean;
    txHash: string;
    withdrawalId?: string;
    destinationAddress: string;
    amount: string;
    asset: string;
    /** Public receipt link for this wallet send (`/receipt/<withdrawalId>`). */
    shareLink?: string;
    message: string;
  }> {
    const url = API_BASE ? `${API_BASE}/api/claim/withdraw` : '/api/claim/withdraw';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Withdrawal failed');
    }
    return await res.json();
  },

  /** Public, share-safe receipt for a wallet send / withdrawal. */
  async getWithdrawalReceipt(id: string): Promise<WithdrawalReceipt | null> {
    const url = API_BASE
      ? `${API_BASE}/api/claim/withdrawal/${encodeURIComponent(id)}`
      : `/api/claim/withdrawal/${encodeURIComponent(id)}`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      return (await res.json()) as WithdrawalReceipt;
    } catch (e) {
      console.warn('Backend getWithdrawalReceipt error', e);
      return null;
    }
  },

  // ── near.com Internal Withdrawal Rail (Passkey-Gated) ──────────────────────

  async getNearcomDestination(): Promise<{
    configured: boolean;
    destination: NearcomDestination | null;
  }> {
    const url = API_BASE
      ? `${API_BASE}/api/claim/nearcom-destination`
      : '/api/claim/nearcom-destination';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as any;
      throw new Error(err.error || 'Failed to load near.com withdrawal destination');
    }
    return await res.json();
  },

  async saveNearcomDestination(params: {
    address: string;
    passkeyAssertion: unknown;
  }): Promise<{
    configured: boolean;
    destination: NearcomDestination;
  }> {
    const url = API_BASE
      ? `${API_BASE}/api/claim/nearcom-destination`
      : '/api/claim/nearcom-destination';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as any;
      throw new Error(err.error || 'Failed to save near.com withdrawal destination');
    }
    return await res.json();
  },

  async withdrawToNearcom(params: {
    asset: string;
    amount: string;
    expectedDestination?: string;
    passkeyAssertion: unknown;
  }): Promise<NearcomWithdrawResponse> {
    const url = API_BASE
      ? `${API_BASE}/api/claim/nearcom-withdraw`
      : '/api/claim/nearcom-withdraw';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as any;
      throw new Error(err.error || 'near.com withdrawal failed');
    }
    return await res.json();
  },

  // Invite & Referral Endpoints
  async getMyInvite(): Promise<MyInviteResponse> {
    const url = API_BASE ? `${API_BASE}/api/invites/my-invite` : '/api/invites/my-invite';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch personal invite');
    }
    return await res.json();
  },

  async validateInvite(code: string): Promise<{ valid: boolean; reason?: string }> {
    const url = API_BASE ? `${API_BASE}/api/invites/validate` : '/api/invites/validate';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    return await res.json();
  },

  async redeemInvite(code: string): Promise<RedeemInviteResponse> {
    const url = API_BASE ? `${API_BASE}/api/invites/redeem` : '/api/invites/redeem';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to redeem invite code');
    }
    const data = await res.json();
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.USER);
      if (cached) {
        const u = JSON.parse(cached);
        u.isActivated = true;
        u.personalInviteCode = data.personalInviteCode;
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(u));
      }
    } catch {}
    return data;
  },

  async getInviteStatus(): Promise<{ authenticated: boolean; isActivated: boolean; personalInviteCode: string | null }> {
    const url = API_BASE ? `${API_BASE}/api/invites/status` : '/api/invites/status';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      return { authenticated: false, isActivated: false, personalInviteCode: null };
    }
    return await res.json();
  },

  // Export Vault Private Key (Passkey Authenticated)
  async exportKeyWithPasskey(): Promise<{ nearAccount: string; privateKey: string; publicKey: string }> {
    const challengeUrl = API_BASE ? `${API_BASE}/auth/export-key-challenge` : '/auth/export-key-challenge';
    const challengeRes = await fetch(challengeUrl, { credentials: 'include' });
    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to initialize passkey challenge');
    }
    const { options, challengeToken } = await challengeRes.json();

    const { startAuthentication } = await import('@simplewebauthn/browser');
    delete options.allowCredentials;
    const assertion = await startAuthentication(options);

    const exportUrl = API_BASE ? `${API_BASE}/auth/export-key` : '/auth/export-key';
    const exportRes = await fetch(exportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assertion, challengeToken }),
    });

    if (!exportRes.ok) {
      const err = await exportRes.json().catch(() => ({}));
      throw new Error(err.error || 'Passkey verification failed');
    }

    return await exportRes.json();
  },

  // ── AI Chat payment rail ───────────────────────────────────────────────────

  async getAgentKeys(): Promise<AgentKey[]> {
    const url = API_BASE ? `${API_BASE}/api/agent/keys` : '/api/agent/keys';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load AI chat keys');
    }
    const data = await res.json();
    return (data.keys || []) as AgentKey[];
  },

  /** Creates a scoped AI chat key with USD spend caps. Passkey-gated. */
  async createAgentKey(params: {
    name: string;
    perTxLimit: string;
    dailyLimit: string;
    expiresInDays?: number | null;
    passkeyAssertion: unknown;
  }): Promise<CreatedAgentKey> {
    const url = API_BASE ? `${API_BASE}/api/agent/keys` : '/api/agent/keys';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create AI chat key');
    }
    return await res.json();
  },

  async revokeAgentKey(id: string, passkeyAssertion: unknown): Promise<void> {
    const url = API_BASE
      ? `${API_BASE}/api/agent/keys/${encodeURIComponent(id)}/revoke`
      : `/api/agent/keys/${encodeURIComponent(id)}/revoke`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ passkeyAssertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to revoke key');
    }
  },

  /** Permanently deletes a revoked or expired key. Passkey-gated. */
  async deleteAgentKey(id: string, passkeyAssertion: unknown): Promise<void> {
    const url = API_BASE
      ? `${API_BASE}/api/agent/keys/${encodeURIComponent(id)}/delete`
      : `/api/agent/keys/${encodeURIComponent(id)}/delete`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ passkeyAssertion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete key');
    }
  },

  // ── Launchpad Creator Fees (auto-discovery + on-demand sync) ──────────────

  async syncCreatorFees(params?: {
    token?: string;
  }): Promise<{
    ok: boolean;
    checked?: number;
    routed?: number;
    synced?: boolean;
    amount?: string;
  }> {
    const url = API_BASE ? `${API_BASE}/api/fees/sync` : '/api/fees/sync';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to sync creator fees');
    }
    return await res.json();
  },

  // ── Contacts ("People You Pay") ──────────────────────────────────────────

  async getContacts(): Promise<Contact[]> {
    const url = API_BASE ? `${API_BASE}/api/contacts` : '/api/contacts';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.contacts || [];
  },

  async saveContact(
    handle: string,
    data?: { nickname?: string; preferred_amount?: string; preferred_asset?: string; is_pinned?: boolean }
  ): Promise<{ success: boolean; contact: Contact }> {
    const url = API_BASE ? `${API_BASE}/api/contacts` : '/api/contacts';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ handle, ...data }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save contact');
    }
    return await res.json();
  },

  async deleteContact(handle: string): Promise<void> {
    const clean = handle.replace(/^@+/, '');
    const url = API_BASE
      ? `${API_BASE}/api/contacts/${encodeURIComponent(clean)}`
      : `/api/contacts/${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to remove contact');
    }
  },

  // ── UPRAIL Payment Requests ──────────────────────────────────────────────

  async createPaymentRequest(params: {
    requestedHandle: string;
    asset: string;
    amount: string;
    memo?: string;
    expiresInDays?: number;
    passkeyAssertion?: unknown;
  }): Promise<PaymentRequest> {
    const url = API_BASE ? `${API_BASE}/api/requests` : '/api/requests';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create payment request');
    }
    const data = await res.json();
    return data.request;
  },

  async getPublicRequest(id: string): Promise<PaymentRequest> {
    const url = API_BASE ? `${API_BASE}/api/requests/${encodeURIComponent(id)}` : `/api/requests/${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Payment request not found');
    }
    const data = await res.json();
    return data.request;
  },

  async getIncomingRequests(): Promise<PaymentRequest[]> {
    const url = API_BASE ? `${API_BASE}/api/requests/incoming` : '/api/requests/incoming';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.requests || [];
  },

  async getOutgoingRequests(): Promise<PaymentRequest[]> {
    const url = API_BASE ? `${API_BASE}/api/requests/outgoing` : '/api/requests/outgoing';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.requests || [];
  },

  async declinePaymentRequest(id: string, reason?: string): Promise<void> {
    const url = API_BASE
      ? `${API_BASE}/api/requests/${encodeURIComponent(id)}/decline`
      : `/api/requests/${encodeURIComponent(id)}/decline`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to decline request');
    }
  },

  async cancelPaymentRequest(id: string): Promise<void> {
    const url = API_BASE
      ? `${API_BASE}/api/requests/${encodeURIComponent(id)}/cancel`
      : `/api/requests/${encodeURIComponent(id)}/cancel`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to cancel request');
    }
  },

  async acceptPaymentRequest(id: string, options?: { paymentId?: string; passkeyAssertion?: unknown }): Promise<void> {
    const url = API_BASE
      ? `${API_BASE}/api/requests/${encodeURIComponent(id)}/accept`
      : `/api/requests/${encodeURIComponent(id)}/accept`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(options || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to accept request');
    }
  },

  async getBlockedUsers(): Promise<Array<{ blocked_handle: string; created_at: number }>> {
    const url = API_BASE ? `${API_BASE}/api/requests/blocks` : '/api/requests/blocks';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.blocked || [];
  },

  async blockUser(handle: string): Promise<void> {
    const url = API_BASE ? `${API_BASE}/api/requests/block` : '/api/requests/block';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ handle }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to block user');
    }
  },

  async unblockUser(handle: string): Promise<void> {
    const clean = handle.replace(/^@+/, '');
    const url = API_BASE
      ? `${API_BASE}/api/requests/block/${encodeURIComponent(clean)}`
      : `/api/requests/block/${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to unblock user');
    }
  },

  async getStabilizeQuote(params: {
    sourceAsset: string;
    targetAsset: 'USDC' | 'USDT';
    amount: string;
    signal?: AbortSignal;
  }): Promise<import('../types').StabilizeQuote> {
    const url = API_BASE
      ? `${API_BASE}/api/onchain/stabilize/quote`
      : '/api/onchain/stabilize/quote';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: params.signal,
      body: JSON.stringify({
        sourceAsset: params.sourceAsset,
        targetAsset: params.targetAsset,
        amount: params.amount,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch stabilize quote');
    }
    return data.quote;
  },

  async stabilizeAsset(params: {
    sourceAsset: string;
    targetAsset: 'USDC' | 'USDT';
    amount: string;
    passkeyAssertion: unknown;
  }): Promise<import('../types').StabilizeResult> {
    const url = API_BASE
      ? `${API_BASE}/api/onchain/stabilize`
      : '/api/onchain/stabilize';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        sourceAsset: params.sourceAsset,
        targetAsset: params.targetAsset,
        amount: params.amount,
        passkeyAssertion: params.passkeyAssertion,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to stabilize token');
    }
    return data.result;
  },

  async getStabilizeStatus(depositAddress: string): Promise<{
    status: string;
    terminal: boolean;
    intentHash?: string;
    depositAddress: string;
    swapDetails?: Record<string, unknown>;
  }> {
    const base = API_BASE
      ? `${API_BASE}/api/onchain/stabilize/status`
      : '/api/onchain/stabilize/status';
    const res = await fetch(`${base}?depositAddress=${encodeURIComponent(depositAddress)}`, {
      method: 'GET',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch stabilization status');
    }
    return data;
  },

  async getCoffeeSettings(): Promise<import('../types').CoffeeSettingsResponse> {
    const base = API_BASE ? `${API_BASE}/api/coffee/me` : '/api/coffee/me';
    const res = await fetch(base, { method: 'GET', credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load Buy Me a Coffee settings');
    }
    return data;
  },

  async toggleCoffee(enabled?: boolean): Promise<{ enabled: boolean; handle: string; url: string }> {
    const base = API_BASE ? `${API_BASE}/api/coffee/toggle` : '/api/coffee/toggle';
    const res = await fetch(base, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof enabled === 'boolean' ? { enabled } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update Buy Me a Coffee status');
    }
    return data;
  },

  async getCoffeeProfile(handle: string): Promise<import('../types').CoffeeCreatorProfile> {
    const clean = (handle || '').trim().replace(/^@+/, '');
    const base = API_BASE
      ? `${API_BASE}/api/coffee/profile/${encodeURIComponent(clean)}`
      : `/api/coffee/profile/${encodeURIComponent(clean)}`;
    const res = await fetch(base, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load creator profile');
    }
    return data;
  },

  async getCoffeeOptions(): Promise<import('../types').CoffeeTokenOption[]> {
    const base = API_BASE ? `${API_BASE}/api/coffee/options` : '/api/coffee/options';
    const res = await fetch(base, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load token options');
    }
    return data.tokens || [];
  },

  async createCoffeeDonation(params: {
    handle: string;
    amountUsd: number;
    originSymbol: string;
    originChain: string;
    originAsset?: string;
    targetSymbol?: 'USDC' | 'USDT';
  }): Promise<import('../types').CoffeeDonation> {
    const base = API_BASE ? `${API_BASE}/api/coffee/donate` : '/api/coffee/donate';
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to generate deposit address');
    }
    return data.donation;
  },

  async getCoffeeDonationStatus(donationId: string): Promise<import('../types').CoffeeDonation> {
    const base = API_BASE
      ? `${API_BASE}/api/coffee/status/${encodeURIComponent(donationId)}`
      : `/api/coffee/status/${encodeURIComponent(donationId)}`;
    const res = await fetch(base, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to check donation status');
    }
    return data.donation;
  },
};

/**
 * Normalizes any asset or contract ID into a clean display ticker (e.g. USDC).
 */
export function cleanAssetSymbol(raw: string): string {
  if (!raw) return 'USDC';
  if (raw.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')) return 'USDC';
  if (raw.toLowerCase().includes('nep141:')) {
    const withoutPrefix = raw.replace(/nep141:/gi, '');
    if (/^[0-9a-f]{64}$/i.test(withoutPrefix)) return 'USDC';
    return withoutPrefix.split('.').pop()?.toUpperCase() || 'TOKEN';
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return 'USDC';
  return raw.toUpperCase();
}



