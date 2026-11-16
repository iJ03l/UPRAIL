/**
 * Self-custody orchestration service:
 *  - Single-use prepared WebAuthn intent challenges (`pending_custody_actions`)
 *  - Preflight & plain L1 balance sweep before locking keys
 *  - Atomic Passkey Self-Custody upgrade (`[PayloadA(server), PayloadB(passkey)]`)
 *  - Multi-device passkey on-chain authorization (`add_public_key`)
 *  - Backup ed25519 Recovery Key recovery flow (zero server knowledge of seed)
 *  - On-chain proof queries for `/verify`
 */

import type { Env } from '../types';
import * as nearRpc from './nearRpc';
import * as webauthnService from './webauthn';
import { allowedWebAuthnOrigins, allowedWebAuthnRpIds, resolveRpId } from './webauthnConfig';
import {
  clearUserSession,
  completeWebAuthnOneClickSession,
  buildEmptyWebAuthnAuthPayload,
  getCurrentIntentsSalt,
  getUserSession,
  hasCachedOneClickSession,
} from './oneclickAuth';
import {
  assembleSignedWebAuthnPayload,
  buildIntentsPayloadString,
  bytesToBase64,
  bytesToBase64UrlUnpadded,
  computeIntentsWebAuthnChallenge,
  cosePublicKeyToNearP256,
  parseNearPublicKey,
  verifySignedNep413Ed25519Payload,
  type IntentsAction,
  type SignedNep413Payload,
  type SignedWebAuthnPayload,
} from './selfCustodyCrypto';
import { encodeVersionedNonce, saltFromHex } from './intentsNonce';
import { getRecoveryStatus } from './recoveryCodes';

const ACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes per single-use prepared action

