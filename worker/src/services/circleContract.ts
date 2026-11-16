/**
 * Client & canonical payload serializer for `circle.uprail.near`
 * (`contracts/circle-escrow/`).
 *
 * All canonical signing strings MUST match `contracts/circle-escrow/src/crypto.rs`
 * byte-for-byte. The Worker only relays transactions and signs scoped handle
 * attestations (using `ATTESTOR_PRIVATE_KEY`, never `ESCROW_PRIVATE_KEY`).
 * Self-custody users sign every contract authorization locally with their WebAuthn
 * P-256 passkey (`AuthProof::WebAuthn`); server-custody users opt into `circle.uprail.near`
 * using their server-derived Ed25519 key (`AuthProof::Ed25519`).
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import type { Env } from '../types';
import { base58Decode, base58Encode } from '../utils/base58';
import * as nearRpc from './nearRpc';
import type { SignedWebAuthnPayload } from './selfCustodyCrypto';

export const CIRCLE_CONTRACT_DOMAIN = 'uprail:circle-escrow:v1';

export type ContractAssetSpec =
  | { rail: 'intents'; token_id: string }
  | { rail: 'nep141'; contract_id: string };

export interface ContractWebAuthnProof {
  kind: 'webauthn';
  pubkey: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}

export interface ContractEd25519Proof {
  kind: 'ed25519';
  pubkey: string;
  signature: string;
}

export type ContractAuthProof = ContractWebAuthnProof | ContractEd25519Proof;

export interface ContractCircleMemberInput {
  account_id: string;
  pubkey: string;
  share_bps: number;
}

export interface ContractCircleMemberView {
  account_id: string;
  pubkey: string;
  share_bps: number;
  agreed: boolean;
  contributed: string;
  refunded_amount: string;
  dissolve_signed: boolean;
  refund_pending: boolean;
}

export interface ContractCircleView {
  id: string;
  asset: ContractAssetSpec;
  creator_index: number;
  creator_account_id: string;
  payout_account_id: string;
  payout_handle_hash: string;
  target_amount: string;
  total_contributed: string;
  status:
    | 'PENDING_SIGNATURES'
    | 'ACTIVE'
    | 'SETTLING'
    | 'SETTLED'
    | 'DISSOLVING'
    | 'DISSOLVED';
  members: ContractCircleMemberView[];
  created_at_ms: number;
  activated_at_ms?: number | null;
  settled_at_ms?: number | null;
  dissolve_started_at_ms?: number | null;
  dissolve_safeguard_at_ms?: number | null;
  dissolved_at_ms?: number | null;
  payout_paid: boolean;
  fee_paid: boolean;
}

export interface ContractGiftView {
  id: string;
  sender_account_id: string;
  sender_pubkey: string;
  recipient_handle_hash: string;
  recipient_pubkey?: string | null;
  asset: ContractAssetSpec;
  amount: string;
  unlock_at_ms: number;
  reclaim_after_ms: number;
  status: 'LOCKED' | 'CLAIMING' | 'CLAIMED' | 'RECLAIMING' | 'RECLAIMED';
  created_at_ms: number;
  settled_at_ms?: number | null;
}

export interface ContractUnclaimedSendView {
  id: string;
  sender_account_id: string;
  sender_pubkey: string;
  recipient_handle_hash: string;
  asset: ContractAssetSpec;
  amount: string;
  created_at_ms: number;
  refund_after_ms: number;
  allow_early_cancel: boolean;
  status: 'PENDING' | 'CLAIMING' | 'CLAIMED' | 'REFUNDING' | 'REFUNDED';
  settled_at_ms?: number | null;
}

export interface ContractConfigView {
  intents_contract: string;
  fee_collector: string;
  attestor_pubkey: string;
  allowed_origins: string[];
  dissolve_safeguard_ms: number;
}

export function getCircleContractId(env: Env): string | null {
  const raw = (env.CIRCLE_CONTRACT_ID || '').trim().toLowerCase();
  return raw || null;
}

export function isCircleContractEnabled(env: Env): boolean {
  return Boolean(getCircleContractId(env));
}

export function normalizeHandleForHash(handle: string): string {
  return (handle || '').trim().replace(/^@+/, '').toLowerCase();
}

export async function sha256HexUtf8(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashHandleHex(handle: string): Promise<string> {
  return sha256HexUtf8(normalizeHandleForHash(handle));
}

export function encodeAssetSpecCanonicalId(asset: ContractAssetSpec): string {
  return asset.rail === 'intents'
    ? `intents:${asset.token_id}`
    : `nep141:${asset.contract_id}`;
}

export function toIntentsContractAssetSpec(assetId: string): ContractAssetSpec {
  return { rail: 'intents', token_id: assetId };
}

export function canonicalCircleAgreePayload(params: {
  contractId: string;
  circleId: string;
  creatorAccountId: string;
  payoutAccountId: string;
  asset: ContractAssetSpec;
  targetAmountAtomic: string | bigint;
  members: ContractCircleMemberInput[];
}): string {
  const membersEncoded = params.members
    .map((m) => `${m.account_id}:${m.pubkey}:${m.share_bps}`)
    .join(',');
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'circle_agree',
    params.contractId,
    params.circleId,
    params.creatorAccountId,
    params.payoutAccountId,
    encodeAssetSpecCanonicalId(params.asset),
    String(params.targetAmountAtomic),
    membersEncoded,
  ].join('|');
}

export function canonicalCircleSettlePayload(params: {
  contractId: string;
  circleId: string;
  payoutAccountId: string;
  totalContributedAtomic: string | bigint;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'circle_settle',
    params.contractId,
    params.circleId,
    params.payoutAccountId,
    String(params.totalContributedAtomic),
  ].join('|');
}

export function canonicalCircleDissolvePayload(params: {
  contractId: string;
  circleId: string;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'circle_dissolve',
    params.contractId,
    params.circleId,
  ].join('|');
}

export function canonicalGiftClaimPayload(params: {
  contractId: string;
  giftId: string;
  recipientHandleHash: string;
  recipientAccountId: string;
  deadlineMs: number;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'gift_claim',
    params.contractId,
    params.giftId,
    params.recipientHandleHash,
    params.recipientAccountId,
    String(params.deadlineMs),
  ].join('|');
}

export function canonicalGiftRecipientPayload(params: {
  contractId: string;
  giftId: string;
  recipientAccountId: string;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'gift_recipient',
    params.contractId,
    params.giftId,
    params.recipientAccountId,
  ].join('|');
}

export function canonicalGiftReclaimPayload(params: {
  contractId: string;
  giftId: string;
  senderAccountId: string;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'gift_reclaim',
    params.contractId,
    params.giftId,
    params.senderAccountId,
  ].join('|');
}

export function canonicalUnclaimedClaimPayload(params: {
  contractId: string;
  sendId: string;
  recipientHandleHash: string;
  recipientAccountId: string;
  deadlineMs: number;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'unclaimed_claim',
    params.contractId,
    params.sendId,
    params.recipientHandleHash,
    params.recipientAccountId,
    String(params.deadlineMs),
  ].join('|');
}

export function canonicalUnclaimedRefundPayload(params: {
  contractId: string;
  sendId: string;
  senderAccountId: string;
}): string {
  return [
    CIRCLE_CONTRACT_DOMAIN,
    'unclaimed_refund',
    params.contractId,
    params.sendId,
    params.senderAccountId,
  ].join('|');
}

export function webAuthnToContractProof(signed: SignedWebAuthnPayload): ContractWebAuthnProof {
  return {
    kind: 'webauthn',
    pubkey: signed.public_key,
    authenticator_data: signed.authenticator_data,
    client_data_json: signed.client_data_json,
    signature: signed.signature,
  };
}

function parseEd25519Seed(rawKey: string): Uint8Array {
  const clean = rawKey.trim().replace(/^ed25519:/i, '');
  const decoded = base58Decode(clean);
  if (decoded.length !== 32 && decoded.length !== 64) {
    throw new Error(`Invalid Ed25519 private key length: ${decoded.length}`);
  }
  return decoded.slice(0, 32);
}

export function getAttestorPublicKey(env: Env): string | null {
  const raw = (env.ATTESTOR_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  const seed = parseEd25519Seed(raw);
  return `ed25519:${base58Encode(ed25519.getPublicKey(seed))}`;
}

/**
 * Signs a handle attestation payload using the strictly scoped `ATTESTOR_PRIVATE_KEY`
 * (never falls back to `ESCROW_PRIVATE_KEY`).
 */
