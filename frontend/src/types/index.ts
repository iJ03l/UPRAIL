export interface XUser {
  id: string;
  handle: string; // e.g. "satoshi" (without @ in model, formatted with @ in UI)
  name: string;
  avatarUrl: string;
  isVerified?: boolean;
  nearAccount?: string | null;
  hasPasskey?: boolean;
  /** True once this session has answered a passkey or consumed a recovery code. */
  passkeyVerified?: boolean;
  recoveryAuthorized?: boolean;
  hasRecoveryCodes?: boolean;
  recoveryCodesRemaining?: number;
  isActivated?: boolean;
  personalInviteCode?: string | null;
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
  /** Live USD price from the registry. Absent means "price unknown" — never a guessed number. */
  priceUsd?: number;
  nearContractId: string;
  chain?: string;
  chainId?: string;
  badge?: string;
  category?: 'popular' | 'stables' | 'l1' | 'memes' | 'all';
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
  amountUsd: number | null;
  fee: string;
  feeUsd: number | null;
  feeRecipient?: string;
  inviteCode?: string;
  memo?: string;
  status: PaymentStatus;
  /** Why a CANCELLED payment stopped before settlement (user-safe). */
  cancelReason?: string | null;
  /** Stable cancellation code, e.g. USER_CANCELLED or SETTLEMENT_FAILED. */
  cancelCode?: string | null;
  depositAddress: string;
  depositTxHash?: string;
  shieldedTxHash?: string;
  claimTxHash?: string;
  claimLink: string;
  isDirect?: boolean;
  /** Backend origin marker; 'launchpad:<name>' for a routed creator fee. */
  origin?: string;
  /** True when this receivable is a launchpad creator fee, not a peer send. */
  isCreatorFee?: boolean;
  /** Launchpad name parsed from `origin`, for display. */
  creatorLaunchpad?: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  claimedByPasskeyId?: string;
}

export interface PaymentQuote {
  token: Token;
  amount: string;
  amountUsd: number | null;
  /** amount − protocolFee: what the recipient actually receives. */
  recipientAmount: string;
  recipientAmountUsd: number | null;
  networkFee: string;
  networkFeeUsd: number | null;
  protocolFee: string;
  protocolFeeUsd: number | null;
  protocolFeeRecipient?: string;
  totalAmount: string;
  totalUsd: number | null;
  depositAddress: string;
  estimatedTimeSeconds: number;
  quoteId?: string;
  quoteSignature?: string;
  expiresAt?: number;
  /**
   * Settlement rail the worker will use: 'intents' when the asset lives on
   * intents.near, 'native' for NEAR-only assets (launchpad memes). Absent
   * when the server did not say (older worker / probe outage) — the UI then
   * falls back to the intents label, matching pre-rail behaviour.
   */
  rail?: 'intents' | 'native';
}

/**
 * Public, share-safe receipt for a wallet send / withdrawal, fetched by its
 * unguessable `wth_…` id from `/api/claim/withdrawal/:id`.
 */
export interface WithdrawalReceipt {
  id: string;
  fromHandle: string | null;
  destinationAddress: string;
  asset: string;
  amount: string;
  txHash: string | null;
  status: string;
  /** Why a FAILED withdrawal failed — a user-safe, actionable explanation. */
  failureReason?: string | null;
  createdAt: string;
}

export interface MyInviteResponse {
  inviteCode: string;
  status: 'ACTIVE' | 'USED';
  claimedBy?: {
    handle: string;
    claimedAt: number;
  } | null;
  inviteLink: string;
  paymentInvites?: Array<{
    code: string;
    paymentId: string;
    recipientHandle: string;
    status: 'ACTIVE' | 'USED';
  }>;
}

export interface RedeemInviteResponse {
  success: boolean;
  message: string;
  personalInviteCode: string;
  isActivated: boolean;
}

export interface CreatePaymentRequest {
  recipientHandle: string;
  tokenId: string;
  amount: string;
  memo?: string;
  passkeyAssertion?: unknown;
  quoteSignature?: string;
  depositAddress?: string;
  /**
   * The already-resolved token object. Held launchpad assets are absent from
   * the curated token list, so without it the quote for such an asset cannot
   * be resolved and the send would move the wrong token.
   */
  token?: Token;
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
  amountUsd: number | null;
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

/** A scoped AI chat key that lets any AI chat interface send/receive payments within USD caps. */
export interface AgentKey {
  id: string;
  agentId: string;
  name: string;
  label: string | null;
  keyPrefix: string;
  perTxLimit: string | null;
  dailyLimit: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  /** USD spend recorded against this key for the current UTC day (0 when none). */
  spentToday?: number;
  /** 'oauth' for a browser-approved AI app, 'key' for a manual Bearer key. */
  authMethod?: 'oauth' | 'key';
  oauthClientId?: string | null;
  oauthClientName?: string | null;
  oauthGrantId?: string | null;
  oauthConnectedAt?: number | null;
  connectionStatus?: 'active' | 'revoked' | 'expired' | 'disconnected';
}

/** The create response — `key` is the plaintext secret, shown exactly once. */
export interface CreatedAgentKey extends AgentKey {
  key: string;
}

/** Passkey-verified near.com internal withdrawal destination. */
export interface NearcomDestination {
  nearcomAddress: string;
  intentsAccountId: string;
  createdAt: number;
  updatedAt: number;
}

export interface NearcomWithdrawResponse {
  success: boolean;
  withdrawalId: string;
  status: 'COMPLETED' | 'PENDING';
  txHash: string;
  intentHash: string;
  destinationAddress: string;
  intentsAccountId: string;
  asset: string;
  amount: string;
  privacy: 'confidential';
  rail: 'nearcom_internal';
  shareLink?: string;
  message: string;
}
