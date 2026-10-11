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
} from '../types';
import { fetchOnchainTokens } from './onchainApi';

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

function claimUrlFor(paymentId: string, inviteCode?: string | null): string {
  const base = `${claimBaseUrl()}/${paymentId}`;
  return inviteCode ? `${base}?invite=${encodeURIComponent(inviteCode)}` : base;
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
  return bySuffix || fallback;
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
  return {
    id: p.id,
    claimCode: p.id,
    senderHandle: p.sender_x_handle || '',
    senderName: p.sender_x_handle ? `@${p.sender_x_handle}` : undefined,
    recipientHandle: p.recipient_handle || '',
    token,
    amount: p.amount,
    amountUsd: numAmount * tokenUsdPrice(token),
    fee,
    feeUsd: (parseFloat(fee) || 0) * tokenUsdPrice(token),
    feeRecipient: p.fee_recipient || 'fees.uprail.near',
    inviteCode: p.invite_code || undefined,
    memo: p.memo || '',
    status: mapBackendStatus(p.status),
    depositAddress: p.deposit_address || 'escrow.uprail.near',
    claimTxHash: p.claim_tx_hash || undefined,
    claimLink: claimUrlFor(p.id, p.invite_code),
    createdAt: new Date(p.created_at).toISOString(),
    expiresAt: new Date(p.expires_at).toISOString(),
  };
}

/**
 * USD price to display for a token.
 *
 * Uses the live registry price when the backend supplied one. Stablecoins are
 * pinned to 1.0 (they ARE dollars). Anything else with no price reports 0 —
 * never a made-up number, which used to render 1 NEAR as $1.00 and made the
 * dashboard totals confidently wrong.
 */
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'FRAX', 'BUSD', 'USDG', 'PYUSD', 'USDBC']);
export function tokenUsdPrice(token: { symbol?: string; priceUsd?: number } | null | undefined): number {
  const p = token?.priceUsd;
  if (typeof p === 'number' && isFinite(p) && p > 0) return p;
  return STABLE_SYMBOLS.has((token?.symbol || '').trim().toUpperCase()) ? 1 : 0;
}

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  (typeof process !== 'undefined' && process.env?.API_URL) ||
  '';

import { getOnchainIcon } from './onchainIcons';

/**
 * Offline fallback token list, used ONLY when both `/api/tokens` and the
 * onchain registry are unreachable. Prices here are deliberate last-resort
 * estimates for rendering something instead of `$NaN` — live registry prices
 * always win (see `tokenUsdPrice()`).
 */
export const SUPPORTED_TOKENS: Token[] = [
  {
    id: 'nep141:wrap.near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    iconUrl: getOnchainIcon('near') || '',
    decimals: 24,
    priceUsd: 5.42,
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
    priceUsd: 1.0,
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
    priceUsd: 1.0,
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
    priceUsd: 2500.0,
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
    priceUsd: 82000.0,
    nearContractId: '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near',
    chain: 'near',
    badge: 'NEAR',
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
  }
}

