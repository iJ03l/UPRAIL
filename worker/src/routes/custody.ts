/**
 * Self-Custody & Public On-Chain Verification Routes (/api/custody/* & /api/verify/*)
 *
 * Implements opt-in passkey self-custody:
 *  - Non-breaking default: existing users remain in `custody_mode = 'server'`.
 *  - Guided upgrade wizard: preflight check -> optional plain L1 sweep -> atomic
 *    `add_public_key` (passkey p256 + device backup ed25519) + `remove_public_key`
 *    (server key) + `set_auth_by_predecessor_id(false)`.
 *  - Single-tap passkey intent flows (`prepare` -> WebAuthn -> `submit`) for
 *    1Click WebAuthn auth session and secondary device passkey onboarding.
 *  - Server-blind Backup Recovery Key replacement of lost passkeys (no passkey gate;
 *    protected by on-chain NEP-413 signature from user's offline Backup Key).
 *  - Public read-only verification (`/api/verify/:accountOrHandle`).
 */

import { Hono, type Context } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { requireAuth, updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import * as nearRpc from '../services/nearRpc';
import * as webauthn from '../services/webauthn';
import { resolveRpId } from '../services/webauthnConfig';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import { publicErrorMessage } from '../utils/errors';
import {
  CustodyActionError,
  getCustodyPreflight,
  sweepPlainBalancesBeforeUpgrade,
  prepareUpgradeToSelfCustody,
  submitUpgradeToSelfCustody,
  prepareOneClickWebAuthnSession,
  submitOneClickWebAuthnSession,
  prepareAddPasskeyOnchain,
  submitAddPasskeyOnchain,
  prepareBackupRecoveryWithNewPasskey,
  submitBackupRecoveryWithSignedNep413,
  verifyPublicCustodyState,
} from '../services/custodyService';
import {
  prepareSweepPlainL1ToIntents,
  submitNativeL1Operation,
  submitSweepPlainL1ToIntents,
} from '../services/nativeL1Auth';
import { issueNativeL1Grant, revokeNativeL1Grant } from '../services/nativeL1Grant';
import {
  getCircleContractId,
  getCircleOnchain,
  getCircleContractConfig,
  getGiftOnchain,
  getUnclaimedSendOnchain,
} from '../services/circleContract';

export const custodyRouter = new Hono<AppContext>();
export const verifyRouter = new Hono<AppContext>();

function handleCustodyError(c: Context<AppContext>, err: unknown, fallbackCode: string) {
  if (err instanceof CustodyActionError) {
    return c.json(
      { error: err.message, code: err.code, ...(err.extra || {}) },
      err.status as any
    );
  }
  console.error(`[custody] ${fallbackCode}:`, err);
  return c.json<ErrorResponse>(
    { error: publicErrorMessage(err, 'Self-custody operation failed'), code: fallbackCode },
    500
  );
}

/**
 * GET /api/custody/preflight
 * Returns non-sensitive readiness checks before upgrading to Self-Custody.
 */
custodyRouter.get('/preflight', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const preflight = await getCustodyPreflight(c.env, session.x_id, session.x_handle);
    return c.json(preflight);
  } catch (err) {
    return handleCustodyError(c, err, 'PREFLIGHT_ERROR');
  }
});

/**
 * POST /api/custody/sweep-plain
 * Sweeps plain L1 Intents-supported balances into the user's own `intents.near` balance before
 * disabling predecessor auth during Self-Custody upgrade (server-custody only; self-custody uses
 * interactive `/sweep-plain/prepare` + `/sweep-plain/submit`).
 */
custodyRouter.post(
  '/sweep-plain',
  requirePasskeyAuth(),
  rateLimit({ limit: 20, prefix: 'custody_sweep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      if (custody.custodyMode === 'self') {
        return c.json<ErrorResponse>(
          {
            error: 'Sign with your passkey via /api/custody/sweep-plain/prepare to authorize NEAR L1 key use.',
            code: 'SELF_CUSTODY_SIGNATURE_REQUIRED',
          },
          409
        );
      }
      const nearAccount = await nearRpc.resolveUserNearAccount(c.env, {
        ...session,
        custody_mode: custody.custodyMode,
        near_account: custody.nearAccount,
      });
      const grant = issueNativeL1Grant({
        xId: session.x_id,
        operation: 'sweep_to_intents',
        target: nearAccount,
        asset: '*',
      });
      try {
        const result = await sweepPlainBalancesBeforeUpgrade(
          c.env,
          session.x_id,
          session.x_handle,
          { nativeL1Grant: grant }
        );
        return c.json(result);
      } finally {
        revokeNativeL1Grant(grant);
      }
    } catch (err) {
      return handleCustodyError(c, err, 'SWEEP_PLAIN_ERROR');
    }
  }
);

