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

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  (typeof process !== 'undefined' && process.env?.API_URL) ||
  '';

// Built-in supported tokens for NEAR Confidential Intents (clean initial state: 0.00)
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
    balance: '0.00',
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
    balance: '0.00',
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
    balance: '0.00',
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
    balance: '0.00',
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
    balance: '0.00',
  },
];

const STORAGE_KEYS = {
  USER: 'uprail_x_user',
  PAYMENTS: 'uprail_payments',
  SHIELDED: 'uprail_shielded_balances',
  PASSKEYS: 'uprail_passkeys',
};

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
    const url = API_BASE ? `${API_BASE}/auth/x/login${query}` : `/auth/x/login${query}`;
    window.location.href = url;
    return new Promise<never>(() => {});
  },

  async logout(): Promise<void> {
    try {
      const url = API_BASE ? `${API_BASE}/auth/logout` : '/auth/logout';
      await fetch(url, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Backend logout failed', e);
    }
    localStorage.removeItem(STORAGE_KEYS.USER);
  },

  // Passkey Login Endpoints
  async getPasskeyLoginOptions() {
    const url = API_BASE ? `${API_BASE}/auth/passkey/login-options` : '/auth/passkey/login-options';
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
        if (list.length > 0) return list;
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
    const amountUsd = numAmount * (token.priceUsd || 1.0);

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
        const networkFeeUsd = parseFloat(networkFee) * (token.priceUsd || 1.0);
        const protocolFee = q.protocolFee !== undefined ? q.protocolFee : (numAmount * 0.008).toFixed(6).replace(/\.?0+$/, '') || '0';
        const protocolFeeUsd = parseFloat(protocolFee) * (token.priceUsd || 1.0);
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
    const networkFeeUsd = parseFloat(networkFee) * (token.priceUsd || 1.0);
    const protocolFee = (numAmount * 0.008).toFixed(6).replace(/\.?0+$/, '') || '0';
    const protocolFeeUsd = parseFloat(protocolFee) * (token.priceUsd || 1.0);
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
    const cleanHandle = params.recipientHandle.replace(/^@/, '').toLowerCase();

    // If quoteSignature is not provided, obtain a real cryptographic quote first
    let quoteSignature = params.quoteSignature;
    let depositAddress = params.depositAddress;

    if (!quoteSignature || !depositAddress) {
      const q = await api.getQuote(params.tokenId, params.amount, cleanHandle);
      quoteSignature = q.quoteSignature;
      depositAddress = q.depositAddress;
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
        quoteSignature,
        depositAddress: depositAddress || 'escrow.uprail.near',
        passkeyAssertion: params.passkeyAssertion,
      }),
    });

    const tokens = await api.getTokens();
    const token = tokens.find((t) => t.id === params.tokenId || t.symbol.toLowerCase() === params.tokenId.toLowerCase()) || tokens[0] || SUPPORTED_TOKENS[0];
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
        amountUsd: numAmount * (token.priceUsd || 1.0),
        fee: backendData.fee || '0',
        feeUsd: (parseFloat(backendData.fee || '0')) * (token.priceUsd || 1.0),
        feeRecipient: backendData.feeRecipient || 'fees.uprail.near',
        inviteCode: backendData.inviteCode,
        memo: params.memo || '',
        status: 'ready',
        depositAddress: backendData.depositAddress || depositAddress || 'escrow.uprail.near',
        claimLink: backendData.shareLink || `${window.location.origin}/claim/${backendData.paymentId}`,
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
        const token = SUPPORTED_TOKENS.find((t) => t.id.toLowerCase() === (p.asset || 'usdc').toLowerCase()) || SUPPORTED_TOKENS[0];
        const numAmount = parseFloat(p.amount) || 0;
        return {
          id: p.id,
          claimCode: p.id,
          senderHandle: p.sender_x_handle || '',
          senderName: p.sender_x_handle ? `@${p.sender_x_handle}` : undefined,
          recipientHandle: p.recipient_handle || '',
          token,
          amount: p.amount,
          amountUsd: numAmount * token.priceUsd,
          fee: '0.01',
          feeUsd: 0.01 * token.priceUsd,
          memo: '',
          status: p.status === 'CLAIMED' ? 'claimed' : p.status === 'CANCELLED' ? 'cancelled' : 'ready',
          depositAddress: p.deposit_address || 'escrow.uprail.near',
          claimLink: `https://uprail.app/claim/${p.id}`,
          createdAt: new Date(p.created_at).toISOString(),
          expiresAt: new Date(p.expires_at).toISOString(),
        };
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
        return paymentsList.map((p: any) => {
          const token = SUPPORTED_TOKENS.find((t) => t.id.toLowerCase() === (p.asset || 'usdc').toLowerCase()) || SUPPORTED_TOKENS[0];
          const numAmount = parseFloat(p.amount) || 0;
          return {
            id: p.id,
            claimCode: p.id,
            senderHandle: p.sender_x_handle || '',
            senderName: p.sender_x_handle ? `@${p.sender_x_handle}` : undefined,
            recipientHandle: p.recipient_handle || '',
            token,
            amount: p.amount,
            amountUsd: numAmount * token.priceUsd,
            fee: '0.01',
            feeUsd: 0.01 * token.priceUsd,
            memo: '',
            status: p.status === 'CLAIMED' ? 'claimed' : p.status === 'CANCELLED' ? 'cancelled' : 'ready',
            depositAddress: p.deposit_address || 'escrow.uprail.near',
            claimLink: `https://uprail.app/claim/${p.id}`,
            createdAt: new Date(p.created_at).toISOString(),
            expiresAt: new Date(p.expires_at).toISOString(),
          };
        });
      }
    } catch (e) {
      console.warn('Backend getPaymentHistory error', e);
    }
    return [];
  },

  // Passkey Registration Options
  async getPasskeyRegisterOptions(handle: string) {
    try {
      const url = API_BASE ? `${API_BASE}/api/claim/register-options` : '/api/claim/register-options';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) return await res.json();
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

  // Passkey Auth Options (for claiming or verification)
  async getPasskeyAuthOptions(_handle?: string) {
    try {
      const url = API_BASE ? `${API_BASE}/auth/passkey/login-options` : '/auth/passkey/login-options';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) return await res.json();
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

  // Get pending payments sent to the authenticated user (no code or link needed!)
  async getPendingPayments(): Promise<PaymentIntent[]> {
    try {
      const url = API_BASE ? `${API_BASE}/api/claim/pending` : '/api/claim/pending';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const paymentsList = data.payments || [];
        return paymentsList.map((p: any) => {
          const token = SUPPORTED_TOKENS.find((t) => t.id.toLowerCase() === (p.asset || 'usdc').toLowerCase()) || SUPPORTED_TOKENS[0];
          const numAmount = parseFloat(p.amount) || 0;
          return {
            id: p.id,
            claimCode: p.id,
            senderHandle: p.sender_x_handle || '',
            senderName: p.sender_x_handle ? `@${p.sender_x_handle}` : undefined,
            recipientHandle: p.recipient_handle || '',
            token,
            amount: p.amount,
            amountUsd: numAmount * token.priceUsd,
            fee: '0.01',
            feeUsd: 0.01 * token.priceUsd,
            memo: '',
            status: p.status === 'CLAIMED' ? 'claimed' : p.status === 'CANCELLED' ? 'cancelled' : 'ready',
            depositAddress: p.deposit_address || 'escrow.uprail.near',
            claimLink: `https://uprail.app/claim/${p.id}`,
            createdAt: new Date(p.created_at).toISOString(),
            expiresAt: new Date(p.expires_at).toISOString(),
          };
        });
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
};
