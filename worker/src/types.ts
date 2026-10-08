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
  ESCROW: DurableObjectNamespace;
  NEAR_CONTAINER: DurableObjectNamespace;

  // Environment variables
  X_CLIENT_ID: string;
  NEAR_API_BASE: string;
  SOLVER_RELAY_URL: string;
  ESCROW_ACCOUNT_ID: string;
  PAYMENT_EXPIRY_DAYS: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
  WEBAUTHN_ORIGIN: string;

  // Worker Secrets
  X_CLIENT_SECRET?: string;
  ESCROW_PRIVATE_KEY?: string;
  SESSION_SECRET?: string;
  INTERNAL_SERVICE_KEY?: string;
}

export interface PublicPaymentPreview {
  id: string;
  recipient_handle: string;
  asset: string;
  amount: string;
  status: PaymentStatus;
  created_at: number;
  expires_at: number;
}

export interface Payment {
  id: string;
  sender_x_id?: string | null;
  sender_x_handle?: string | null;
  recipient_handle: string;
  asset: string;
  amount: string;
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
  created_at: number;
  expires_at: number;
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
  expiresAt: number;
}

export interface SendRequest {
  recipientHandle: string;
  asset: string;
  amount: string;
  quoteSignature: string;
  depositAddress: string;
}

export interface SendResponse {
  paymentId: string;
  shareLink: string;
  status: PaymentStatus;
  depositAddress: string;
  expiresAt: number;
}

export interface ClaimPendingResponse {
  payments: Payment[];
}

export interface RegisterPasskeyRequest {
  attestation: any;
  challenge: string;
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
