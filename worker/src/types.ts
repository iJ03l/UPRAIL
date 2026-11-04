/**
 * Type definitions for UP (UPRAIL.app) Cloudflare Worker
 */

export enum PaymentStatus {
  PENDING = 'PENDING',
  DEPOSIT_WAITING = 'DEPOSIT_WAITING',
  ESCROWED = 'ESCROWED',
  CLAIMED = 'CLAIMED',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
  // A refund whose broadcast was ambiguous (may or may not have landed). Kept
  // out of every sweep so it can never be retried into a double-refund; it
  // needs manual onchain reconciliation.
  REFUND_REVIEW = 'REFUND_REVIEW',
  CANCELLED = 'CANCELLED',
}

export interface Env {
  // Bindings
  DB: D1Database;
  CACHE: KVNamespace;
  OAUTH_KV: KVNamespace;
  ASSETS?: Fetcher;
  // Optional: only present in deployments that still run the settlement
  // service as a Worker container. Free-tier deployments leave these unset
  // and reach the Go service directly through SETTLEMENT_SERVICE_URL.
  ESCROW?: DurableObjectNamespace;
  NEAR_CONTAINER?: DurableObjectNamespace;

  // Environment variables
  X_CLIENT_ID: string;
  NEAR_API_BASE: string;
  NEAR_RPC_URL: string;
  INTENTS_CONTRACT_ID: string;
  SOLVER_RELAY_URL: string;
  ESCROW_ACCOUNT_ID: string;
  PAYMENT_EXPIRY_DAYS: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
  WEBAUTHN_ORIGIN: string;

  // OAuth 2.1 issuer + protected MCP resource. Overridable for local dev/tests.
  OAUTH_ISSUER: string;
  OAUTH_RESOURCE: string;

  // Master Wallet & Custody
  MASTER_ACCOUNT_ID?: string;
  MASTER_PRIVATE_KEY?: string;

  // Protocol fees (FEE_PERCENT, currently 1%, to the escrow holding account
  // by default — see wrangler.jsonc for why fees.uprail.near cannot receive)
  FEE_ACCOUNT_ID?: string;
  FEE_PERCENT?: string;
  /**
   * Creator-fee dust guard: a launchpad fee whose USD value is known and below
   * this threshold is held (claimed later) instead of spending escrow gas to
   * settle it immediately. Unknown price → routed as normal. Default 1.
   */
  MIN_FEE_USD?: string;
  /**
   * Daily cap on escrow storage registrations triggered by the
   * unauthenticated zero-integration path, bounding the gas a stranger can
   * make escrow spend. Default 50.
   */
  PUBLIC_REG_DAILY_CAP?: string;

  // Self-serve launchpad registration is authenticated by a NEP-413 signature
  // from each token's parent account. This cap bounds registrations per day.
  LAUNCHPAD_DAILY_REG_CAP?: string;

  // Worker Secrets
  X_CLIENT_SECRET?: string;
  ESCROW_PRIVATE_KEY?: string;
  SESSION_SECRET?: string;
  INTERNAL_SERVICE_KEY?: string;
  /** Base URL of the Go settlement service, e.g. https://go.internal.example */
  SETTLEMENT_SERVICE_URL?: string;
  /** Server-side pepper for one-time passkey recovery-code hashes. */
  RECOVERY_PEPPER?: string;
  /** 1Click partner API key for quote/generate/submit and auth. */
  ONE_CLICK_API_KEY?: string;
  /** Legacy 1Click partner JWT; used only when ONE_CLICK_API_KEY is absent. */
  ONE_CLICK_JWT?: string;
  /**
   * Enables the Confidential Intents balance rail. Defaults off so a deploy
   * cannot silently switch production money movement without approval.
   */
  CONFIDENTIAL_RAIL_ENABLED?: string;
  /**
   * Re-enables creator-fee balance-delta routing. Defaults off because escrow
   * also holds user funds; routing is disabled until attribution is tx-verified.
   */
  CREATOR_FEES_ENABLED?: string;
}

/**
 * Unauthenticated payment preview.
 *
 * Deliberately excludes the recipient handle, the amount, the sender and any
 * fee/invite data: a payment id is printed into share links, so anyone holding
 * the link must not learn who it is for or how much it carries.
 */
export interface PublicPaymentPreview {
  id: string;
  asset: string;
  status: PaymentStatus;
  created_at: number;
  expires_at: number;
}

export interface Payment {
  id: string;
  sender_x_id?: string | null;
  sender_x_handle?: string | null;
  recipient_handle: string;
  /** Immutable recipient identity when known at send time (preferred claim key). */
  recipient_x_id?: string | null;
  asset: string;
  amount: string;
  fee?: string | null;
  fee_recipient?: string | null;
  /**
   * Outcome of routing `fee` to `fee_recipient`:
   *   'sent'     — moved to the destination
   *   'retained' — left in the escrow holding account (the default destination,
   *                so the fee is already where it needs to be; no transfer)
   *   'skipped'  — held in escrow, not yet due (recipient has not claimed)
   *   'failed'   — attempted and did not arrive; the fee is unaccounted for
   * null when no dispatch has been attempted yet.
   */
  fee_dispatch_status?: string | null;
  fee_dispatch_error?: string | null;
  invite_code?: string | null;
  memo?: string | null;
  status: PaymentStatus;
  /** Human-readable reason a CANCELLED payment stopped before settlement. */
  cancel_reason?: string | null;
  /** Stable machine code (USER_CANCELLED, SETTLEMENT_FAILED, ESCROW_LOCK_FAILED). */
  cancel_code?: string | null;
  deposit_address?: string | null;
  intent_hash?: string | null;
  claim_tx_hash?: string | null;
  refund_tx_hash?: string | null;
  /** 'public' | 'confidential' — provenance of the settlement leg. */
  privacy_rail?: string | null;
  settlement_status?: string | null;
  claim_deposit_address?: string | null;
  confirmed_at?: number | null;
  created_at: number;
  expires_at: number;
  updated_at: number;
}