custodyRouter.post(
  '/sweep-plain/prepare',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_sweep_prep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => ({}))) as {
        asset?: string;
        symbol?: string;
        amount?: string;
        nextStep?: string;
      };
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      const nearAccount = await nearRpc.resolveUserNearAccount(c.env, {
        ...session,
        custody_mode: custody.custodyMode,
        near_account: custody.nearAccount,
      });
      const prepared = await prepareSweepPlainL1ToIntents({
        env: c.env,
        session,
        nearAccount,
        asset: body?.asset,
        symbol: body?.symbol,
        amount: body?.amount,
        nextStep: body?.nextStep || 'settings',
      });
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'SWEEP_PLAIN_PREPARE_ERROR');
    }
  }
);

custodyRouter.post(
  '/sweep-plain/submit',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_sweep_sub', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        actionId?: string;
        assertion?: unknown;
      } | null;
      if (!body?.actionId || !body?.assertion) {
        return c.json<ErrorResponse>(
          { error: 'Missing actionId or WebAuthn passkey assertion', code: 'INVALID_REQUEST' },
          400
        );
      }
      const result = await submitSweepPlainL1ToIntents({
        env: c.env,
        session,
        actionId: body.actionId,
        assertion: body.assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'SWEEP_PLAIN_SUBMIT_ERROR');
    }
  }
);

custodyRouter.post(
  '/native-auth/prepare',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_native_prep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => ({}))) as {
        asset?: string;
        symbol?: string;
        amount?: string;
        nextStep?: string;
      };
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      const nearAccount = await nearRpc.resolveUserNearAccount(c.env, {
        ...session,
        custody_mode: custody.custodyMode,
        near_account: custody.nearAccount,
      });
      const prepared = await prepareSweepPlainL1ToIntents({
        env: c.env,
        session,
        nearAccount,
        asset: body?.asset,
        symbol: body?.symbol,
        amount: body?.amount,
        nextStep: body?.nextStep || 'settings',
      });
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'NATIVE_AUTH_PREPARE_ERROR');
    }
  }
);

custodyRouter.post(
  '/native-auth/submit',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_native_sub', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        actionId?: string;
        assertion?: unknown;
      } | null;
      if (!body?.actionId || !body?.assertion) {
        return c.json<ErrorResponse>(
          { error: 'Missing actionId or WebAuthn passkey assertion', code: 'INVALID_REQUEST' },
          400
        );
      }
      const result = await submitNativeL1Operation({
        env: c.env,
        session,
        actionId: body.actionId,
        assertion: body.assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'NATIVE_AUTH_SUBMIT_ERROR');
    }
  }
);

/**
 * POST /api/custody/upgrade/prepare
 * Validates preflight checks + backup `ed25519:` pubkey and builds the atomic
 * Payload B WebAuthn challenge (`remove_public_key` + `set_auth_by_predecessor_id(false)`).
 */
custodyRouter.post(
  '/upgrade/prepare',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_upgrade_prep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => ({}))) as { backupPubkey?: string };
      if (!body.backupPubkey || typeof body.backupPubkey !== 'string') {
        return c.json<ErrorResponse>(
          { error: 'Missing required device-generated Backup Key public key', code: 'MISSING_BACKUP_PUBKEY' },
          400
        );
      }

      const prepared = await prepareUpgradeToSelfCustody({
        env: c.env,
        xId: session.x_id,
        xHandle: session.x_handle,
        backupPubkey: body.backupPubkey.trim(),
      });
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'UPGRADE_PREPARE_ERROR');
    }
  }
);

/**
 * POST /api/custody/upgrade/submit
 * Verifies the user's Payload B WebAuthn signature, simulates `[PayloadA, PayloadB]`,
 * relays them atomically to `intents.near`, verifies live on-chain keys, and flips
 * `custody_mode = 'self'`.
 */
