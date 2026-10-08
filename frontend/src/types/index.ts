export interface XUser {
  id: string;
  handle: string; // e.g. "satoshi" (without @ in model, formatted with @ in UI)
  name: string;
  avatarUrl: string;
  isVerified?: boolean;
  nearAccount?: string | null;
}

export interface AuthSession {
  user: XUser | null;
  token?: string;
  expiresAt?: number;
}

export interface Token {
  id: string;
  symbol: string;
  name: string;
  iconUrl: string;
  decimals: number;
  priceUsd: number;
  nearContractId: string;
  badge?: string;
  balance?: string; // Available sender balance in active wallet/shielded pool
}

export type PaymentStatus = 
  | 'pending'    // Awaiting deposit / funding
  | 'escrowed'   // Funds locked in confidential NEAR intent contract
  | 'ready'      // Escrow confirmed, awaiting recipient passkey claim
  | 'claimed'    // Successfully claimed by recipient device passkey
  | 'expired'    // Claim window expired, refundable to sender
  | 'refunded'   // Escrow returned to sender
  | 'cancelled'; // Cancelled by sender

export interface PaymentIntent {
  id: string;
  claimCode: string;
  senderHandle: string;
  senderName?: string;
  recipientHandle: string;
  token: Token;
  amount: string;
  amountUsd: number;
  fee: string;
  feeUsd: number;
  memo?: string;
  status: PaymentStatus;
  depositAddress: string;
  depositTxHash?: string;
  shieldedTxHash?: string;
  claimTxHash?: string;
  claimLink: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  claimedByPasskeyId?: string;
}

export interface PaymentQuote {
  token: Token;
  amount: string;
  amountUsd: number;
  networkFee: string;
  networkFeeUsd: number;
  protocolFee: string;
  protocolFeeUsd: number;
  totalAmount: string;
  totalUsd: number;
  depositAddress: string;
  estimatedTimeSeconds: number;
}

export interface CreatePaymentRequest {
  recipientHandle: string;
  tokenId: string;
  amount: string;
  memo?: string;
}

export interface PasskeyCredential {
  id: string;
  rawId: string;
  type: 'public-key';
  algorithm: 'ES256'; // NIST P-256
  createdAt: string;
  handle: string;
  deviceLabel?: string;
}

export interface ShieldedBalance {
  token: Token;
  amount: string;
  amountUsd: number;
}

export interface ClaimPaymentRequest {
  claimCode: string;
  recipientHandle: string;
  passkeyAuth?: unknown;
}

export interface ClaimPaymentResult {
  success: boolean;
  payment?: PaymentIntent;
  shieldedTxHash: string;
  message: string;
}