export interface XIdentity {
  x_id: string;
  x_handle: string;
  x_name: string;
  near_account?: string | null;
  is_activated?: boolean;
  personal_invite_code?: string | null;
  invited_by_code?: string | null;
  invited_by_handle?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Passkey {
  id: string;
  x_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports?: string | null;
  created_at: number;
}

export interface Session {
  session_id: string;
  x_id: string;
  x_handle: string;
  x_name: string;
  near_account?: string | null;
  is_activated?: boolean;
  personal_invite_code?: string | null;
  /** True only after this session has proven possession of a passkey. */
  passkey_verified?: boolean;
  /** When the passkey proof happened. Used to invalidate stale sessions after recovery. */
  passkey_verified_at?: number;
  /** Short-lived grant to replace a lost passkey after consuming a recovery code. */
  recovery_authorized?: boolean;
  recovery_authorized_at?: number;
  created_at: number;
  expires_at: number;
}

/**
 * Resolved agent credential for a single request. Set by the agentAuth()
 * middleware; carries the full spend policy so routes can enforce/record it.
 */
export interface AgentPrincipal {
  key_id: string;
  agent_id: string;
  x_id: string;
  label?: string | null;
  per_tx_limit_usd: number | null;
  daily_limit_usd: number | null;
}

export interface Invite {
  code: string;
  creator_x_id?: string | null;
  creator_x_handle?: string | null;
  claimed_by_x_id?: string | null;
  claimed_by_x_handle?: string | null;
  payment_id?: string | null;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  created_at: number;
  claimed_at?: number | null;
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

export interface RedeemInviteRequest {
  code: string;
}

export interface RedeemInviteResponse {
  success: boolean;
  message: string;
  personalInviteCode: string;
  isActivated: boolean;
}

// Request and Response Types

export interface ErrorResponse {
  error: string;
  code: string;
}

export interface ResolveRequest {
  handle: string;
}

export interface ResolveResponse {
  handle: string;
  resolved: boolean;
  message?: string;
}

export interface QuoteRequest {
  recipientHandle: string;
  asset: string;
  amount: string;
}

export interface QuoteResponse {
  quoteId: string;
  recipientHandle: string;
  asset: string;
  amount: string;
  /** amount − protocolFee: what the recipient actually receives. */
  recipientAmount?: string;
  confidentiality: 'advanced';
  depositAddress: string;
  quoteSignature: string;
  estimatedFees: string;
  protocolFee?: string;
  feeRecipient?: string;
  /**
   * Settlement rail the worker will use for this asset: 'intents' when the
   * token contract has registered storage on intents.near, 'native' for
   * NEAR-only assets (launchpad memes) settled with plain NEP-141 transfers.
   * Absent when the probe could not answer (RPC outage) — send-time rail
   * selection then falls back to the empirical try-and-fail path.
   */
  rail?: 'intents' | 'native';
  expiresAt: number;
}

export interface SendRequest {
  recipientHandle: string;
  asset: string;
  amount: string;
  quoteSignature: string;
  depositAddress: string;
  memo?: string;
}

export interface SendResponse {
  paymentId: string;
  shareLink: string;
  claimLink?: string;
  xShareUrl?: string;
  tweetIntentUrl?: string;
  status: PaymentStatus;
  depositAddress: string;
  expiresAt: number;
  fee?: string;
  /** amount − fee: what the recipient can claim. */
  recipientAmount?: string;
  feeRecipient?: string;
  inviteCode?: string;
  isDirect?: boolean;
}

export interface ClaimPendingResponse {
  payments: Payment[];
}

/**
 * POST /api/claim/register body.
 *
 * Deliberately does NOT accept a client-supplied `challenge`: the challenge is
 * issued by GET /api/claim/register-options, stored server-side with a TTL and
 * consumed single-use. Accepting a caller-chosen challenge would let anyone
 * forge an attestation for their own challenge.
 */
export interface RegisterPasskeyRequest {
  attestation: any;
}

export interface RegisterPasskeyResponse {
  success: boolean;
  nearAccount: string;
  credentialId: string;
}

export interface ClaimExecuteRequest {
  paymentIds: string[];
}

export interface ClaimExecuteResult {
  paymentId: string;
  status: PaymentStatus;
  txHash?: string;
  error?: string;
}

export interface ClaimExecuteResponse {
  results: ClaimExecuteResult[];
}

export interface BalanceItem {
  asset: string;
  amount: string;
  symbol?: string;
}

export interface BalanceResponse {
  account: string;
  balances: BalanceItem[];
}

// Hono context variables
export interface Variables {
  session?: Session;
  user?: XIdentity;
  agent?: AgentPrincipal;
}

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

// ─── Contacts & People You Pay ────────────────────────────────────────────────
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
  // Computed / joined fields
  last_transfer_at?: number | null;
  transfer_count?: number;
  is_registered?: boolean;
}

// ─── UPRAIL Payment Requests ─────────────────────────────────────────────────
export type PaymentRequestStatus = 'PENDING' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface PaymentRequest {
  id: string;
  requester_x_id: string;
  requester_handle: string;
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
}

