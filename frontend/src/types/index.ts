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
  grossAmount?: string;
  amountUsd: number | null;
  grossAmountUsd?: number | null;
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
  requestId?: string;
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

export interface Contact {
  id: string;
  user_x_id: string;
  contact_handle: string;
  contact_x_id?: string | null;
  nickname?: string | null;
  preferred_amount?: string | null;
  preferred_asset?: string | null;
  is_pinned: number;
  created_at: number;
  updated_at: number;
  last_transfer_at?: number | null;
  transfer_count?: number;
  is_registered?: boolean;
  avatar_url?: string | null;
}

export type PaymentRequestStatus = 'PENDING' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface PaymentRequest {
  id: string;
  requester_x_id: string;
  requester_handle: string;
  requester_name?: string;
  requester_avatar?: string | null;
  requested_handle: string;
  requested_x_id?: string | null;
  asset: string;
  amount: string;
  amount_formatted: string;
  memo?: string | null;
  status: PaymentRequestStatus;
  decline_reason?: string | null;
  payment_id?: string | null;
  created_at: number;
  expires_at: number;
  completed_at?: number | null;
  is_recipient_registered?: boolean;
}

export type StabilizeTargetSymbol = 'USDC' | 'USDT';

export interface StabilizeQuote {
  sourceAsset: string;
  sourceSymbol: string;
  sourceDecimals: number;
  targetAsset: string;
  targetSymbol: StabilizeTargetSymbol;
  targetDecimals: number;
  grossAmount: string;
  grossAmountAtomic: string;
  protocolFee: string;
  protocolFeeAtomic: string;
  feePercent: number;
  netAmountIn: string;
  netAmountInAtomic: string;
  amountOut: string;
  amountOutAtomic: string;
  minAmountOut: string;
  minAmountOutAtomic: string;
  amountInUsd: string | null;
  amountOutUsd: string | null;
  protocolFeeUsd: string | null;
  exchangeRate: string;
  slippageBps: number;
  timeEstimateSeconds: number;
  confidential: boolean;
  gasSponsored: boolean;
}

export interface StabilizeResult extends StabilizeQuote {
  id: string;
  status: string;
  depositAddress: string;
  intentHash: string;
  feeIntentHash?: string;
  shieldedAtomic: string;
}

export interface CoffeeChainOption {
  chain: string;
  chainName: string;
  assetId: string;
  decimals: number;
  priceUsd?: number;
}

export interface CoffeeTokenOption {
  symbol: string;
  name: string;
  isStable: boolean;
  chains: CoffeeChainOption[];
}

export interface CoffeeCreatorProfile {
  found: boolean;
  enabled: boolean;
  handle: string;
  name: string;
  avatarUrl: string | null;
}