export class CustodyActionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(
    message: string,
    status = 400,
    code = 'CUSTODY_ACTION_ERROR',
    extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CustodyActionError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface PendingCustodyActionRow {
  id: string;
  x_id: string;
  action_type: string;
  challenge_digest: string;
  payload_json: string;
  meta_json: string | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface StoredPasskeyRow {
  id: string;
  x_id: string;
  credential_id: string;
  public_key: string;
  near_p256_pubkey: string | null;
  onchain_added_at: number | null;
  counter: number;
  transports: string | null;
  created_at: number;
}

export async function listAndBackfillUserPasskeys(
  env: Env,
  xId: string
): Promise<StoredPasskeyRow[]> {
  if (!env.DB) return [];
  const rows = (
    await env.DB.prepare(
      'SELECT id, x_id, credential_id, public_key, near_p256_pubkey, onchain_added_at, counter, transports, created_at FROM passkeys WHERE x_id = ? ORDER BY created_at DESC'
    )
      .bind(xId)
      .all<StoredPasskeyRow>()
  ).results;

  for (const row of rows) {
    if (!row.near_p256_pubkey && row.public_key) {
      try {
        const computed = cosePublicKeyToNearP256(row.public_key);
        row.near_p256_pubkey = computed;
        await env.DB.prepare('UPDATE passkeys SET near_p256_pubkey = ? WHERE id = ?')
          .bind(computed, row.id)
          .run()
          .catch(() => {});
      } catch {
        // Non-P256 key (e.g. legacy non-ES256); remain null and excluded from intents P-256 auth.
      }
    }
  }
  return rows;
}

/**
 * Creates a single-use prepared WebAuthn signing challenge whose WebAuthn
 * challenge equals base64url(sha256(payloadStr)), so the browser prompt serves
 * simultaneously as UPRAIL WebAuthn auth and an on-chain/1Click WebAuthn intent.
 */
export async function createPendingCustodyAction<TMeta extends Record<string, unknown>>(params: {
  env: Env;
  xId: string;
  actionType: string;
  payloadStr: string;
  meta?: TMeta;
  requireOnchainPasskey?: boolean;
  requiredPubkey?: string;
  ttlMs?: number;
}): Promise<{
  actionId: string;
  challenge: string;
  payloadStr: string;
  options: Awaited<ReturnType<typeof webauthnService.generateAuthenticationOptions>>;
  expiresAt: number;
}> {
  const { env, xId, actionType, payloadStr } = params;
  if (!env.DB) {
    throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }

  const passkeys = await listAndBackfillUserPasskeys(env, xId);
  const eligible = passkeys.filter((pk) => {
    if (!pk.near_p256_pubkey) return false;
    if (params.requireOnchainPasskey && (pk.onchain_added_at === null || pk.onchain_added_at === undefined)) {
      return false;
    }
    if (params.requiredPubkey && pk.near_p256_pubkey !== params.requiredPubkey) {
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    throw new CustodyActionError(
      params.requiredPubkey
        ? 'The specific passkey registered on this on-chain commitment was not found on your account.'
        : params.requireOnchainPasskey
        ? 'No on-chain authorized P-256 passkey found for this self-custody account.'
        : 'No P-256 passkey found for this account.',
      400,
      'NO_ELIGIBLE_PASSKEY'
    );
  }

  const challenge = await computeIntentsWebAuthnChallenge(payloadStr);
  const options = await webauthnService.generateAuthenticationOptions({
    credentialIds: eligible.map((pk) => pk.credential_id),
    rpId: resolveRpId(env),
  });
  // Bind the WebAuthn challenge directly to SHA-256(payloadStr).
  options.challenge = challenge;

  const now = Date.now();
  const expiresAt = now + (params.ttlMs ?? ACTION_TTL_MS);
  const actionId = `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  await env.DB.prepare(
    `INSERT INTO pending_custody_actions (
      id, x_id, action_type, challenge_digest, payload_json, meta_json, expires_at, used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  )
    .bind(
      actionId,
      xId,
      actionType,
      challenge,
      payloadStr,
      params.meta ? JSON.stringify(params.meta) : null,
      expiresAt,
      now
    )
    .run();

  return {
    actionId,
    challenge,
    payloadStr,
    options,
    expiresAt,
  };
}

/**
 * Verifies a client WebAuthn assertion against a single-use prepared custody action,
 * normalizes the P-256 signature to low-S, ensures unpadded base64url authenticator_data,
 * atomically consumes the prepared row, and returns the ready-to-relay SignedWebAuthnPayload.
 */
export async function consumeAndVerifyWebAuthnPendingAction<TMeta = Record<string, unknown>>(params: {
  env: Env;
  xId: string;
  actionId: string;
  assertion: any;
  expectedActionType?: string;
  requireOnchainPasskey?: boolean;
  requiredPubkey?: string;
}): Promise<{
  action: PendingCustodyActionRow;
  signedWebAuthn: SignedWebAuthnPayload;
  meta: TMeta;
  passkey: StoredPasskeyRow;
}> {
  const { env, xId, actionId, assertion } = params;
  if (!env.DB) {
    throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }
  if (!actionId || !assertion?.id || !assertion?.response) {
    throw new CustodyActionError('Missing actionId or WebAuthn passkey assertion', 400, 'INVALID_REQUEST');
  }

  const action = await env.DB.prepare(
    'SELECT * FROM pending_custody_actions WHERE id = ? AND x_id = ? LIMIT 1'
  )
    .bind(actionId, xId)
    .first<PendingCustodyActionRow>();

  if (!action) {
    throw new CustodyActionError('Prepared custody action not found', 404, 'ACTION_NOT_FOUND');
  }
  if (params.expectedActionType && action.action_type !== params.expectedActionType) {
    throw new CustodyActionError(
      `Action type mismatch (expected ${params.expectedActionType})`,
      400,
      'ACTION_TYPE_MISMATCH'
    );
  }
  if (action.used_at !== null && action.used_at !== undefined) {
    throw new CustodyActionError('This approval challenge has already been used', 409, 'ACTION_ALREADY_USED');
  }
  if (action.expires_at <= Date.now()) {
    throw new CustodyActionError('Approval challenge expired; please try again', 410, 'ACTION_EXPIRED');
  }

  const passkeys = await listAndBackfillUserPasskeys(env, xId);
  const passkey = passkeys.find((p) => p.credential_id === assertion.id);
  if (!passkey) {
    throw new CustodyActionError('Passkey credential does not belong to this user', 403, 'PASSKEY_NOT_FOUND');
  }
  if (!passkey.near_p256_pubkey) {
    throw new CustodyActionError(
      'This passkey is not an ES256 P-256 credential compatible with NEAR Intents',
      400,
      'UNSUPPORTED_PASSKEY_CURVE'
    );
  }
  if (params.requireOnchainPasskey && (passkey.onchain_added_at === null || passkey.onchain_added_at === undefined)) {
    throw new CustodyActionError(
      'This device passkey has not been authorized on-chain yet. Confirm with an already-authorized passkey first.',
      403,
      'PASSKEY_NOT_AUTHORIZED_ONCHAIN'
    );
  }
  if (params.requiredPubkey && passkey.near_p256_pubkey !== params.requiredPubkey) {
    throw new CustodyActionError(
      'Please sign with the exact passkey registered on this on-chain commitment.',
      403,
      'PASSKEY_KEY_MISMATCH'
    );
  }

  const verification = await webauthnService.verifyAuthentication({
    assertion,
    expectedChallenge: action.challenge_digest,
    expectedOrigin: allowedWebAuthnOrigins(env),
    expectedRPID: allowedWebAuthnRpIds(env),
    credential: {
      id: assertion.id,
      publicKey: passkey.public_key,
      counter: Number(passkey.counter) || 0,
    },
  });

  if (!verification.verified) {
    throw new CustodyActionError('Passkey signature verification failed', 401, 'WEBAUTHN_VERIFICATION_FAILED');
  }

  const signedWebAuthn = await assembleSignedWebAuthnPayload({
    payloadStr: action.payload_json,
    publicKeyNear: passkey.near_p256_pubkey,
    signatureDerOrRaw: assertion.response.signature,
    clientDataJson: assertion.response.clientDataJSON,
    authenticatorData: assertion.response.authenticatorData,
    verifySignature: true,
  });

  const now = Date.now();
  const consumeRes = await env.DB.prepare(
    'UPDATE pending_custody_actions SET used_at = ? WHERE id = ? AND used_at IS NULL'
  )
    .bind(now, action.id)
    .run();
  if ((consumeRes.meta?.changes ?? 0) !== 1) {
    throw new CustodyActionError('This approval challenge was concurrently consumed', 409, 'ACTION_ALREADY_USED');
  }

  const newCounter = (verification as any).authenticationInfo?.newCounter ?? passkey.counter;
  await env.DB.prepare('UPDATE passkeys SET counter = ? WHERE id = ?')
    .bind(newCounter, passkey.id)
    .run()
    .catch(() => {});

  let meta = {} as TMeta;
  if (action.meta_json) {
    try {
      meta = JSON.parse(action.meta_json) as TMeta;
    } catch {
      meta = {} as TMeta;
    }
  }

  return { action, signedWebAuthn, meta, passkey };
}

/**
 * Inspects readiness before opting into Passkey Self-Custody: checks active passkeys,
 * plain L1 balances needing sweep into intents.near, in-flight withdrawals/payments,
 * and current intents.near key status.
 */
export async function getCustodyPreflight(env: Env, xId: string, xHandle: string) {
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  const nearAccount = await nearRpc.resolveUserNearAccount(env, {
    x_id: xId,
    x_handle: xHandle,
    near_account: custody.nearAccount,
    custody_mode: custody.custodyMode,
  });

  const passkeys = await listAndBackfillUserPasskeys(env, xId);
  const eligiblePasskeys = passkeys
    .filter((p) => Boolean(p.near_p256_pubkey))
    .map((p) => ({
      id: p.id,
      credentialId: p.credential_id,
      nearP256Pubkey: p.near_p256_pubkey!,
      onchainAddedAt: p.onchain_added_at,
      createdAt: p.created_at,
    }));

  const [authState, plainBalances, recoveryStatus, oneClickSessionActive] = await Promise.all([
    nearRpc.getAccountIntentsAuthState(env, nearAccount),
    nearRpc.getPlainBalances(env, nearAccount).catch(() => []),
    getRecoveryStatus(env, xId).catch(() => ({ hasCodes: false, total: 0, remaining: 0 })),
    hasCachedOneClickSession(env, xId).catch(() => false),
  ]);

  let pendingWithdrawals = 0;
  let pendingPayments = 0;
  let activeEscrowCircles = 0;
  let activeEscrowGifts = 0;
  if (env.DB) {
    try {
      const w = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM withdrawals WHERE x_id = ? AND status IN ('PENDING', 'PROCESSING')"
      )
        .bind(xId)
        .first<{ cnt: number }>();
      pendingWithdrawals = Number(w?.cnt || 0);
    } catch {}
    try {
      const p = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM payments WHERE sender_x_id = ? AND status IN ('PENDING')"
      )
        .bind(xId)
        .first<{ cnt: number }>();
      pendingPayments = Number(p?.cnt || 0);
    } catch {}
    try {
      const ci = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.x_id = ? AND c.status = 'ACTIVE' AND c.contract_mode = 'escrow'"
      )
        .bind(xId)
        .first<{ cnt: number }>();
      activeEscrowCircles = Number(ci?.cnt || 0);
    } catch {}
    try {
      const g = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM gifts WHERE (sender_x_id = ? OR recipient_x_id = ?) AND status IN ('PENDING_FUNDING', 'FUNDED') AND contract_mode = 'escrow'"
      )
        .bind(xId, xId)
        .first<{ cnt: number }>();
      activeEscrowGifts = Number(g?.cnt || 0);
    } catch {}
  }

  // Flag plain L1 balances (especially Intents-supported tokens or excess NEAR > 0.03)
  // so users sweep them into intents.near BEFORE removing server access.
  const plainBalancesToSweep = plainBalances
    .map((b) => ({
      asset: b.defuse_asset_id,
      assetId: b.defuse_asset_id,
      symbol: b.symbol,
      amount: b.amount,
      amountFormatted: b.amountFormatted,
      usdValue:
        typeof b.priceUsd === 'number'
          ? Number(b.amountFormatted || '0') * b.priceUsd
          : 0,
      nearContractId: b.nearContractId,
      canSweepToIntents: Boolean(
        b.nearContractId &&
          (b.symbol.toUpperCase() !== 'NEAR' || Number(b.amountFormatted || '0') > 0.03)
      ),
    }))
    .filter((b) => b.canSweepToIntents);

  let resolvedAuthState = authState;
  if (
    custody.custodyMode === 'self' &&
    custody.backupPubkey &&
    plainBalancesToSweep.length === 0
  ) {
    try {
      const derived = await nearRpc.deriveUserNearKeypair(env, xId);
      const serverL1StillPresent = resolvedAuthState.l1AccessKeys.some(
        (k) => k.publicKey === derived.publicKeyB58
      );
      if (serverL1StillPresent) {
        const rot = await nearRpc.rotateSubAccountL1KeyToBackup(
          env,
          nearAccount,
          derived.publicKey,
          derived.privateKey,
          custody.backupPubkey
        );
        if (rot.rotated) {
          resolvedAuthState = await nearRpc.getAccountIntentsAuthState(env, nearAccount);
        }
      }
    } catch (rotErr) {
      console.warn('[custody/preflight] L1 key auto-rotation notice:', rotErr);
    }
  }

  const blockingReasons: string[] = [];
  if (eligiblePasskeys.length === 0) {
    blockingReasons.push('Register a P-256 passkey on this device first.');
  }
  if (pendingWithdrawals > 0) {
    blockingReasons.push(`Wait for ${pendingWithdrawals} in-flight withdrawal(s) to finish before upgrading.`);
  }
  if (pendingPayments > 0) {
    blockingReasons.push(`Wait for ${pendingPayments} pending send(s) to finish before upgrading.`);
  }

  return {
    nearAccount,
    custodyMode: custody.custodyMode,
    backupPubkey: custody.backupPubkey,
    selfCustodyAt: custody.selfCustodyAt,
    selfCustodyVersion: custody.selfCustodyVersion,
    oneClickSessionActive,
    recoveryCodesRemaining: recoveryStatus.remaining,
    eligiblePasskeys,
    authState: resolvedAuthState,
    plainBalancesToSweep,
    activeEscrowCircles,
    activeEscrowGifts,
    blockingReasons,
    readyToUpgrade: custody.custodyMode === 'server' && blockingReasons.length === 0,
  };
}