export const api = {
  // Auth endpoints
  async getAuthStatus(): Promise<{ user: XUser | null }> {
    try {
      const url = API_BASE ? `${API_BASE}/auth/status` : '/auth/status';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated && data?.user) {
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
          return { user: data.user };
        }
      }
    } catch (e) {
      console.warn('Backend /auth/status unavailable', e);
    }
    localStorage.removeItem(STORAGE_KEYS.USER);
    return { user: null };
  },

  async loginWithX(inviteCode?: string): Promise<never> {
    let invite = inviteCode;
    if (!invite && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      invite = params.get('invite') || undefined;
    }
    const params = new URLSearchParams();
    if (invite) params.set('invite', invite.trim().toUpperCase());
    params.set('return_to', '/login');
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
    try {
      const url = API_BASE ? `${API_BASE}/auth/logout` : '/auth/logout';
      await fetch(url, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Backend logout failed', e);
    }
    clearAppStorage();
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
          const mapped: Token[] = list.map((t: any) => {
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
              priceUsd: t.priceUsd ?? (STABLE_SYMBOLS.has((t.symbol || '').trim().toUpperCase()) ? 1 : 0),
              nearContractId: t.nearContractId || (isNativeNear ? 'wrap.near' : ''),
              chain: tokenChain,
              badge: t.badge || tokenChain.toUpperCase(),
              category: t.category || (isNativeNear ? 'popular' : 'all'),
              balance: t.balance || '0.00',
            };
          });

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

  // Payment quote calculation with cryptographic backend binding
  // Payment quote calculation with cryptographic backend binding
  async getQuote(tokenId: string, amount: string, recipientHandle = 'escrow'): Promise<PaymentQuote> {
    const numAmount = parseFloat(amount) || 0;
    const tokens = await api.getTokens();
    const token = tokens.find((t) => t.id === tokenId || t.symbol.toLowerCase() === tokenId.toLowerCase()) || tokens[0] || SUPPORTED_TOKENS[0];
    const amountUsd = numAmount * tokenUsdPrice(token);

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
        const networkFeeUsd = parseFloat(networkFee) * tokenUsdPrice(token);
        const protocolFee = q.protocolFee !== undefined ? q.protocolFee : (numAmount * 0.008).toFixed(6).replace(/\.?0+$/, '') || '0';
        const protocolFeeUsd = parseFloat(protocolFee) * tokenUsdPrice(token);
        const protocolFeeRecipient = q.feeRecipient || 'fees.uprail.near';
        const totalAmount = (numAmount + parseFloat(networkFee) + parseFloat(protocolFee)).toFixed(token.decimals > 6 ? 4 : 2);
        const totalUsd = amountUsd + networkFeeUsd + protocolFeeUsd;

        return {
          token,
          amount: amount || '0',
          amountUsd,
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
          estimatedTimeSeconds: 2,
        };
      }
    } catch (e) {
      console.warn('Backend /api/quote call error:', e);
    }

    const networkFee = token.id.includes('near') ? '0.005' : '0.01';
    const networkFeeUsd = parseFloat(networkFee) * tokenUsdPrice(token);
    const protocolFee = (numAmount * 0.008).toFixed(6).replace(/\.?0+$/, '') || '0';
    const protocolFeeUsd = parseFloat(protocolFee) * tokenUsdPrice(token);
    const protocolFeeRecipient = 'fees.uprail.near';
    const totalAmount = (numAmount + parseFloat(networkFee) + parseFloat(protocolFee)).toFixed(token.decimals > 6 ? 4 : 2);
    const totalUsd = amountUsd + networkFeeUsd + protocolFeeUsd;

    return {
      token,
      amount: amount || '0',
      amountUsd,
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
      const q = await api.getQuote(params.tokenId, params.amount, cleanHandle);
      quoteSignature = q.quoteSignature;
      depositAddress = q.depositAddress;
      // Send exactly the asset id the quote was signed for — /api/send
      // verifies the signature with an exact (non-fuzzy) asset comparison.
      params = { ...params, tokenId: q.token.id };
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
      }),
    });

    const tokens = await api.getTokens();
    const token = resolveTokenForAsset(params.tokenId, tokens);
    const numAmount = parseFloat(params.amount) || 0;

    if (res.ok) {
      const backendData = await res.json();
      return {
        id: backendData.paymentId,
        claimCode: backendData.paymentId,
        senderHandle: '',
        recipientHandle: cleanHandle,
        token,
        amount: params.amount,
        amountUsd: numAmount * tokenUsdPrice(token),
        fee: backendData.fee || '0',
        feeUsd: (parseFloat(backendData.fee || '0')) * tokenUsdPrice(token),
        feeRecipient: backendData.feeRecipient || 'fees.uprail.near',
        inviteCode: backendData.inviteCode,
        memo: params.memo || '',
        status: mapBackendStatus(backendData.status),
        depositAddress: backendData.depositAddress || depositAddress || 'escrow.uprail.near',
        claimLink: backendData.shareLink || claimUrlFor(backendData.paymentId, backendData.inviteCode),
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

  // Withdraw shielded funds from virtual vault to external blockchain address
  async withdraw(params: {
    destinationAddress: string;
    asset?: string;
    amount?: string;
    passkeyAssertion: unknown;
  }): Promise<{
    success: boolean;
    txHash: string;
    withdrawalId?: string;
    destinationAddress: string;
    amount: string;
    asset: string;
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
};