custodyRouter.post(
  '/upgrade/submit',
  requireAuth(),
  rateLimit({ limit: 15, prefix: 'custody_upgrade_sub', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        actionId?: string;
        assertion?: any;
        oneClickActionId?: string;
        oneClickAuthAssertion?: any;
      } | null;

      if (!body?.actionId || !body?.assertion) {
        return c.json<ErrorResponse>(
          { error: 'Missing actionId or WebAuthn passkey assertion', code: 'INVALID_REQUEST' },
          400
        );
      }

      const result = await submitUpgradeToSelfCustody({
        env: c.env,
        xId: session.x_id,
        xHandle: session.x_handle,
        actionId: body.actionId,
        assertion: body.assertion,
        oneClickActionId: body.oneClickActionId,
        oneClickAuthAssertion: body.oneClickAuthAssertion,
      });

      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'UPGRADE_SUBMIT_ERROR');
    }
  }
);

/**
 * POST /api/custody/oneclick-session/prepare
 * Prepares an empty `intents: []` WebAuthn challenge for 1Click `/v0/auth/authenticate`.
 */
custodyRouter.post(
  '/oneclick-session/prepare',
  requireAuth(),
  rateLimit({ limit: 30, prefix: 'custody_oc_prep' }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const prepared = await prepareOneClickWebAuthnSession(c.env, session.x_id, session.x_handle);
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'ONECLICK_PREPARE_ERROR');
    }
  }
);

/**
 * POST /api/custody/oneclick-session/submit
 * Verifies the WebAuthn assertion and authenticates the user's confidential 1Click session.
 */
custodyRouter.post(
  '/oneclick-session/submit',
  requireAuth(),
  rateLimit({ limit: 30, prefix: 'custody_oc_sub' }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        actionId?: string;
        assertion?: any;
      } | null;

      if (!body?.actionId || !body?.assertion) {
        return c.json<ErrorResponse>(
          { error: 'Missing actionId or WebAuthn passkey assertion', code: 'INVALID_REQUEST' },
          400
        );
      }

      const result = await submitOneClickWebAuthnSession({
        env: c.env,
        xId: session.x_id,
        actionId: body.actionId,
        assertion: body.assertion,
      });

      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'ONECLICK_SUBMIT_ERROR');
    }
  }
);

/**
 * POST /api/custody/passkey/add/prepare
 * Prepares an `add_public_key` payload for a newly registered secondary device passkey,
 * signed by an already-authorized on-chain passkey.
 */
custodyRouter.post(
  '/passkey/add/prepare',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_addpk_prep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => ({}))) as { targetNearP256Pubkey?: string };
      const prepared = await prepareAddPasskeyOnchain({
        env: c.env,
        xId: session.x_id,
        xHandle: session.x_handle,
        targetNearP256Pubkey: body.targetNearP256Pubkey,
      });
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'ADD_PASSKEY_PREPARE_ERROR');
    }
  }
);

/**
 * POST /api/custody/passkey/add/submit
 * Relays the passkey-signed `add_public_key` intent and marks the target passkey active on-chain.
 */
custodyRouter.post(
  '/passkey/add/submit',
  requireAuth(),
  rateLimit({ limit: 20, prefix: 'custody_addpk_sub', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        actionId?: string;
        assertion?: any;
      } | null;

      if (!body?.actionId || !body?.assertion) {
        return c.json<ErrorResponse>(
          { error: 'Missing actionId or WebAuthn passkey assertion', code: 'INVALID_REQUEST' },
          400
        );
      }

      const result = await submitAddPasskeyOnchain({
        env: c.env,
        xId: session.x_id,
        actionId: body.actionId,
        assertion: body.assertion,
      });

      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'ADD_PASSKEY_SUBMIT_ERROR');
    }
  }
);

/**
 * GET /api/custody/recovery/register-options
 * Issues WebAuthn registration options so a Self-Custody user who lost their passkey
 * can enroll a replacement passkey and authorize it using their offline Backup Recovery Key.
 */