/**
 * Sweeps plain L1 Intents-supported balances from `u_*.escrow.uprail.near` into
 * the user's own `intents.near` balance prior to locking self-custody.
 * For any NEP-141 token whose contract has not yet registered `intents.near`
 * storage, `escrow.uprail.near` sponsors and pays NEP-145 `storage_deposit`
 * automatically inside `depositPlainBalanceToIntents`.
 */
export async function sweepPlainBalancesBeforeUpgrade(
  env: Env,
  xId: string,
  xHandle: string,
  opts: { nativeL1Grant?: nearRpc.NativeL1KeyGrant } = {}
) {
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  if (custody.custodyMode === 'self' && !opts.nativeL1Grant) {
    throw new CustodyActionError(
      'Sign with your passkey to authorize your NEAR L1 key before sweeping native balances.',
      409,
      'NATIVE_L1_AUTH_REQUIRED'
    );
  }
  const nearAccount = await nearRpc.resolveUserNearAccount(env, {
    x_id: xId,
    x_handle: xHandle,
    near_account: custody.nearAccount,
    custody_mode: custody.custodyMode,
  });

  await (env as any).CACHE?.delete(`plain_bal:${nearAccount}`).catch(() => {});
  const plainBalances = await nearRpc.getPlainBalances(env, nearAccount);
  const swept: Array<{ symbol: string; amount: string; txHash?: string; skipped?: string }> = [];

  for (const b of plainBalances) {
    const sym = (b.symbol || '').toUpperCase();
    let sweepAmount = b.amountFormatted;
    if (sym === 'NEAR') {
      const avail = Number(b.amountFormatted || '0') - 0.025; // keep small L1 gas reserve
      if (!Number.isFinite(avail) || avail <= 0.005) {
        continue;
      }
      sweepAmount = avail.toFixed(6).replace(/\.?0+$/, '');
    }
    const res = await nearRpc.depositPlainBalanceToIntents(
      env,
      xId,
      b.nearContractId || b.defuse_asset_id,
      sweepAmount,
      nearAccount,
      { nativeL1Grant: opts.nativeL1Grant }
    );
    if (res.deposited) {
      swept.push({ symbol: b.symbol, amount: sweepAmount, txHash: res.txHash });
    } else {
      swept.push({ symbol: b.symbol, amount: sweepAmount, skipped: res.reason });
    }
  }
  return { nearAccount, swept };
}

interface UpgradePendingMeta extends Record<string, unknown> {
  nearAccount: string;
  backupPubkey: string;
  passkeyP256Keys: string[];
  serverPubkeyB58: string;
}

/**
 * Step 1 of Self-Custody upgrade: validates backupPubkey + passkeys, ensures account
 * exists, and builds Payload B (remove server key + disable auth_by_predecessor_id)
 * for single-tap WebAuthn signature.
 */
export async function prepareUpgradeToSelfCustody(params: {
  env: Env;
  xId: string;
  xHandle: string;
  backupPubkey: string;
}) {
  const { env, xId, xHandle } = params;
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  if (custody.custodyMode === 'self') {
    throw new CustodyActionError('Account is already in Self-Custody mode', 409, 'ALREADY_SELF_CUSTODY');
  }

  let parsedBackup: ReturnType<typeof parseNearPublicKey>;
  try {
    parsedBackup = parseNearPublicKey(params.backupPubkey);
  } catch {
    throw new CustodyActionError(
      'Invalid backup public key; expected client-derived ed25519:<base58>',
      400,
      'INVALID_BACKUP_PUBKEY'
    );
  }
  if (parsedBackup.kind !== 'ed25519') {
    throw new CustodyActionError(
      'Backup key must be an ed25519:<base58> public key derived from your device Recovery Key',
      400,
      'INVALID_BACKUP_PUBKEY'
    );
  }

  const preflight = await getCustodyPreflight(env, xId, xHandle);
  if (!preflight.readyToUpgrade) {
    throw new CustodyActionError(
      preflight.blockingReasons[0] || 'Account is not ready to upgrade to Self-Custody',
      400,
      'PREFLIGHT_BLOCKED'
    );
  }

  const derived = await nearRpc.deriveUserNearKeypair(env, xId);
  if (parsedBackup.formatted === derived.publicKeyB58) {
    throw new CustodyActionError('Backup key must be distinct from the server key', 400, 'INVALID_BACKUP_PUBKEY');
  }

  const passkeyP256Keys = Array.from(
    new Set(preflight.eligiblePasskeys.map((p) => p.nearP256Pubkey))
  );

  const saltHex = await getCurrentIntentsSalt(env);
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';

  // Payload B (signed by user passkey) runs RIGHT AFTER Payload A (signed by server key)
  // in an atomic execute_intents batch on intents.near:
  //   Payload A adds user's p256 passkey(s) + ed25519 backup key
  //   Payload B removes the server key and disables auth_by_predecessor_id
  const { payloadStr } = buildIntentsPayloadString({
    signerId: preflight.nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: [
      { intent: 'remove_public_key', public_key: derived.publicKeyB58 },
      { intent: 'set_auth_by_predecessor_id', enabled: false },
    ],
    ttlMs: ACTION_TTL_MS,
  });

  const meta: UpgradePendingMeta = {
    nearAccount: preflight.nearAccount,
    backupPubkey: parsedBackup.formatted,
    passkeyP256Keys,
    serverPubkeyB58: derived.publicKeyB58,
  };

  const pending = await createPendingCustodyAction({
    env,
    xId,
    actionType: 'UPGRADE_SELF_CUSTODY',
    payloadStr,
    meta,
    requireOnchainPasskey: false,
  });

  return {
    ...pending,
    summary: {
      nearAccount: preflight.nearAccount,
      addingKeys: [...passkeyP256Keys, parsedBackup.formatted],
      removingKey: derived.publicKeyB58,
      disablingPredecessorAuth: true,
    },
  };
}