export function signHandleAttestation(env: Env, payloadStr: string): string {
  const raw = (env.ATTESTOR_PRIVATE_KEY || '').trim();
  if (!raw) {
    throw new Error('ATTESTOR_PRIVATE_KEY is not configured for handle claim attestations');
  }
  const seed = parseEd25519Seed(raw);
  const sig = ed25519.sign(new TextEncoder().encode(payloadStr), seed);
  return `ed25519:${base58Encode(sig)}`;
}

/**
 * Signs a canonical contract payload for a `'server'`-custody user only.
 * Throws `SelfCustodySignatureRequiredError` if called for a `'self'` user.
 */
export async function signContractPayloadWithServerUserKey(
  env: Env,
  xId: string,
  payloadStr: string
): Promise<ContractEd25519Proof> {
  await nearRpc.assertServerCustodyForXId(env, xId);
  const kp = await nearRpc.deriveUserNearKeypair(env, xId);
  const sig = ed25519.sign(new TextEncoder().encode(payloadStr), kp.privateKey.slice(0, 32));
  return {
    kind: 'ed25519',
    pubkey: kp.publicKeyB58,
    signature: `ed25519:${base58Encode(sig)}`,
  };
}

export function buildContributeCircleMsg(circleId: string): string {
  return JSON.stringify({
    action: 'contribute_circle',
    circle_id: circleId,
  });
}