custodyRouter.get(
  '/recovery/register-options',
  requireAuth(),
  rateLimit({ limit: 15, prefix: 'custody_rec_opts', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      if (custody.custodyMode !== 'self' || !custody.backupPubkey) {
        return c.json<ErrorResponse>(
          {
            error: 'Backup Key recovery applies only to Self-Custody accounts. Use standard recovery codes instead.',
            code: 'NOT_SELF_CUSTODY',
          },
          400
        );
      }

      let excludeCredentials: Array<{ id: string; transports?: string[] }> = [];
      if (c.env.DB) {
        const rows = await c.env.DB.prepare(
          'SELECT credential_id, transports FROM passkeys WHERE x_id = ?'
        )
          .bind(session.x_id)
          .all<{ credential_id: string; transports: string | null }>();
        excludeCredentials = (rows.results || [])
          .filter((r) => r.credential_id)
          .map((r) => {
            let transports: string[] | undefined;
            try {
              const parsed = r.transports ? JSON.parse(r.transports) : null;
              if (Array.isArray(parsed) && parsed.length > 0) transports = parsed;
            } catch {
              /* ignore */
            }
            return { id: r.credential_id, transports };
          });
      }

      const rpId = resolveRpId(c.env);
      const rpName = c.env.WEBAUTHN_RP_NAME || 'UPRAIL';
      const options = await webauthn.generateRegistrationOptions({
        userId: session.x_id,
        userName: session.x_handle,
        rpId,
        rpName,
        excludeCredentials,
      });

      await storeChallenge(c.env, {
        key: `custody_rec_reg:${session.x_id}`,
        challenge: options.challenge,
        xId: session.x_id,
        purpose: 'custody_recovery_registration',
        ttlSeconds: 300,
      });

      return c.json({
        ...options,
        nearAccount: custody.nearAccount,
        backupPubkey: custody.backupPubkey,
      });
    } catch (err) {
      return handleCustodyError(c, err, 'RECOVERY_OPTIONS_ERROR');
    }
  }
);

/**
 * POST /api/custody/recovery/prepare
 * Verifies the replacement passkey attestation and returns the unsigned NEP-413
 * Intents payload to be signed on the user's device using their Backup Recovery Key.
 */
custodyRouter.post(
  '/recovery/prepare',
  requireAuth(),
  rateLimit({ limit: 10, prefix: 'custody_rec_prep', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        attestation?: any;
        expectedChallenge?: string;
        revokeLostPasskeys?: boolean;
      } | null;

      if (!body?.attestation) {
        return c.json<ErrorResponse>(
          { error: 'Missing replacement WebAuthn attestation payload', code: 'INVALID_REQUEST' },
          400
        );
      }

      const consumed = await consumeChallenge(c.env, {
        key: `custody_rec_reg:${session.x_id}`,
        purpose: 'custody_recovery_registration',
        expectedChallenge: body.expectedChallenge,
      });
      if (!consumed) {
        return c.json<ErrorResponse>(
          { error: 'Recovery registration challenge expired or invalid; please restart recovery', code: 'INVALID_CHALLENGE' },
          401
        );
      }

      const prepared = await prepareBackupRecoveryWithNewPasskey({
        env: c.env,
        xId: session.x_id,
        xHandle: session.x_handle,
        attestation: body.attestation,
        expectedChallenge: consumed,
        revokeLostPasskeys: body.revokeLostPasskeys !== false,
      });
      return c.json(prepared);
    } catch (err) {
      return handleCustodyError(c, err, 'RECOVERY_PREPARE_ERROR');
    }
  }
);

/**
 * POST /api/custody/recovery/submit
 * Verifies the client's Backup Key NEP-413 signature, relays it to `intents.near`,
 * activates the replacement passkey, and marks the user's session passkey-verified.
 */
custodyRouter.post(
  '/recovery/submit',
  requireAuth(),
  rateLimit({ limit: 10, prefix: 'custody_rec_sub', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const body = (await c.req.json().catch(() => null)) as {
        recoveryActionId?: string;
        signedNep413?: any;
      } | null;

      if (!body?.recoveryActionId || !body?.signedNep413) {
        return c.json<ErrorResponse>(
          { error: 'Missing recoveryActionId or signedNep413 payload', code: 'INVALID_REQUEST' },
          400
        );
      }

      const result = await submitBackupRecoveryWithSignedNep413({
        env: c.env,
        xId: session.x_id,
        recoveryActionId: body.recoveryActionId,
        signedNep413: body.signedNep413,
      });

      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json(result);
    } catch (err) {
      return handleCustodyError(c, err, 'RECOVERY_SUBMIT_ERROR');
    }
  }
);