/**
 * Step 2 of Self-Custody upgrade: verifies Payload B WebAuthn signature, constructs
 * Payload A with current server key, dry-runs `[PayloadA, PayloadB]` via simulate_intents,
 * relays both atomically via executeIntentsBatchRelayed, verifies final on-chain keys,
 * and flips custody_mode = 'self' in D1.
 */
export async function submitUpgradeToSelfCustody(params: {
  env: Env;
  xId: string;
  xHandle?: string;
  actionId: string;
  assertion: any;
  oneClickAuthAssertion?: any;
  oneClickActionId?: string;
}) {
  const { env, xId, actionId, assertion } = params;
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  if (custody.custodyMode === 'self') {
    throw new CustodyActionError('Account is already in Self-Custody mode', 409, 'ALREADY_SELF_CUSTODY');
  }

  const { signedWebAuthn: payloadB, meta, passkey } =
    await consumeAndVerifyWebAuthnPendingAction<UpgradePendingMeta>({
      env,
      xId,
      actionId,
      assertion,
      expectedActionType: 'UPGRADE_SELF_CUSTODY',
      requireOnchainPasskey: false,
    });

  const derived = await nearRpc.deriveUserNearKeypair(env, xId);
  const subEnsure = await nearRpc.createOnchainSubAccount(
    env,
    meta.nearAccount,
    derived.publicKey,
    derived.privateKey
  );
  if (!subEnsure.success) {
    throw new CustodyActionError(
      subEnsure.error || 'Could not ensure on-chain sub-account before upgrade',
      502,
      'SUBACCOUNT_PROVISION_FAILED'
    );
  }
  const keyReady = await nearRpc.ensureKeyOnIntents(
    env,
    meta.nearAccount,
    derived.publicKey,
    derived.privateKey
  );
  if (!keyReady.registered) {
    throw new CustodyActionError(
      keyReady.reason || 'Current signing key is not registered on intents.near yet',
      502,
      'SERVER_KEY_NOT_REGISTERED'
    );
  }

  // 1. Preserve Confidential Intents balance visibility: warm/retain the 30-day refreshable
  //    1Click User-Session (read/quote only; spending still requires passkey WebAuthn intents)
  //    so the user's Confidential Intents balance never flickers or disappears after upgrading.
  let oneClickSessionActive = await hasCachedOneClickSession(env, xId).catch(() => false);
  if (!oneClickSessionActive) {
    await getUserSession(env, xId)
      .then(() => {
        oneClickSessionActive = true;
      })
      .catch(() => {});
  }

  // 2. Automatically sweep all plain NEAR L1 balances on u_*.escrow.uprail.near into
  //    intents.near as part of migration. For any NEP-141 token whose contract has no
  //    storage registered for intents.near yet, escrow.uprail.near automatically pays
  //    and registers NEP-145 storage_deposit on that token contract before transferring.
  let sweepHadError = false;
  const sweepResult = await sweepPlainBalancesBeforeUpgrade(
    env,
    xId,
    params.xHandle || ''
  ).catch((sweepErr) => {
    sweepHadError = true;
    console.warn('[custody/upgrade] L1 auto-sweep notice:', sweepErr);
    return { nearAccount: meta.nearAccount, swept: [] };
  });

  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const saltHex = await getCurrentIntentsSalt(env);
  const addActions: IntentsAction[] = [
    ...meta.passkeyP256Keys.map((pk) => ({ intent: 'add_public_key' as const, public_key: pk })),
    { intent: 'add_public_key', public_key: meta.backupPubkey },
  ];
  const { payloadStr: payloadAStr, body: payloadABody } = buildIntentsPayloadString({
    signerId: meta.nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: addActions,
    ttlMs: ACTION_TTL_MS,
  });

  // Sign Payload A synchronously on the server using the derived key being removed in Payload B.
  const nonceBytesA = Uint8Array.from(atob(payloadABody.nonce), (c) => c.charCodeAt(0));
  const serializedA = nearRpc.nep413Serialize(payloadAStr, nonceBytesA, intentsId);
  const digestA = await crypto.subtle.digest('SHA-256', new Uint8Array(serializedA));
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { base58Encode } = await import('../utils/base58');
  const sigBytesA = ed25519.sign(new Uint8Array(digestA), derived.privateKey);
  const payloadA = {
    standard: 'nep413',
    payload: {
      message: payloadAStr,
      nonce: payloadABody.nonce,
      recipient: intentsId,
    },
    public_key: derived.publicKeyB58,
    signature: `ed25519:${base58Encode(sigBytesA)}`,
  };

  // Simulate atomic batch first before spending relay gas or altering custody_mode!
  const sim = await nearRpc.simulateIntentsRelayed(env, [payloadA, payloadB]);
  if (!sim.ok) {
    throw new CustodyActionError(
      `Self-custody upgrade simulation failed: ${sim.error || 'unknown error'}`,
      400,
      'SIMULATION_FAILED'
    );
  }

  const relay = await nearRpc.executeIntentsBatchRelayed(env, [payloadA, payloadB], 200000000000000n);
  if (!relay.success) {
    throw new CustodyActionError(
      relay.error || 'Failed to execute atomic self-custody upgrade on intents.near',
      502,
      'RELAY_FAILED'
    );
  }

  // Read live intents.near keys to verify lock-out of server key and activation of user keys (fail-closed).
  let authState = await nearRpc.getAccountIntentsAuthState(env, meta.nearAccount);
  let signerKeyAuthorized = authState.publicKeys.includes(passkey.near_p256_pubkey!);
  let backupKeyAuthorized = authState.publicKeys.includes(meta.backupPubkey);
  let serverKeyRemoved = !authState.publicKeys.includes(meta.serverPubkeyB58);
  let predDisabled = !authState.isAuthByPredecessorEnabled;

  for (
    let attempt = 0;
    attempt < 3 && (!signerKeyAuthorized || !backupKeyAuthorized || !serverKeyRemoved || !predDisabled);
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    authState = await nearRpc.getAccountIntentsAuthState(env, meta.nearAccount);
    signerKeyAuthorized = authState.publicKeys.includes(passkey.near_p256_pubkey!);
    backupKeyAuthorized = authState.publicKeys.includes(meta.backupPubkey);
    serverKeyRemoved = !authState.publicKeys.includes(meta.serverPubkeyB58);
    predDisabled = !authState.isAuthByPredecessorEnabled;
  }

  if (!signerKeyAuthorized || !backupKeyAuthorized || !serverKeyRemoved || !predDisabled) {
    throw new CustodyActionError(
      'Post-upgrade on-chain key verification failed on intents.near; custody_mode was not updated.',
      502,
      'ONCHAIN_VERIFICATION_FAILED'
    );
  }

  // 3. Once all plain L1 assets are swept (none skipped), atomically rotate the native
  //    NEAR L1 FullAccess key on u_*.escrow.uprail.near from the server-derived key to
  //    the user's offline backupPubkey (`AddKey(backupPubkey) + DeleteKey(serverKey)`).
  let l1KeyRotated = false;
  let l1RotationTxHash: string | undefined;
  const allSweptCleanly = !sweepHadError && sweepResult.swept.every((s) => !s.skipped);
  if (allSweptCleanly) {
    const rot = await nearRpc.rotateSubAccountL1KeyToBackup(
      env,
      meta.nearAccount,
      derived.publicKey,
      derived.privateKey,
      meta.backupPubkey
    );
    l1KeyRotated = rot.rotated;
    l1RotationTxHash = rot.txHash;
  }

  const now = Date.now();
  if (env.DB) {
    await env.DB.prepare(
      `UPDATE x_identities
       SET custody_mode = 'self',
           backup_pubkey = ?,
           self_custody_at = COALESCE(self_custody_at, ?),
           self_custody_version = self_custody_version + 1,
           updated_at = ?
       WHERE x_id = ?`
    )
      .bind(meta.backupPubkey, now, now, xId)
      .run();

    for (const pkStr of meta.passkeyP256Keys) {
      await env.DB.prepare(
        `UPDATE passkeys
         SET onchain_added_at = COALESCE(onchain_added_at, ?)
         WHERE x_id = ? AND near_p256_pubkey = ?`
      )
        .bind(now, xId, pkStr)
        .run();
    }
  }

  if (params.oneClickActionId && params.oneClickAuthAssertion) {
    try {
      await clearUserSession(env, xId);
      await submitOneClickWebAuthnSession({
        env,
        xId,
        actionId: params.oneClickActionId,
        assertion: params.oneClickAuthAssertion,
      });
      oneClickSessionActive = true;
    } catch (ocErr) {
      console.warn('[custody/upgrade] Optional immediate 1Click WebAuthn session skipped:', ocErr);
    }
  }

  return {
    success: true,
    txHash: relay.txHash,
    l1KeyRotated,
    l1RotationTxHash,
    custodyMode: 'self' as const,
    nearAccount: meta.nearAccount,
    backupPubkey: meta.backupPubkey,
    oneClickSessionActive,
    sweptL1: sweepResult.swept,
    verification: {
      signerKeyAuthorized,
      backupKeyAuthorized,
      serverKeyRemoved,
      predDisabled,
      onchainKeys: authState.publicKeys,
    },
  };
}