export function buildCreateAndFundGiftMsg(params: {
  giftId: string;
  senderPubkey: string;
  recipientHandleHash: string;
  recipientPubkey?: string | null;
  unlockAtMs: number;
  reclaimAfterMs: number;
}): string {
  return JSON.stringify({
    action: 'create_and_fund_gift',
    gift_id: params.giftId,
    sender_pubkey: params.senderPubkey,
    recipient_handle_hash: params.recipientHandleHash,
    recipient_pubkey: params.recipientPubkey ?? null,
    unlock_at_ms: params.unlockAtMs,
    reclaim_after_ms: params.reclaimAfterMs,
  });
}

export function buildCreateUnclaimedSendMsg(params: {
  sendId: string;
  senderPubkey: string;
  recipientHandleHash: string;
  refundAfterMs: number;
  allowEarlyCancel: boolean;
}): string {
  return JSON.stringify({
    action: 'create_unclaimed_send',
    send_id: params.sendId,
    sender_pubkey: params.senderPubkey,
    recipient_handle_hash: params.recipientHandleHash,
    refund_after_ms: params.refundAfterMs,
    allow_early_cancel: params.allowEarlyCancel,
  });
}

function requireContractId(env: Env): string {
  const id = getCircleContractId(env);
  if (!id) {
    throw new Error('CIRCLE_CONTRACT_ID is not configured');
  }
  return id;
}

export async function getCircleContractConfig(
  env: Env,
  contractIdOverride?: string
): Promise<ContractConfigView | null> {
  const contractId = (contractIdOverride || getCircleContractId(env) || '').trim().toLowerCase();
  if (!contractId) return null;
  const res = await nearRpc.viewContractMethod(env, contractId, 'get_config', {});
  return (res as ContractConfigView | null) ?? null;
}

export async function getCircleOnchain(
  env: Env,
  circleId: string,
  contractIdOverride?: string
): Promise<ContractCircleView | null> {
  const contractId = (contractIdOverride || getCircleContractId(env) || '').trim().toLowerCase();
  if (!contractId) return null;
  const res = await nearRpc.viewContractMethod(env, contractId, 'get_circle', {
    circle_id: circleId,
  });
  return (res as ContractCircleView | null) ?? null;
}

