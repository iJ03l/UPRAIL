import {
  Token,
  PaymentIntent,
  PaymentQuote,
  CreatePaymentRequest,
  XUser,
  ClaimPaymentResult,
  ShieldedBalance,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Built-in supported tokens for NEAR Confidential Intents
export const SUPPORTED_TOKENS: Token[] = [
  {
    id: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    iconUrl: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=035',
    decimals: 6,
    priceUsd: 1.0,
    nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    badge: 'Confidential',
    balance: '450.00',
  },
  {
    id: 'usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    iconUrl: 'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=035',
    decimals: 6,
    priceUsd: 1.0,
    nearContractId: 'usdt.tether-token.near',
    badge: 'Confidential',
    balance: '120.50',
  },
  {
    id: 'near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    iconUrl: 'https://cryptologos.cc/logos/near-protocol-near-logo.svg?v=035',
    decimals: 24,
    priceUsd: 5.85,
    nearContractId: 'wrap.near',
    badge: 'Native Shield',
    balance: '35.40',
  },
  {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ethereum',
    iconUrl: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=035',
    decimals: 18,
    priceUsd: 3450.0,
    nearContractId: 'aurora',
    badge: 'Cross-chain',
    balance: '0.85',
  },
  {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    iconUrl: 'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=035',
    decimals: 8,
    priceUsd: 68500.0,
    nearContractId: 'btc.near',
    badge: 'Cross-chain',
    balance: '0.045',
  },
];

// LocalStorage helpers for mock/offline resilience
const STORAGE_KEYS = {
  USER: 'uprail_x_user',
  PAYMENTS: 'uprail_payments',
  SHIELDED: 'uprail_shielded_balances',
  PASSKEYS: 'uprail_passkeys',
};

// Seed sample payments if empty
function initializeLocalStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS)) {
    const demoPayments: PaymentIntent[] = [
      {
        id: 'up_98a712f',
        claimCode: 'up_98a712f',
        senderHandle: 'mert',
        senderName: 'Mert Mumtaz',
        recipientHandle: 'illia',
        token: SUPPORTED_TOKENS[0], // USDC
        amount: '500.00',
        amountUsd: 500.0,
        fee: '0.01',
        feeUsd: 0.01,
        memo: 'Solana ⇄ NEAR intent swap test ⚡',
        status: 'ready',
        depositAddress: 'escrow.uprail.near',
        depositTxHash: '9y3dD2Y4cE67bZ8eF9a0',
        claimLink: `${window.location.origin}/claim?payment=up_98a712f`,
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 6).toISOString(),
      },
      {
        id: 'up_41c099b',
        claimCode: 'up_41c099b',
        senderHandle: 'alex',
        senderName: 'Alex Skidanov',
        recipientHandle: 'illia',
        token: SUPPORTED_TOKENS[2], // NEAR
        amount: '75.0',
        amountUsd: 438.75,
        fee: '0.005',
        feeUsd: 0.03,
        memo: 'Bounty payout via confidential shard',
        status: 'claimed',
        depositAddress: 'escrow.uprail.near',
        depositTxHash: '3w1aK8e2mN05rQ7yP4d1',
        claimTxHash: '8b4xT7s1eV92zK3mH5p8',
        claimLink: `${window.location.origin}/claim?payment=up_41c099b`,
        createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 5).toISOString(),
        claimedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      },
      {
        id: 'up_12e987c',
        claimCode: 'up_12e987c',
        senderHandle: 'illia',
        senderName: 'Illia Polosukhin',
        recipientHandle: 'mert',
        token: SUPPORTED_TOKENS[0], // USDC
        amount: '250.00',
        amountUsd: 250.0,
        fee: '0.01',
        feeUsd: 0.01,
        memo: 'Cross-chain confidential liquidity',
        status: 'claimed',
        depositAddress: 'escrow.uprail.near',
        depositTxHash: '4x9kM1p7qR22yZ5eA3b8',
        claimTxHash: '1a7vW3e9kP54bH8mN2c1',
        claimLink: `${window.location.origin}/claim?payment=up_12e987c`,
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 4).toISOString(),
        claimedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
    ];
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(demoPayments));
  }

  // Note: We do not force auto-seed a logged in user so LoginPage functions as the proper initial entry point.
}

initializeLocalStorage();