/**
 * Provisions a brand-new user directly into non-custodial Self-Custody mode at first passkey signup:
 * 1. Creates `u_<hex>.escrow.uprail.near` and registers bootstrap key on `intents.near`.
 * 2. Warms the 30-day refreshable 1Click `User-Session` for Confidential Intents.
 * 3. Atomically adds `nearP256Pubkey` + `backupPubkey`, removes the server key, and disables
 *    `auth_by_predecessor_id` on `intents.near`, then verifies fail-closed on-chain.
 * 4. Atomically rotates the native NEAR L1 `FullAccess` key on `u_<hex>.escrow.uprail.near`
 *    to `backupPubkey` (`AddKey(backupPubkey) + DeleteKey(serverKey)`).
 * 5. Marks `x_identities.custody_mode = 'self'`, `backup_pubkey`, `self_custody_at`, and `passkeys.onchain_added_at`.
 */
export async function provisionInitialSelfCustodyOnchain(params: {
  env: Env;
  xId: string;
  xHandle: string;
  nearP256Pubkey: string;
  backupPubkey: string;
}): Promise<{
  nearAccount: string;
  backupPubkey: string;
  txHash?: string;
  l1KeyRotated: boolean;
}> {
  const { env, xId, nearP256Pubkey } = params;
  const parsedBackup = parseNearPublicKey(params.backupPubkey);
  if (parsedBackup.kind !== 'ed25519') {
    throw new CustodyActionError(
      'Backup key must be an ed25519:<base58> public key derived from your device Recovery Key',
      400,
      'INVALID_BACKUP_PUBKEY'
    );
  }
  const parsedP256 = parseNearPublicKey(nearP256Pubkey);
  if (parsedP256.kind !== 'p256') {
    throw new CustodyActionError('Passkey must be a P-256 public key', 400, 'INVALID_PASSKEY_PUBKEY');
  }

  const derived = await nearRpc.deriveUserNearKeypair(env, xId);
  const nearAccount = derived.accountId;

  const created = await nearRpc.createOnchainSubAccount(
    env,
    nearAccount,
    derived.publicKey,
    derived.privateKey,
    true
  );
  if (!created.success) {
    throw new CustodyActionError(
      created.error || 'Could not provision NEAR sub-account on-chain',
      502,
      'SUBACCOUNT_PROVISION_FAILED'
    );
  }

  const keyReady = await nearRpc.ensureKeyOnIntents(
    env,
    nearAccount,
    derived.publicKey,
    derived.privateKey
  );
  if (!keyReady.registered) {
    throw new CustodyActionError(
      keyReady.reason || 'Bootstrap key could not be registered on intents.near',
      502,
      'BOOTSTRAP_KEY_NOT_REGISTERED'
    );
  }

  await getUserSession(env, xId).catch(() => {});

  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const saltHex = await getCurrentIntentsSalt(env);
  const { payloadStr, body: payloadBody } = buildIntentsPayloadString({
    signerId: nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: [
      { intent: 'add_public_key', public_key: parsedP256.formatted },
      { intent: 'add_public_key', public_key: parsedBackup.formatted },
      { intent: 'remove_public_key', public_key: derived.publicKeyB58 },
      { intent: 'set_auth_by_predecessor_id', enabled: false },
    ],
    ttlMs: ACTION_TTL_MS,
  });

  const nonceBytes = Uint8Array.from(atob(payloadBody.nonce), (c) => c.charCodeAt(0));
  const serialized = nearRpc.nep413Serialize(payloadStr, nonceBytes, intentsId);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(serialized));
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { base58Encode } = await import('../utils/base58');
  const sigBytes = ed25519.sign(new Uint8Array(digest), derived.privateKey);
  const signedPayload = {
    standard: 'nep413',
    payload: {
      message: payloadStr,
      nonce: payloadBody.nonce,
      recipient: intentsId,
    },
    public_key: derived.publicKeyB58,
    signature: `ed25519:${base58Encode(sigBytes)}`,
  };

  const sim = await nearRpc.simulateIntentsRelayed(env, [signedPayload]);
  if (!sim.ok) {
    throw new CustodyActionError(
      `Initial self-custody provisioning simulation failed: ${sim.error || 'unknown error'}`,
      400,
      'SIMULATION_FAILED'
    );
  }

  const relay = await nearRpc.executeIntentsBatchRelayed(env, [signedPayload], 150000000000000n);
  if (!relay.success) {
    throw new CustodyActionError(
      relay.error || 'Failed to execute initial self-custody lock on intents.near',
      502,
      'RELAY_FAILED'
    );
  }

  let authState = await nearRpc.getAccountIntentsAuthState(env, nearAccount);
  let signerKeyAuthorized = authState.publicKeys.includes(parsedP256.formatted);
  let backupKeyAuthorized = authState.publicKeys.includes(parsedBackup.formatted);
  let serverKeyRemoved = !authState.publicKeys.includes(derived.publicKeyB58);
  let predDisabled = !authState.isAuthByPredecessorEnabled;

  for (
    let attempt = 0;
    attempt < 3 && (!signerKeyAuthorized || !backupKeyAuthorized || !serverKeyRemoved || !predDisabled);
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    authState = await nearRpc.getAccountIntentsAuthState(env, nearAccount);
    signerKeyAuthorized = authState.publicKeys.includes(parsedP256.formatted);
    backupKeyAuthorized = authState.publicKeys.includes(parsedBackup.formatted);
    serverKeyRemoved = !authState.publicKeys.includes(derived.publicKeyB58);
    predDisabled = !authState.isAuthByPredecessorEnabled;
  }

  if (!signerKeyAuthorized || !backupKeyAuthorized || !serverKeyRemoved || !predDisabled) {
    throw new CustodyActionError(
      'Initial self-custody on-chain key verification failed on intents.near.',
      502,
      'ONCHAIN_VERIFICATION_FAILED'
    );
  }

  const rot = await nearRpc.rotateSubAccountL1KeyToBackup(
    env,
    nearAccount,
    derived.publicKey,
    derived.privateKey,
    parsedBackup.formatted
  );

  const now = Date.now();
  if (env.DB) {
    await env.DB.prepare(
      `UPDATE x_identities
       SET near_account = ?,
           custody_mode = 'self',
           backup_pubkey = ?,
           self_custody_at = COALESCE(self_custody_at, ?),
           self_custody_version = self_custody_version + 1,
           updated_at = ?
       WHERE x_id = ?`
    )
      .bind(nearAccount, parsedBackup.formatted, now, now, xId)
      .run();

    await env.DB.prepare(
      `UPDATE passkeys
       SET onchain_added_at = COALESCE(onchain_added_at, ?)
       WHERE x_id = ? AND near_p256_pubkey = ?`
    )
      .bind(now, xId, parsedP256.formatted)
      .run();
  }

  return {
    nearAccount,
    backupPubkey: parsedBackup.formatted,
    txHash: relay.txHash,
    l1KeyRotated: rot.rotated,
  };
}