export interface CoffeeDonation {
  id: string;
  recipientHandle: string;
  originSymbol: string;
  originChain: string;
  originChainName: string;
  targetSymbol: string;
  grossAmount: string;
  amountToSend: string;
  estimatedNetOut: string;
  protocolFee: string;
  feePercent: number;
  depositAddress: string;
  depositMemo?: string;
  status: string;
  payoutTxHash?: string | null;
  intentHash?: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface CoffeeSettingsResponse {
  enabled: boolean;
  handle: string;
  url: string;
  recentDonations: Array<{
    id: string;
    originSymbol: string;
    originChain: string;
    targetSymbol: string;
    grossAmount: string;
    netAmount: string;
    protocolFee: string;
    status: string;
    payoutTxHash?: string | null;
    createdAt: number;
  }>;
}

export type EarnVaultSymbol = 'TLO' | 'gtUSDCp' | 'kV-gtSOLb';

export interface EarnVaultDescriptor {
  symbol: EarnVaultSymbol;
  name: string;
  protocol: string;
  underlyingSymbol: string;
  chain: string;
  chainName: string;
  assetId: string;
  decimals: number;
  estimatedApyPct: number;
  minDepositUsd: number;
  riskTier: 'LOW' | 'MODERATE';
  description: string;
  priceUsd: number;
  liveAvailable: boolean;
}

export type GiftOccasion =
  | 'BIRTHDAY'
  | 'CHRISTMAS'
  | 'NEW_YEAR'
  | 'ANNIVERSARY'
  | 'GRADUATION'
  | 'WEDDING'
  | 'THANK_YOU'
  | 'JUST_BECAUSE';

export type GiftStatus = 'PENDING_FUNDING' | 'LOCKED' | 'CLAIMING' | 'CLAIMED' | 'EXPIRED';

export interface GiftQuoteResult {
  originAssetId: string;
  originSymbol: string;
  originChain: string;
  originDecimals: number;
  vaultSymbol: EarnVaultSymbol;
  vaultName: string;
  vaultAssetId: string;
  vaultProtocol: string;
  vaultDecimals: number;
  estimatedApyPct: number;
  grossAmount: string;
  netAmount: string;
  protocolFee: string;
  feePercent: number;
  principalUsdCents: number;
  estimatedSharesOut: string;
  minSharesOut: string;
  timeEstimateSeconds: number;
}

export interface PublicGiftCardView {
  id: string;
  senderHandle: string;
  recipientHandle: string;
  occasion: GiftOccasion;
  occasionLabel: string;
  vaultSymbol: string;
  vaultName: string;
  vaultProtocol: string;
  vaultChainName: string;
  estimatedApyPct: number;
  timelockUntil: number;
  isUnlocked: boolean;
  status: GiftStatus;
  showAmount: boolean;
  principalUsdCents?: number;
  currentValueUsdCents?: number;
  yieldUsdCents?: number;
  sharesFormatted?: string;
  shareUrl: string;
  ogImageUrl: string;
  createdAt: number;
  claimedAt: number | null;
}

export interface AuthenticatedGiftView {
  id: string;
  role: 'SENDER' | 'RECIPIENT';
  senderHandle: string;
  recipientHandle: string;
  occasion: GiftOccasion;
  occasionLabel: string;
  message: string | null;
  vaultSymbol: string;
  vaultName: string;
  vaultProtocol: string;
  vaultChainName: string;
  estimatedApyPct: number;
  sourceSymbol: string;
  grossAmount: string;
  principalUsdCents: number;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  yieldPct: number;
  sharesAtomic: string;
  sharesFormatted: string;
  custodyAccount: string;
  depositAddress: string | null;
  depositMemo: string | null;
  timelockUntil: number;
  isUnlocked: boolean;
  status: GiftStatus;
  showAmount: boolean;
  claimTxHash: string | null;
  canClaim: boolean;
  shareUrl: string;
  ogImageUrl: string;
  createdAt: number;
  claimedAt: number | null;
}

export type CirclePurpose =
  | 'CONTRIBUTIONS'
  | 'SHARED_GOAL'
  | 'RENT'
  | 'TRIP'
  | 'DAILY_TIP'
  | 'SAVINGS_CLUB';

export type CircleStatus = 'ACTIVE' | 'SETTLING' | 'COMPLETED' | 'DISSOLVING' | 'DISSOLVED';

export interface CircleMemberView {
  id: string;
  handle: string;
  isRegistered: boolean;
  shareBps: number;
  percentageShare: number;
  quotaUsdCents: number;
  contributedUsdCents: number;
  progressPct: number;
  hasMetQuota: boolean;
  sharesAtomic: string;
  sharesFormatted: string;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  refundedAt: number | null;
  refundTxHash: string | null;
}

export interface CircleContributionView {
  id: string;
  memberId: string;
  contributorXId: string;
  sourceSymbol: string;
  grossAmount: string;
  usdCents: number;
  sharesFormatted: string;
  status: string;
  depositAddress: string | null;
  depositMemo: string | null;
  createdAt: number;
  confirmedAt: number | null;
}

export interface CircleView {
  id: string;
  creatorHandle: string;
  isCreator: boolean;
  isMember: boolean;
  myMemberId: string | null;
  name: string;
  purpose: CirclePurpose;
  purposeLabel: string;
  note: string | null;
  targetUsdCents: number;
  contributedUsdCents: number;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  yieldPct: number;
  progressPct: number;
  allQuotasMet: boolean;
  vaultSymbol: string;
  vaultName: string;
  vaultProtocol: string;
  vaultChainName: string;
  vaultAssetId: string;
  vaultDecimals: number;
  estimatedApyPct: number;
  totalSharesAtomic: string;
  totalSharesFormatted: string;
  payoutHandle: string;
  custodyAccount: string;
  status: CircleStatus;
  payoutTxHash: string | null;
  members: CircleMemberView[];
  recentContributions: CircleContributionView[];
  createdAt: number;
  closedAt: number | null;
}