/**
 * Public read-only verification endpoints:
 *  - GET /api/verify?q=<accountOrHandle>
 *  - GET /api/verify/:accountOrHandle
 */
verifyRouter.get(
  '/',
  rateLimit({ limit: 60, prefix: 'custody_verify' }),
  async (c) => {
    const q = c.req.query('q') || '';
    if (!q.trim()) {
      return c.json<ErrorResponse>(
        { error: 'Provide a NEAR account ID (e.g. u_xxx.escrow.uprail.near) or X @handle', code: 'MISSING_QUERY' },
        400
      );
    }
    try {
      const state = await verifyPublicCustodyState(c.env, q);
      return c.json(state);
    } catch (err) {
      return handleCustodyError(c, err, 'VERIFY_ERROR');
    }
  }
);

verifyRouter.get(
  '/circle/:circleId',
  rateLimit({ limit: 60, prefix: 'custody_verify' }),
  async (c) => {
    const circleId = (c.req.param('circleId') || '').trim();
    if (!circleId) {
      return c.json<ErrorResponse>({ error: 'Missing circleId', code: 'MISSING_QUERY' }, 400);
    }
    const contractId = getCircleContractId(c.env);
    if (!contractId) {
      return c.json({ foundOnchain: false, contractId: null, kind: 'circle', id: circleId });
    }
    const [config, circle] = await Promise.all([
      getCircleContractConfig(c.env, contractId).catch(() => null),
      getCircleOnchain(c.env, circleId, contractId).catch(() => null),
    ]);
    return c.json({
      foundOnchain: Boolean(circle),
      kind: 'circle',
      id: circleId,
      contractId,
      config,
      onchain: circle,
    });
  }
);

verifyRouter.get(
  '/gift/:giftId',
  rateLimit({ limit: 60, prefix: 'custody_verify' }),
  async (c) => {
    const giftId = (c.req.param('giftId') || '').trim();
    if (!giftId) {
      return c.json<ErrorResponse>({ error: 'Missing giftId', code: 'MISSING_QUERY' }, 400);
    }
    const contractId = getCircleContractId(c.env);
    if (!contractId) {
      return c.json({ foundOnchain: false, contractId: null, kind: 'gift', id: giftId });
    }
    const [config, gift] = await Promise.all([
      getCircleContractConfig(c.env, contractId).catch(() => null),
      getGiftOnchain(c.env, giftId, contractId).catch(() => null),
    ]);
    return c.json({
      foundOnchain: Boolean(gift),
      kind: 'gift',
      id: giftId,
      contractId,
      config,
      onchain: gift,
    });
  }
);

verifyRouter.get(
  '/send/:sendId',
  rateLimit({ limit: 60, prefix: 'custody_verify' }),
  async (c) => {
    const sendId = (c.req.param('sendId') || '').trim();
    if (!sendId) {
      return c.json<ErrorResponse>({ error: 'Missing sendId', code: 'MISSING_QUERY' }, 400);
    }
    const contractId = getCircleContractId(c.env);
    if (!contractId) {
      return c.json({ foundOnchain: false, contractId: null, kind: 'send', id: sendId });
    }
    const [config, send] = await Promise.all([
      getCircleContractConfig(c.env, contractId).catch(() => null),
      getUnclaimedSendOnchain(c.env, sendId, contractId).catch(() => null),
    ]);
    return c.json({
      foundOnchain: Boolean(send),
      kind: 'send',
      id: sendId,
      contractId,
      config,
      onchain: send,
    });
  }
);

verifyRouter.get(
  '/:accountOrHandle',
  rateLimit({ limit: 60, prefix: 'custody_verify' }),
  async (c) => {
    try {
      const accountOrHandle = c.req.param('accountOrHandle');
      const state = await verifyPublicCustodyState(c.env, accountOrHandle);
      return c.json(state);
    } catch (err) {
      return handleCustodyError(c, err, 'VERIFY_ERROR');
    }
  }
);