/**
 * Prepares a single empty `intents: []` WebAuthn challenge for authenticating 1Click `/v0/auth/authenticate`.
 */
export async function prepareOneClickWebAuthnSession(env: Env, xId: string, xHandle: string) {
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  const nearAccount = await nearRpc.resolveUserNearAccount(env, {
    x_id: xId,
    x_handle: xHandle,
    near_account: custody.nearAccount,
    custody_mode: custody.custodyMode,
  });

  const { payloadStr } = await buildEmptyWebAuthnAuthPayload(env, nearAccount);
  return await createPendingCustodyAction({
    env,
    xId,
    actionType: 'ONECLICK_AUTH_SESSION',
    payloadStr,
    meta: { nearAccount },
    requireOnchainPasskey: custody.custodyMode === 'self',
  });
}

export async function submitOneClickWebAuthnSession(params: {
  env: Env;
  xId: string;
  actionId: string;
  assertion: any;
}) {
  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    nearAccount: string;
  }>({
    env: params.env,
    xId: params.xId,
    actionId: params.actionId,
    assertion: params.assertion,
    expectedActionType: 'ONECLICK_AUTH_SESSION',
    requireOnchainPasskey: false,
  });

  const session = await completeWebAuthnOneClickSession(
    params.env,
    params.xId,
    meta.nearAccount,
    signedWebAuthn
  );

  return {
    success: true,
    accountId: session.accountId,
    oneClickSessionActive: true,
  };
}

/**
 * Prepares `add_public_key` for an additional passkey that was registered in D1
 * (`onchain_added_at IS NULL`) and must be authorized on `intents.near` by an
 * already-authorized device passkey.
 */
export async function prepareAddPasskeyOnchain(params: {
  env: Env;
  xId: string;
  xHandle: string;
  targetNearP256Pubkey?: string;
}) {
  const custody = await nearRpc.getUserCustodyRecord(params.env, params.xId);
  if (custody.custodyMode !== 'self') {
    throw new CustodyActionError('Only self-custody accounts register passkeys on intents.near', 400, 'NOT_SELF_CUSTODY');
  }
  const nearAccount = await nearRpc.resolveUserNearAccount(params.env, {
    x_id: params.xId,
    x_handle: params.xHandle,
    near_account: custody.nearAccount,
    custody_mode: 'self',
  });

  const passkeys = await listAndBackfillUserPasskeys(params.env, params.xId);
  const pendingTarget = params.targetNearP256Pubkey
    ? passkeys.find((p) => p.near_p256_pubkey === params.targetNearP256Pubkey)
    : passkeys.find((p) => p.near_p256_pubkey && p.onchain_added_at === null);

  if (!pendingTarget || !pendingTarget.near_p256_pubkey) {
    throw new CustodyActionError('No pending device passkey requires on-chain authorization', 404, 'NO_PENDING_PASSKEY');
  }

  const parsedTarget = parseNearPublicKey(pendingTarget.near_p256_pubkey);
  const saltHex = await getCurrentIntentsSalt(params.env);
  const intentsId = params.env.INTENTS_CONTRACT_ID || 'intents.near';

  const { payloadStr } = buildIntentsPayloadString({
    signerId: nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: [{ intent: 'add_public_key', public_key: parsedTarget.formatted }],
    ttlMs: ACTION_TTL_MS,
  });

  return await createPendingCustodyAction({
    env: params.env,
    xId: params.xId,
    actionType: 'ADD_PASSKEY_ONCHAIN',
    payloadStr,
    meta: {
      nearAccount,
      targetPasskeyId: pendingTarget.id,
      targetNearP256Pubkey: parsedTarget.formatted,
    },
    requireOnchainPasskey: true,
  });
}

