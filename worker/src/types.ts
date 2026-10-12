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
  CANCELLED = 'CANCELLED',
}

export interface Env {
  // Bindings
  DB: D1Database;
  CACHE: KVNamespace;
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

  // Master Wallet & Custody
  MASTER_ACCOUNT_ID?: string;
  MASTER_PRIVATE_KEY?: string;

  // Protocol fees (FEE_PERCENT, currently 5%, to fees.uprail.near)
  FEE_ACCOUNT_ID?: string;
  FEE_PERCENT?: string;

  // Worker Secrets
  X_CLIENT_SECRET?: string;
  ESCROW_PRIVATE_KEY?: string;
  SESSION_SECRET?: string;
  INTERNAL_SERVICE_KEY?: string;
  DATABASE_URL?: string;
  /** Base URL of the Go settlement service, e.g. https://go.internal.example */
  SETTLEMENT_SERVICE_URL?: string;
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
  invite_code?: string | null;
  memo?: string | null;
  status: PaymentStatus;
  deposit_address?: string | null;
  intent_hash?: string | null;
  claim_tx_hash?: string | null;
  refund_tx_hash?: string | null;
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
  created_at: number;
  expires_at: number;
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
  confidentiality: 'advanced';
  depositAddress: string;
  quoteSignature: string;
  estimatedFees: string;
  protocolFee?: string;
  feeRecipient?: string;
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
  status: PaymentStatus;
  depositAddress: string;
  expiresAt: number;
  fee?: string;
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
}

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};