export const api = {
  // Auth endpoints
  async getAuthStatus(): Promise<{ user: XUser | null }> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/auth/x/status`, { credentials: 'include' });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend /auth/x/status unavailable, fallback to local state', e);
    }
    const stored = localStorage.getItem(STORAGE_KEYS.USER);
    return { user: stored ? JSON.parse(stored) : null };
  },

  async loginWithX(demoHandle?: string): Promise<XUser> {
    if (API_BASE && !demoHandle) {
      window.location.href = `${API_BASE}/auth/x/login`;
      return new Promise(() => {}); // redirecting
    }
    // Simulation / demo mode
    const handle = demoHandle || 'cryptowhale';
    const user: XUser = {
      id: String(Math.floor(Math.random() * 9000000 + 1000000)),
      handle: handle.replace(/^@/, '').toLowerCase(),
      name: handle.charAt(0).toUpperCase() + handle.slice(1),
      avatarUrl: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 1000)}?w=150&auto=format&fit=crop&q=80`,
      isVerified: true,
    };
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    return user;
  },

  async logout(): Promise<void> {
    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/auth/x/logout`, { method: 'POST', credentials: 'include' });
      }
    } catch (e) {
      console.warn('Backend logout failed', e);
    }
    localStorage.removeItem(STORAGE_KEYS.USER);
  },

  // Token list
  async getTokens(): Promise<Token[]> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/tokens`);
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend /api/tokens unavailable, returning supported tokens', e);
    }
    return SUPPORTED_TOKENS;
  },

  // Payment quote calculation
  async getQuote(tokenId: string, amount: string): Promise<PaymentQuote> {
    const numAmount = parseFloat(amount) || 0;
    const token = SUPPORTED_TOKENS.find((t) => t.id === tokenId) || SUPPORTED_TOKENS[0];
    const amountUsd = numAmount * token.priceUsd;
    const networkFee = token.id === 'near' ? '0.005' : '0.01';
    const networkFeeUsd = parseFloat(networkFee) * token.priceUsd;
    const protocolFee = '0.00';
    const protocolFeeUsd = 0;
    const totalAmount = (numAmount + parseFloat(networkFee)).toFixed(token.decimals > 6 ? 4 : 2);
    const totalUsd = amountUsd + networkFeeUsd;

    return {
      token,
      amount: amount || '0',
      amountUsd,
      networkFee,
      networkFeeUsd,
      protocolFee,
      protocolFeeUsd,
      totalAmount,
      totalUsd,
      depositAddress: 'uprail-escrow-v1.near',
      estimatedTimeSeconds: 2,
    };
  },

  // Create payment intent
  async createPayment(params: CreatePaymentRequest): Promise<PaymentIntent> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(params),
        });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend createPayment error, saving locally', e);
    }

    const token = SUPPORTED_TOKENS.find((t) => t.id === params.tokenId) || SUPPORTED_TOKENS[0];
    const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || '{"handle":"anonymous"}');
    const claimCode = `up_${Math.random().toString(36).substring(2, 9)}`;
    const cleanRecipient = params.recipientHandle.replace(/^@/, '').trim().toLowerCase();
    const numAmount = parseFloat(params.amount) || 0;

    const newPayment: PaymentIntent = {
      id: claimCode,
      claimCode,
      senderHandle: user.handle,
      senderName: user.name || user.handle,
      recipientHandle: cleanRecipient,
      token,
      amount: params.amount,
      amountUsd: numAmount * token.priceUsd,
      fee: '0.01',
      feeUsd: 0.01 * token.priceUsd,
      memo: params.memo || '',
      status: 'ready',
      depositAddress: 'uprail-escrow-v1.near',
      depositTxHash: `0x${Math.random().toString(16).substring(2, 18)}`,
      shieldedTxHash: `intent_near_${Math.random().toString(36).substring(2, 14)}`,
      claimLink: `${window.location.origin}/claim?payment=${claimCode}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(), // 7 days expiration
    };

    const existing: PaymentIntent[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
    existing.unshift(newPayment);
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(existing));

    return newPayment;
  },

  // Get payment by ID / code
  async getPaymentByCode(code: string): Promise<PaymentIntent | null> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/payments/claim/${encodeURIComponent(code)}`);
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend getPaymentByCode error', e);
    }

    const existing: PaymentIntent[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
    const cleanCode = code.trim().toLowerCase();
    return existing.find((p) => p.claimCode.toLowerCase() === cleanCode || p.id.toLowerCase() === cleanCode) || null;
  },

  // Get user payments (sent & received)
  async getPaymentHistory(): Promise<PaymentIntent[]> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/payments/history`, { credentials: 'include' });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend getPaymentHistory error', e);
    }

    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
  },

  // Passkey Registration Options
  async getPasskeyRegisterOptions(handle: string) {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/passkey/register-options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend passkey register-options error', e);
    }

    // Default WebAuthn PublicKeyCredentialCreationOptionsJSON (NIST P-256)
    return {
      challenge: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
      rp: {
        name: 'UP (UPRAIL.app)',
        id: window.location.hostname,
      },
      user: {
        id: btoa(handle),
        name: `@${handle}`,
        displayName: `@${handle}`,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256 (NIST P-256)
      ],
      timeout: 60000,
      attestation: 'none' as const,
      authenticatorSelection: {
        residentKey: 'preferred' as const,
        userVerification: 'preferred' as const,
      },
    };
  },

  // Passkey Auth Options (for claiming)
  async getPasskeyAuthOptions(handle: string) {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/passkey/auth-options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend passkey auth-options error', e);
    }

    return {
      challenge: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
      timeout: 60000,
      rpId: window.location.hostname,
      userVerification: 'preferred' as const,
    };
  },

  // Claim Payment with Passkey verification
  async claimPayment(claimCode: string, recipientHandle: string, passkeyAuthPayload: unknown): Promise<ClaimPaymentResult> {
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/payments/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimCode, recipientHandle, passkeyAuth: passkeyAuthPayload }),
        });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      console.warn('Backend claimPayment error', e);
    }

    // Update in local mock storage
    const payments: PaymentIntent[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
    const idx = payments.findIndex((p) => p.claimCode === claimCode || p.id === claimCode);

    if (idx === -1) {
      throw new Error('Payment not found or already claimed.');
    }

    if (payments[idx].status === 'claimed') {
      return {
        success: true,
        payment: payments[idx],
        shieldedTxHash: payments[idx].claimTxHash || 'already_claimed',
        message: 'This payment was already claimed.',
      };
    }

    const claimTxHash = `intent_claim_p256_${Math.random().toString(36).substring(2, 12)}`;
    payments[idx].status = 'claimed';
    payments[idx].claimedAt = new Date().toISOString();
    payments[idx].claimTxHash = claimTxHash;
    payments[idx].claimedByPasskeyId = `p256_${Math.random().toString(36).substring(2, 10)}`;

    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));

    // Update shielded balance for user
    const currentShielded: ShieldedBalance[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SHIELDED) || '[]');
    const tok = payments[idx].token;
    const existingTokIdx = currentShielded.findIndex((b) => b.token.id === tok.id);
    const addedAmount = parseFloat(payments[idx].amount) || 0;

    if (existingTokIdx >= 0) {
      const newAmt = (parseFloat(currentShielded[existingTokIdx].amount) + addedAmount).toFixed(2);
      currentShielded[existingTokIdx].amount = newAmt;
      currentShielded[existingTokIdx].amountUsd = parseFloat(newAmt) * tok.priceUsd;
    } else {
      currentShielded.push({
        token: tok,
        amount: payments[idx].amount,
        amountUsd: payments[idx].amountUsd,
      });
    }
    localStorage.setItem(STORAGE_KEYS.SHIELDED, JSON.stringify(currentShielded));

    return {
      success: true,
      payment: payments[idx],
      shieldedTxHash: claimTxHash,
      message: 'Payment successfully shielded to your passkey device vault!',
    };
  },

  // Shielded balances
  async getShieldedBalances(): Promise<ShieldedBalance[]> {
    const stored = localStorage.getItem(STORAGE_KEYS.SHIELDED);
    if (stored) {
      return JSON.parse(stored);
    }
    // Default initial shielded balance
    const defaults: ShieldedBalance[] = [
      {
        token: SUPPORTED_TOKENS[0], // USDC
        amount: '125.00',
        amountUsd: 125.0,
      },
      {
        token: SUPPORTED_TOKENS[2], // NEAR
        amount: '4.50',
        amountUsd: 26.32,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.SHIELDED, JSON.stringify(defaults));
    return defaults;
  },
};