export async function submitAddPasskeyOnchain(params: {
  env: Env;
  xId: string;
  actionId: string;
  assertion: any;
}) {
  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    nearAccount: string;
    targetPasskeyId: string;
    targetNearP256Pubkey: string;
  }>({
    env: params.env,
    xId: params.xId,
    actionId: params.actionId,
    assertion: params.assertion,
    expectedActionType: 'ADD_PASSKEY_ONCHAIN',
    requireOnchainPasskey: true,
  });

  const sim = await nearRpc.simulateIntentsRelayed(params.env, [signedWebAuthn]);
  if (!sim.ok) {
    throw new CustodyActionError(
      `Passkey authorization simulation failed: ${sim.error || 'unknown error'}`,
      400,
      'SIMULATION_FAILED'
    );
  }

  const relay = await nearRpc.executeIntentsRelayed(params.env, signedWebAuthn);
  if (!relay.success) {
    throw new CustodyActionError(
      relay.error || 'Failed to register new passkey on intents.near',
      502,
      'RELAY_FAILED'
    );
  }

  if (params.env.DB) {
    await params.env.DB.prepare('UPDATE passkeys SET onchain_added_at = ? WHERE id = ? AND x_id = ?')
      .bind(Date.now(), meta.targetPasskeyId, params.xId)
      .run();
  }

  return {
    success: true,
    txHash: relay.txHash,
    addedPublicKey: meta.targetNearP256Pubkey,
  };
}

/**
 * Recovery Step 1 (for self-custody users who lost their passkey):
 * User authenticates with X OAuth, enrolls a fresh replacement passkey attestation,
 * and receives an unsigned NEP-413 Intents payload for their device-derived backup key
 * to authorize the replacement P-256 passkey (and optionally revoke lost P-256 keys).
 */