export async function getGiftOnchain(
  env: Env,
  giftId: string,
  contractIdOverride?: string
): Promise<ContractGiftView | null> {
  const contractId = (contractIdOverride || getCircleContractId(env) || '').trim().toLowerCase();
  if (!contractId) return null;
  const res = await nearRpc.viewContractMethod(env, contractId, 'get_gift', {
    gift_id: giftId,
  });
  return (res as ContractGiftView | null) ?? null;
}

export async function getUnclaimedSendOnchain(
  env: Env,
  sendId: string,
  contractIdOverride?: string
): Promise<ContractUnclaimedSendView | null> {
  const contractId = (contractIdOverride || getCircleContractId(env) || '').trim().toLowerCase();
  if (!contractId) return null;
  const res = await nearRpc.viewContractMethod(env, contractId, 'get_unclaimed_send', {
    send_id: sendId,
  });
  return (res as ContractUnclaimedSendView | null) ?? null;
}

export async function createCircleOnchain(
  env: Env,
  args: {
    circle_id: string;
    asset: ContractAssetSpec;
    members: ContractCircleMemberInput[];
    creator_index: number;
    payout_account_id: string;
    payout_handle_hash: string;
    target_amount: string;
    creator_proof?: ContractAuthProof | null;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'create_circle',
    {
      ...args,
      creator_proof: args.creator_proof ?? null,
    },
    35_000_000_000_000n
  );
}

export async function signCircleTermsOnchain(
  env: Env,
  args: {
    circle_id: string;
    member_index: number;
    proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'sign_circle_terms',
    args,
    30_000_000_000_000n
  );
}

export async function settleCircleOnchain(
  env: Env,
  args: {
    circle_id: string;
    creator_proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'settle_circle',
    args,
    90_000_000_000_000n
  );
}

export async function retryCircleSettlementOnchain(
  env: Env,
  circleId: string,
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'retry_circle_settlement',
    { circle_id: circleId },
    75_000_000_000_000n
  );
}

export async function initiateDissolveOnchain(
  env: Env,
  args: {
    circle_id: string;
    member_index: number;
    proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'initiate_dissolve',
    args,
    30_000_000_000_000n
  );
}

export async function signDissolveOnchain(
  env: Env,
  args: {
    circle_id: string;
    member_index: number;
    proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'sign_dissolve',
    args,
    30_000_000_000_000n
  );
}

export async function finalizeDissolveOnchain(
  env: Env,
  args: {
    circle_id: string;
    sigs?: Array<{ member_index: number; proof: ContractAuthProof }> | null;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'finalize_dissolve',
    {
      circle_id: args.circle_id,
      sigs: args.sigs ?? null,
    },
    180_000_000_000_000n
  );
}

export async function claimGiftOnchain(
  env: Env,
  args: {
    gift_id: string;
    recipient_account_id: string;
    attestor_deadline_ms: number;
    attestor_sig: string;
    recipient_proof?: ContractAuthProof | null;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'claim_gift',
    {
      ...args,
      recipient_proof: args.recipient_proof ?? null,
    },
    65_000_000_000_000n
  );
}

export async function reclaimGiftOnchain(
  env: Env,
  args: {
    gift_id: string;
    sender_proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'reclaim_gift',
    args,
    60_000_000_000_000n
  );
}

export async function claimUnclaimedSendOnchain(
  env: Env,
  args: {
    send_id: string;
    recipient_account_id: string;
    attestor_deadline_ms: number;
    attestor_sig: string;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'claim_unclaimed_send',
    args,
    60_000_000_000_000n
  );
}

export async function refundUnclaimedSendOnchain(
  env: Env,
  args: {
    send_id: string;
    sender_proof: ContractAuthProof;
  },
  contractIdOverride?: string
) {
  const contractId = (contractIdOverride || requireContractId(env)).toLowerCase();
  return nearRpc.executeEscrowContractCall(
    env,
    contractId,
    'refund_unclaimed_send',
    args,
    60_000_000_000_000n
  );
}