export async function prepareBackupRecoveryWithNewPasskey(params: {
  env: Env;
  xId: string;
  xHandle: string;
  attestation: any;
  expectedChallenge: string;
  revokeLostPasskeys?: boolean;
}) {
  const { env, xId } = params;
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  if (custody.custodyMode !== 'self' || !custody.backupPubkey || !custody.nearAccount) {
    throw new CustodyActionError(
      'Backup Recovery Key flow applies only to active self-custody accounts',
      400,
      'NOT_SELF_CUSTODY'
    );
  }

  const verification = await webauthnService.verifyRegistration({
    attestation: params.attestation,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: allowedWebAuthnOrigins(env),
    expectedRPID: allowedWebAuthnRpIds(env),
  });

  if (env.DB) {
    const existingOwner = await env.DB.prepare('SELECT x_id FROM passkeys WHERE credential_id = ?')
      .bind(verification.credentialId)
      .first<{ x_id: string }>();
    if (existingOwner && existingOwner.x_id !== xId) {
      throw new CustodyActionError(
        'This passkey credential already belongs to another account',
        409,
        'ACCOUNT_MISMATCH'
      );
    }
  }

  const newP256Pubkey = cosePublicKeyToNearP256(verification.publicKeyHex);
  const now = Date.now();
  const newPasskeyId = crypto.randomUUID();

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO passkeys (
        id, x_id, credential_id, public_key, near_p256_pubkey, onchain_added_at, counter, transports, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(credential_id) DO UPDATE SET
        public_key = excluded.public_key,
        near_p256_pubkey = excluded.near_p256_pubkey,
        counter = excluded.counter`
    )
      .bind(
        newPasskeyId,
        xId,
        verification.credentialId,
        verification.publicKeyHex,
        newP256Pubkey,
        verification.counter,
        JSON.stringify(params.attestation?.response?.transports || []),
        now
      )
      .run();
  }

  const authState = await nearRpc.getAccountIntentsAuthState(env, custody.nearAccount);
  const lostP256Keys = params.revokeLostPasskeys
    ? authState.publicKeys.filter((k) => k.startsWith('p256:') && k !== newP256Pubkey)
    : [];

  const actions: IntentsAction[] = [
    { intent: 'add_public_key', public_key: newP256Pubkey },
    ...lostP256Keys.map((pk) => ({ intent: 'remove_public_key' as const, public_key: pk })),
  ];

  const saltHex = authState.currentSalt || (await getCurrentIntentsSalt(env));
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const deadlineMs = now + ACTION_TTL_MS;
  const nep413NonceB64 = encodeVersionedNonce(saltFromHex(saltHex), new Date(deadlineMs));
  const messageStr = JSON.stringify({
    signer_id: custody.nearAccount,
    verifying_contract: intentsId,
    deadline: new Date(deadlineMs).toISOString(),
    nonce: nep413NonceB64,
    intents: actions,
  });

  // Record recovery attempt in pending_custody_actions so only this exact new key can be activated.
  const recoveryActionId = `rec_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const nep413Digest = bytesToBase64UrlUnpadded(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageStr)))
  );

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO pending_custody_actions (
        id, x_id, action_type, challenge_digest, payload_json, meta_json, expires_at, used_at, created_at
      ) VALUES (?, ?, 'BACKUP_KEY_RECOVERY', ?, ?, ?, ?, NULL, ?)`
    )
      .bind(
        recoveryActionId,
        xId,
        nep413Digest,
        messageStr,
        JSON.stringify({
          nearAccount: custody.nearAccount,
          backupPubkey: custody.backupPubkey,
          newPasskeyId,
          newCredentialId: verification.credentialId,
          newP256Pubkey,
          lostP256Keys,
        }),
        deadlineMs,
        now
      )
      .run();
  }

  return {
    recoveryActionId,
    nearAccount: custody.nearAccount,
    backupPubkey: custody.backupPubkey,
    newCredentialId: verification.credentialId,
    newP256Pubkey,
    revokedKeys: lostP256Keys,
    nep413Payload: {
      message: messageStr,
      nonce: nep413NonceB64,
      recipient: intentsId,
    },
    expiresAt: deadlineMs,
  };
}

/**
 * Recovery Step 2: device signs `nep413Payload` with the ed25519 key reconstructed from
 * the user's offline Recovery Key. Server verifies signature matches stored `backup_pubkey`,
 * relays on-chain, promotes the new passkey in D1, and optionally cleans up revoked keys.
 */
export async function submitBackupRecoveryWithSignedNep413(params: {
  env: Env;
  xId: string;
  recoveryActionId: string;
  signedNep413: SignedNep413Payload;
}) {
  const { env, xId, recoveryActionId, signedNep413 } = params;
  if (!env.DB) {
    throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }

  const row = await env.DB.prepare(
    'SELECT * FROM pending_custody_actions WHERE id = ? AND x_id = ? LIMIT 1'
  )
    .bind(recoveryActionId, xId)
    .first<PendingCustodyActionRow>();

  if (!row || row.action_type !== 'BACKUP_KEY_RECOVERY') {
    throw new CustodyActionError('Recovery request not found', 404, 'ACTION_NOT_FOUND');
  }
  if (row.used_at !== null && row.used_at !== undefined) {
    throw new CustodyActionError('Recovery request already submitted', 409, 'ACTION_ALREADY_USED');
  }
  if (row.expires_at <= Date.now()) {
    throw new CustodyActionError('Recovery request expired', 410, 'ACTION_EXPIRED');
  }

  const meta = JSON.parse(row.meta_json || '{}') as {
    nearAccount: string;
    backupPubkey: string;
    newPasskeyId: string;
    newCredentialId: string;
    newP256Pubkey: string;
    lostP256Keys: string[];
  };

  if (signedNep413?.payload?.message !== row.payload_json) {
    throw new CustodyActionError('Signed recovery payload does not match prepared recovery action', 400, 'PAYLOAD_MISMATCH');
  }
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  if (signedNep413?.payload?.recipient !== intentsId) {
    throw new CustodyActionError('Invalid NEP-413 recipient', 400, 'RECIPIENT_MISMATCH');
  }

  const sigOk = await verifySignedNep413Ed25519Payload(signedNep413, meta.backupPubkey);
  if (!sigOk) {
    throw new CustodyActionError(
      'Recovery Key signature invalid or does not match the Backup Public Key registered on this account.',
      401,
      'INVALID_BACKUP_KEY_SIGNATURE'
    );
  }

  const sim = await nearRpc.simulateIntentsRelayed(env, [signedNep413]);
  if (!sim.ok) {
    throw new CustodyActionError(
      `Recovery simulation failed: ${sim.error || 'unknown error'}`,
      400,
      'SIMULATION_FAILED'
    );
  }

  const now = Date.now();
  const consume = await env.DB.prepare(
    'UPDATE pending_custody_actions SET used_at = ? WHERE id = ? AND used_at IS NULL'
  )
    .bind(now, recoveryActionId)
    .run();
  if ((consume.meta?.changes ?? 0) !== 1) {
    throw new CustodyActionError('Recovery request concurrently used', 409, 'ACTION_ALREADY_USED');
  }

  const relay = await nearRpc.executeIntentsRelayed(env, signedNep413);
  if (!relay.success) {
    throw new CustodyActionError(relay.error || 'Failed to relay recovery intent', 502, 'RELAY_FAILED');
  }

  await env.DB.prepare('UPDATE passkeys SET onchain_added_at = ? WHERE credential_id = ? AND x_id = ?')
    .bind(now, meta.newCredentialId, xId)
    .run();

  if (meta.lostP256Keys.length > 0) {
    await env.DB.prepare('DELETE FROM passkeys WHERE x_id = ? AND credential_id != ?')
      .bind(xId, meta.newCredentialId)
      .run();
  }

  await env.DB.prepare(
    'UPDATE x_identities SET self_custody_version = self_custody_version + 1, updated_at = ? WHERE x_id = ?'
  )
    .bind(now, xId)
    .run();

  await clearUserSession(env, xId);

  return {
    success: true,
    txHash: relay.txHash,
    nearAccount: meta.nearAccount,
    addedPasskeyPubkey: meta.newP256Pubkey,
    removedLostKeys: meta.lostP256Keys,
    newCredentialId: meta.newCredentialId,
  };
}

/**
 * Public read-only custody verification for `/verify` page & API.
 * Resolves either a direct NEAR account (`u_*.escrow.uprail.near`, `circle.uprail.near`, etc.)
 * or an X `@handle`, reads live on-chain intents.near state and L1 access keys.
 */
export async function verifyPublicCustodyState(env: Env, accountOrHandle: string) {
  const raw = accountOrHandle.trim().replace(/^@/, '');
  if (!raw) {
    throw new CustodyActionError('Missing NEAR account ID or X handle', 400, 'INVALID_REQUEST');
  }

  let nearAccount: string | null = null;
  let dbProfile: {
    xHandle: string;
    custodyMode: 'server' | 'self';
    backupPubkey: string | null;
    selfCustodyAt: number | null;
    registeredPasskeys: Array<{ nearP256Pubkey: string | null; onchainAddedAt: number | null }>;
  } | null = null;

  const looksLikeAccount = raw.includes('.') || /^0x[0-9a-f]{40}$/i.test(raw) || /^[0-9a-f]{64}$/i.test(raw);
  if (looksLikeAccount) {
    nearAccount = raw.toLowerCase();
  }

  if (env.DB) {
    try {
      const identity = await env.DB.prepare(
        looksLikeAccount
          ? 'SELECT x_id, x_handle, near_account, custody_mode, backup_pubkey, self_custody_at FROM x_identities WHERE LOWER(near_account) = ? LIMIT 1'
          : 'SELECT x_id, x_handle, near_account, custody_mode, backup_pubkey, self_custody_at FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
      )
        .bind(raw.toLowerCase())
        .first<{
          x_id: string;
          x_handle: string;
          near_account: string | null;
          custody_mode?: string | null;
          backup_pubkey?: string | null;
          self_custody_at?: number | null;
        }>();

      if (identity) {
        if (!nearAccount && identity.near_account) {
          nearAccount = identity.near_account;
        }
        const pks = await listAndBackfillUserPasskeys(env, identity.x_id);
        dbProfile = {
          xHandle: identity.x_handle,
          custodyMode: identity.custody_mode === 'self' ? 'self' : 'server',
          backupPubkey: identity.backup_pubkey ?? null,
          selfCustodyAt: identity.self_custody_at ?? null,
          registeredPasskeys: pks.map((p) => ({
            nearP256Pubkey: p.near_p256_pubkey,
            onchainAddedAt: p.onchain_added_at,
          })),
        };
      }
    } catch {}
  }

  if (!nearAccount) {
    throw new CustodyActionError(`No NEAR account found for '${raw}'`, 404, 'ACCOUNT_NOT_FOUND');
  }

  const onchain = await nearRpc.getAccountIntentsAuthState(env, nearAccount);
  const p256Keys = onchain.publicKeys.filter((k) => k.startsWith('p256:'));
  const ed25519Keys = onchain.publicKeys.filter((k) => k.startsWith('ed25519:'));
  const backupMatchedOnchain = dbProfile?.backupPubkey
    ? onchain.publicKeys.includes(dbProfile.backupPubkey)
    : null;
  const l1FullAccessKeys = onchain.l1AccessKeys.filter((k) => k.permission === 'FullAccess');

  // An account has verifiable intents.near self-custody iff:
  //  - at least 1 p256 passkey is registered on intents.near
  //  - is_auth_by_predecessor_id_enabled is false (so Uprail's L1 keys cannot act on intents.near)
  //  - no unexpected ed25519 key other than the declared backup_pubkey (if known)
  const onlyKnownBackupEd25519 = dbProfile?.backupPubkey
    ? ed25519Keys.every((k) => k === dbProfile!.backupPubkey)
    : ed25519Keys.length === 0;
  const selfCustodyVerifiedOnchain =
    p256Keys.length > 0 && !onchain.isAuthByPredecessorEnabled && onlyKnownBackupEd25519;

  return {
    accountId: onchain.accountId,
    intentsContractId: onchain.intentsContractId,
    selfCustodyVerifiedOnchain,
    onchain: {
      publicKeys: onchain.publicKeys,
      p256Count: p256Keys.length,
      ed25519Count: ed25519Keys.length,
      isAuthByPredecessorEnabled: onchain.isAuthByPredecessorEnabled,
      l1AccountExists: onchain.l1AccountExists,
      l1FullAccessKeyCount: l1FullAccessKeys.length,
      l1AccessKeys: onchain.l1AccessKeys,
      contractLocked: onchain.l1AccountExists && l1FullAccessKeys.length === 0,
    },
    uprailRecord: dbProfile
      ? {
          ...dbProfile,
          backupMatchedOnchain,
        }
      : null,
    circleContractId: env.CIRCLE_CONTRACT_ID || null,
    verifiedAt: Date.now(),
  };
}
