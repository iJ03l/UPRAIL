/**
 * Claim routes for UP (UPRAIL.app)
 * Pending payment discovery, WebAuthn passkey registration, claim execution, and balance checks
 */

import { Context, Hono } from 'hono';
import {
  AppContext,
  ClaimExecuteRequest,
  ClaimExecuteResponse,
  ClaimExecuteResult,
  ErrorResponse,
  Payment,
  PaymentStatus,
  RegisterPasskeyRequest,
  RegisterPasskeyResponse,
  Session,
} from '../types';
import { requireAuth } from '../middleware/session';
import { updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { resolveOrigin, resolveRpId, allowedWebAuthnOrigins, allowedWebAuthnRpIds } from '../services/webauthnConfig';
import * as webauthn from '../services/webauthn';
import * as nearRpc from '../services/nearRpc';
import { redeemInvite } from '../services/inviteService';
import { ensureRecoveryCodes } from '../services/recoveryCodes';
import { background } from '../utils/background';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import {
  isValidDestinationAddress,
  isNearAccountAddress,
  chainMatchesAddress,
  hasKnownAddressFamily,
  getWithdrawChains,
  get1ClickWithdrawalQuote,
} from '../services/oneclickWithdraw';
import { publicErrorMessage } from '../utils/errors';
import { syncAllLaunchpadFees } from '../services/launchpadFees';
import {
  ensureConfidentialFunds,
  formatAtomic,
  getConfidentialAssetBalance,
  getConfidentialBalances,
  isConfidentialRailEnabled,
  payEscrowPrivate,
  submitPrivateWithdrawal,
  submitEscrowPrivateTransfer,
  waitForSettlement,
} from '../services/confidentialRail';

export const claimRouter = new Hono<AppContext>();

/**
 * True when the reason the intents rail could not be prepared is a transient
 * infrastructure failure (RPC throttle, subrequest budget, read timeout)
 * rather than a genuine "this asset can't use intents" limitation. Transient
 * failures must not downgrade a cross-chain withdraw to the plain-NEAR rail.
 */
function isTransientRailReason(reason: string | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  // A validated account error is deterministic, even though the RPC wraps it
  // in the same bare "Server error" envelope as a throttle. Treating
  // NotEnoughBalance as transient told the user to retry a withdrawal that
  // could never succeed and hid the real fix (fund the gas-paying account).
  if (r.includes('notenoughbalance') || r.includes('lackbalanceforstate')) return false;
  return [
    'too many subrequests',
    'could not read',
    'plain_balance_unavailable',
    'near rpc',
    'timeout',
    'fetch failed',
    'server error',
    'throttl',
    'rate limit',
    '429',
    'network',
    'temporarily',
  ].some((marker) => r.includes(marker));
}

/**
 * Turns a raw settlement error into a short explanation the user can act on.
 * The withdraw endpoint returns this string directly, so it must name the
 * cause and the next step without leaking RPC/node internals.
 */
function explainSettlementFailure(
  rail: 'native' | 'intents' | 'cross_chain',
  raw: string,
  asset: string
): string {
  const r = (raw || '').toLowerCase();
  const symbol = asset.includes(':') ? asset.split(':').pop() || asset : asset;

  // Multi-token (nep245 / NEAR Intents) assets carry an EVM `nearContractId`,
  // so the NEP-141 fallback registers a non-NEAR account and dies with
  // "… is not registered on 0x…". Intents-native settlement isn't wired up yet.
  if (asset.toLowerCase().startsWith('nep245:') || /not registered on 0x[0-9a-f]{40}/i.test(raw)) {
    return `This token settles through NEAR Intents and can't be withdrawn to an address yet. No funds left your account — try a different token, and contact support if you need this one out.`;
  }
  const minimum = raw.match(/minimum is ([\d.]+)\s+([A-Za-z0-9._-]+)/i);
  if (minimum) {
    return `The amount is below the minimum for this route. Try at least ${minimum[1]} ${minimum[2]}.`;
  }
  if (/not registered|doesn't have enough balance for storage|storage_deposit/.test(r)) {
    return `The destination account isn't set up to receive ${symbol}. It has to be registered first — then retry the withdrawal.`;
  }
  if (/insufficient|not enough balance|notenoughbalance|exceeded the balance/.test(r)) {
    return `You don't have enough ${symbol} to cover the amount plus network fees. Lower the amount and try again.`;
  }
  if (/does not exist|account.*not found|unknown account/.test(r)) {
    return `The destination account doesn't exist. Double-check the address and try again.`;
  }
  if (rail === 'native') {
    return `${symbol} can't be sent on this route right now. No funds left your account — please try again, or contact support if it keeps failing.`;
  }
  return `The withdrawal couldn't be completed and no funds left your account. Please try again, or contact support with the withdrawal id if it keeps failing.`;
}

/**
 * Withdrawable balance for a user in one asset:
 *   sum(claimed payments for this user, this asset)
 *   - sum(withdrawals in COMPLETED or PENDING state)
 *
 * Matches the reservation query in /api/claim/withdraw exactly so the preview
 * and the authoritative check can never disagree.
 */
async function getWithdrawableBalance(
  env: AppContext['Bindings'],
  session: Session,
  asset: string
): Promise<number> {
  return await nearRpc.getUserAvailableBalance(env, session, asset);
}

/**
 * Formats a JS number as a plain (non-exponential) decimal string. `String(n)`
 * yields "1e-7" for dust, which `toBaseUnits` mis-parses and BigInt then
 * throws on — failing a legitimate "withdraw all" of a small balance.
 * `toFixed(18)` never produces exponent form; trailing zeros are trimmed.
 */
function toPlainDecimalString(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toFixed(18).replace(/\.?0+$/, '') || '0';
}

/**
 * GET /api/claim/withdrawal/:id
 * Public, share-safe receipt for a wallet send / withdrawal. The id is an
 * unguessable `wth_…` UUID, so possessing the link is the capability — the
 * same model as claim links. Only non-sensitive receipt fields are returned.
 */
claimRouter.get('/withdrawal/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^wth_[A-Za-z0-9-]{1,64}$/.test(id)) {
    return c.json<ErrorResponse>({ error: 'Receipt not found', code: 'NOT_FOUND' }, 404);
  }
  try {
    const row = await c.env.DB.prepare(
      `SELECT id, x_handle, destination_address, asset, amount, tx_hash, status, error, created_at
         FROM withdrawals WHERE id = ?`
    )
      .bind(id)
      .first<{
        id: string;
        x_handle: string | null;
        destination_address: string;
        asset: string;
        amount: string;
        tx_hash: string | null;
        status: string;
        error: string | null;
        created_at: string;
      }>();

    if (!row) {
      return c.json<ErrorResponse>({ error: 'Receipt not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json({
      id: row.id,
      fromHandle: row.x_handle,
      destinationAddress: row.destination_address,
      asset: row.asset,
      amount: row.amount,
      txHash: row.tx_hash,
      status: row.status,
      // Only the stored human-readable explanation — never raw RPC internals.
      failureReason: row.status === 'FAILED' ? row.error : null,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[withdrawal receipt] failed:', err);
    return c.json<ErrorResponse>(
      { error: 'Receipt lookup failed', code: 'RECEIPT_LOOKUP_FAILED' },
      500
    );
  }
});

/**
 * GET /api/claim/pending
 * Returns pending escrow payments matching the logged-in user's X handle
 */
claimRouter.get('/pending', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const userHandle = session.x_handle.toLowerCase();

    // Auto-discover any newly arrived launchpad creator fees on escrow.uprail.near
    // for this handle via NEAR_RPC_URL (throttled to once every 15s per handle).
    try {
      const syncLockKey = `fees:autosync:${userHandle}`;
      const recentlySynced = c.env.CACHE ? await c.env.CACHE.get(syncLockKey) : null;
      if (!recentlySynced) {
        if (c.env.CACHE) {
          await c.env.CACHE.put(syncLockKey, '1', { expirationTtl: 60 }).catch(() => {});
        }
        await syncAllLaunchpadFees(c.env, { handle: userHandle, maxTokens: 6 });
      }
    } catch (syncErr) {
      console.warn('[claim/pending] launchpad fee auto-sync skipped:', syncErr);
    }

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM payments
      WHERE (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = ?))
        AND status = 'ESCROWED'
      ORDER BY created_at DESC
    `
    )
      .bind(session.x_id, userHandle)
      .all<Payment>();

    return c.json({ payments: results || [] });
  } catch (err: any) {
    console.error('Fetch pending payments error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to fetch pending payments', code: 'FETCH_PENDING_ERROR' },
      500
    );
  }
});

/**
 * GET /api/claim/register-options
 * Generates WebAuthn registration options for P-256 passkey creation
 */
claimRouter.get('/register-options', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const rpId = resolveRpId(c.env);
    const rpName = c.env.WEBAUTHN_RP_NAME || 'UPRAIL';

    // Existing credentials for this user, so the authenticator refuses to mint
    // a duplicate passkey for the same device (InvalidStateError) — and the
    // client can surface "sign in instead" rather than creating a second row.
    let excludeCredentials: Array<{ id: string; transports?: string[] }> = [];
    if (c.env.DB) {
      try {
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
              /* ignore malformed transports */
            }
            return { id: r.credential_id, transports };
          });
      } catch (err) {
        console.warn('register-options excludeCredentials lookup failed:', err);
      }
    }

    const options = await webauthn.generateRegistrationOptions({
      userId: session.x_id,
      userName: session.x_handle,
      rpId,
      rpName,
      excludeCredentials,
    });

    // Store challenge via challengeService (zero KV writes)
    await storeChallenge(c.env, {
      key: `webauthn_reg:${session.x_id}`,
      challenge: options.challenge,
      xId: session.x_id,
      purpose: 'registration',
      ttlSeconds: 300,
    });

    return c.json(options);
  } catch (err: any) {
    console.error('Generate WebAuthn options error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to generate registration options', code: 'WEBAUTHN_OPTIONS_ERROR' },
      500
    );
  }
});

/**
 * POST /api/claim/register
 * Verifies WebAuthn attestation, proxies to Go container for confidential NEAR account creation,
 * links account to X identity
 */
claimRouter.post('/register', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const body = await c.req.json<RegisterPasskeyRequest>().catch(() => null);

    if (!body || !body.attestation) {
      return c.json<ErrorResponse>(
        { error: 'Missing WebAuthn attestation payload', code: 'INVALID_REQUEST' },
        400
      );
    }

    // Registration is the one place a passkey row can be created. Guard it so
    // an X-only session cannot mint a replacement credential for an account
    // that already has one:
    //   - first passkey: allowed (normal onboarding)
    //   - recovery code consumed: allowed, then all older passkeys are revoked
    //   - already registered: only a session verified after the newest
    //     credential was created may add another device
    let existingPasskeys = 0;
    let newestPasskeyAt = 0;
    if (c.env.DB) {
      try {
        const row = await c.env.DB.prepare(
          'SELECT COUNT(*) AS count, COALESCE(MAX(created_at), 0) AS newest FROM passkeys WHERE x_id = ?'
        )
          .bind(session.x_id)
          .first<{ count: number; newest: number }>();
        existingPasskeys = Number(row?.count) || 0;
        newestPasskeyAt = Number(row?.newest) || 0;
      } catch (err) {
        console.warn('Passkey registration lookup failed:', err);
      }
    }

    const recoveryWindow = 10 * 60 * 1000;
    const recoveryAuthorized =
      session.recovery_authorized === true &&
      typeof session.recovery_authorized_at === 'number' &&
      Date.now() - session.recovery_authorized_at <= recoveryWindow;

    if (existingPasskeys > 0 && !recoveryAuthorized) {
      const verifiedAt = Number(session.passkey_verified_at) || 0;
      if (session.passkey_verified !== true || verifiedAt < newestPasskeyAt) {
        return c.json<ErrorResponse>(
          {
            error: 'Confirm with your current passkey before adding another device.',
            code: 'PASSKEY_CONFIRMATION_REQUIRED',
          },
          403
        );
      }
    }

    // Retrieve expected challenge strictly from server cache (fail-closed, single-use, zero KV writes)
    const expectedChallenge = await consumeChallenge(c.env, {
      key: `webauthn_reg:${session.x_id}`,
      purpose: 'registration',
    });

    if (!expectedChallenge) {
      return c.json<ErrorResponse>(
        {
          error: 'WebAuthn challenge expired, missing, or already consumed',
          code: 'CHALLENGE_EXPIRED',
        },
        400
      );
    }

    // Verify attestation with the same origin/rpId policy used for login:
    // the configured origin exactly (localhost ports allowed in local dev).
    const verification = await webauthn.verifyRegistration({
      attestation: body.attestation,
      expectedChallenge,
      expectedOrigin: allowedWebAuthnOrigins(c.env),
      expectedRPID: allowedWebAuthnRpIds(c.env),
    });

    // A credential is permanently bound to the identity that first registered
    // it. Refuse to re-home an existing credential to another X account, even
    // if a client submits it through a different authenticated session.
    if (c.env.DB) {
      const owner = await c.env.DB.prepare(
        'SELECT x_id FROM passkeys WHERE credential_id = ?'
      )
        .bind(verification.credentialId)
        .first<{ x_id: string }>();
      if (owner && owner.x_id !== session.x_id) {
        return c.json<ErrorResponse>(
          {
            error: 'This passkey is already linked to a different UPRAIL account.',
            code: 'ACCOUNT_MISMATCH',
          },
          409
        );
      }
    }

    // Resolve deterministic, authentic confidential sub-account for user
    // Fully provisions subaccount and registers authentic keys on intents.near
    const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
    const now = Date.now();
    const passkeyId = crypto.randomUUID();

    // Persist passkey + link the resolved vault account in D1
    if (c.env.DB) {
      await c.env.DB.prepare(
        `
        INSERT INTO passkeys (
          id,
          x_id,
          credential_id,
          public_key,
          counter,
          transports,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(credential_id) DO UPDATE SET
          public_key = excluded.public_key,
          counter = excluded.counter
      `
      )
        .bind(
          passkeyId,
          session.x_id,
          verification.credentialId,
          verification.publicKeyHex,
          verification.counter,
          JSON.stringify(body.attestation.response?.transports || []),
          now
        )
        .run();

      // A recovery registration is a reset: the old credential is presumed
      // lost, so revoke every other passkey for this identity. The newly
      // inserted credential is the only one allowed to survive.
      if (recoveryAuthorized) {
        await c.env.DB.prepare(
          'DELETE FROM passkeys WHERE x_id = ? AND credential_id != ?'
        )
          .bind(session.x_id, verification.credentialId)
          .run();
      }

      await c.env.DB.prepare(
        `
        UPDATE x_identities
        SET near_account = COALESCE(near_account, ?),
            updated_at = ?
        WHERE x_id = ?
      `
      )
        .bind(nearAccount, now, session.x_id)
        .run();
    }

    // 3. Update the active session cookie: this device has now proven the
    // passkey, and any recovery grant is single-use.
    await updateSession(c, {
      near_account: nearAccount,
      passkey_verified: true,
      passkey_verified_at: now,
      recovery_authorized: false,
      recovery_authorized_at: undefined,
    });

    // New users get their recovery codes at the same moment they create the
    // first passkey. Existing users keep whatever batch they already saved.
    try {
      await ensureRecoveryCodes(c.env, session.x_id);
    } catch (recoveryErr) {
      console.warn('Recovery-code generation skipped:', recoveryErr);
    }

    // Signup completes with the first passkey — provision the intent account
    // now rather than on the user's first balance read.
    background(
      c.executionCtx,
      nearRpc.ensureIntentAccount(c.env, {
        x_id: session.x_id,
        x_handle: session.x_handle,
        near_account: nearAccount,
      }),
      'intent account provisioning (passkey)'
    );

    return c.json<RegisterPasskeyResponse>({
      success: true,
      nearAccount,
      credentialId: verification.credentialId,
    });
  } catch (err: any) {
    console.error('Passkey registration error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Passkey registration failed: ${publicErrorMessage(err, 'Internal error')}`,
        code: 'REGISTRATION_FAILED',
      },
      500
    );
  }
});

/**
 * POST /api/claim/execute
 * Claims pending payments for authenticated recipient using their registered NEAR account.
 *
 * SECURITY: Requires both session auth AND passkey authorization.
 * The client must include `passkeyAssertion` in the body.
 */
claimRouter.post('/execute', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    // Body was already parsed by requirePasskeyAuth()
    const body = (c.get('parsedBody' as any) || await c.req.json<ClaimExecuteRequest>().catch(() => null)) as ClaimExecuteRequest | null;

    if (!body || !Array.isArray(body.paymentIds) || body.paymentIds.length === 0) {
      return c.json<ErrorResponse>(
        { error: 'Missing or empty paymentIds array', code: 'INVALID_REQUEST' },
        400
      );
    }

    // Resolve recipient virtual intent account ($0 onboarding cost)
    const recipientNearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

    // A claim is a brand-new user's onboarding moment: authorize their signing
    // key on the verifier contract now, so their first send/withdrawal never has
    // to register mid-flight (where a lost race would strand the balance). This
    // is best-effort — the intent rails re-assert registration before signing —
    // but doing it here means a new user is ready before they touch a balance.
    try {
      const recipientDerived = await nearRpc.deriveUserNearKeypair(c.env, session.x_id);
      const keyReady = await nearRpc.ensureKeyOnIntents(
        c.env,
        recipientNearAccount,
        recipientDerived.publicKey,
        recipientDerived.privateKey
      );
      if (!keyReady.registered) {
        console.warn(
          `[claim/execute] signing-key registration did not land for ${recipientNearAccount}: ${keyReady.reason}`
        );
      }
    } catch (keyErr) {
      console.warn('[claim/execute] signing-key registration failed:', keyErr);
    }

    const results: ClaimExecuteResult[] = [];
    const normalizedUserHandle = session.x_handle.toLowerCase();

    for (const paymentId of body.paymentIds) {
      let payment: Payment | null = null;
      // Declared outside the try so the catch can distinguish "settlement was
      // obtained" (funds may have moved — never revert) from "threw before any
      // settlement" (safe to release the reservation).
      let claimResponse: { payment: Payment; txHash: string } | undefined;
      try {
        // Fetch payment record from D1
        payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
          .bind(paymentId)
          .first<Payment>();

        if (!payment) {
          results.push({
            paymentId,
            status: PaymentStatus.PENDING,
            error: 'Payment not found',
          });
          continue;
        }

        // Validate recipient: prefer the immutable x_id captured at send time,
        // fall back to handle only for payments created before it existed.
        const isRecipient = payment.recipient_x_id
          ? payment.recipient_x_id === session.x_id
          : payment.recipient_handle.toLowerCase() === normalizedUserHandle;
        if (!isRecipient) {
          results.push({
            paymentId,
            status: payment.status,
            error: 'Payment recipient does not match authenticated X user',
          });
          continue;
        }

        // Only ESCROWED payments are claimable: PENDING/DEPOSIT_WAITING rows
        // are in-flight sends whose funds may not have moved yet — claiming
        // them in that window could pull from the pooled escrow before the
        // sender was ever debited.
        if (payment.status === PaymentStatus.CLAIMED) {
          results.push({
            paymentId,
            status: PaymentStatus.CLAIMED,
            txHash: payment.claim_tx_hash || undefined,
            error: 'Payment already claimed',
          });
          continue;
        }
        if (payment.status !== PaymentStatus.ESCROWED) {
          results.push({
            paymentId,
            status: payment.status,
            error: `Payment is not claimable in status ${payment.status}`,
          });
          continue;
        }

        // Atomically reserve the claim BEFORE moving funds so two concurrent
        // claim requests can never both reach the settlement service.
        let reserved = false;
        if (c.env.DB) {
          try {
            const reservation = await c.env.DB.prepare(
              `UPDATE payments
                 SET status = ?,
                     recipient_x_id = COALESCE(recipient_x_id, ?),
                     updated_at = ?
               WHERE id = ?
                 AND status = ?`
            )
              .bind(
                PaymentStatus.CLAIMED,
                session.x_id,
                Date.now(),
                paymentId,
                PaymentStatus.ESCROWED
              )
              .run();
            const changes = reservation.meta?.changes ?? 0;
            reserved = changes > 0;
            if (!reserved) {
              results.push({
                paymentId,
                status: PaymentStatus.CLAIMED,
                error: 'Payment was claimed by another request',
              });
              continue;
            }
          } catch (reserveErr) {
            console.warn('[claim/execute] reservation failed, aborting claim:', reserveErr);
            results.push({
              paymentId,
              status: payment.status,
              error: 'Could not reserve payment for claiming',
            });
            continue;
          }
        }

        if (c.env.ESCROW) {
          const doId = c.env.ESCROW.idFromName(paymentId);
          const stub = c.env.ESCROW.get(doId) as any;

          if (typeof stub.claim === 'function') {
            claimResponse = await stub.claim(recipientNearAccount);
          } else {
            const resp = await stub.fetch(
              new Request('http://escrow/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipientNearAccount }),
              })
            );

            if (!resp.ok) {
              const errJson = (await resp.json().catch(() => ({}))) as any;
              throw new Error(errJson.error || `DO claim failed with HTTP ${resp.status}`);
            }
            claimResponse = await resp.json();
          }
        } else if (
          isConfidentialRailEnabled(c.env) &&
          payment.privacy_rail === 'confidential'
        ) {
          // Private claim: escrow pays the recipient's Confidential Intents
          // account, so the payout is not linkable to the original sender.
          // `payEscrowPrivate` uses escrow's confidential balance first, or
          // shields from escrow's public/plain balance when claiming creator fees.
          const payout = await payEscrowPrivate(c.env, {
            asset: payment.asset,
            amount: payment.amount,
            recipientAccount: recipientNearAccount,
          });
          const normalized = String(payout.status || 'UNKNOWN').toUpperCase();
          if (normalized === 'SUCCESS') {
            claimResponse = {
              payment: {
                ...payment,
                status: PaymentStatus.CLAIMED,
                claim_tx_hash: payout.intentHash,
                claim_deposit_address: payout.depositAddress,
                settlement_status: 'SUCCESS',
                updated_at: Date.now(),
              },
              txHash: payout.intentHash,
            };
          } else if (normalized === 'FAILED' || normalized === 'REFUNDED') {
            throw new Error(`Confidential claim ${normalized.toLowerCase()} — no funds moved to the recipient`);
          } else {
            // Funds may have moved; keep the CLAIMED reservation so a retry
            // cannot double-pay. Reconciliation will resolve the status.
            claimResponse = {
              payment: {
                ...payment,
                status: PaymentStatus.CLAIMED,
                claim_tx_hash: payout.intentHash,
                claim_deposit_address: payout.depositAddress,
                settlement_status: normalized,
                updated_at: Date.now(),
              },
              txHash: payout.intentHash,
            };
            try {
              await c.env.DB.prepare(
                `UPDATE payments
                    SET claim_tx_hash = ?, claim_deposit_address = ?, settlement_status = ?, updated_at = ?
                  WHERE id = ?`
              )
                .bind(
                  payout.intentHash,
                  payout.depositAddress,
                  normalized,
                  Date.now(),
                  paymentId
                )
                .run();
            } catch (dbErr) {
              console.warn('[claim/execute] could not persist confidential claim state:', dbErr);
            }
            results.push({
              paymentId,
              status: PaymentStatus.CLAIMED,
              error: `Confidential claim status is ${normalized} — quote payment id ${paymentId} to support`,
            });
            continue;
          }
        } else {
          // Authentic Onchain settlement: transfer tokens from escrow.uprail.near to recipient on intents.near!
          let txHash: string | null = null;
          try {
            const escrowTransfer = await nearRpc.executeTransferFromEscrowIntent(
              c.env,
              recipientNearAccount,
              payment.asset,
              payment.amount
            );
            if (escrowTransfer?.success && escrowTransfer.txHash) {
              txHash = escrowTransfer.txHash;
            } else if (escrowTransfer?.ambiguous) {
              // The broadcast may have landed (network error after submit).
              // Keep the CLAIMED reservation — reverting would let a retry
              // double-pay the recipient from the pooled escrow.
              console.error(
                `[claim/execute] CRITICAL: ambiguous escrow transfer for ${paymentId}:`,
                escrowTransfer?.error
              );
              results.push({
                paymentId,
                status: PaymentStatus.CLAIMED,
                error: `Transfer status unknown — quote payment id ${paymentId} to support`,
              });
              continue;
            } else {
              // Meme assets were locked into escrow as a plain NEP-141 balance
              // rather than an intents ledger entry, so the intent cannot
              // spend them — pay out with a plain ft_transfer instead.
              const plainPayout = await nearRpc.executeEscrowFtWithdraw(
                c.env,
                recipientNearAccount,
                payment.asset,
                payment.amount
              );
              if (plainPayout?.success && plainPayout.txHash) {
                txHash = plainPayout.txHash;
              } else {
                console.error(
                  '[claim/execute] plain escrow payout failed:',
                  plainPayout?.error,
                  '| intents error:',
                  escrowTransfer?.error
                );
                throw new Error(
                  `Onchain settlement failed: ${plainPayout?.error || escrowTransfer?.error || 'escrow transfer error'}`
                );
              }
            }
          } catch (tErr: any) {
            console.error('[claim/execute] onchain escrow transfer failed:', tErr);
            throw new Error(`Onchain settlement failed: ${tErr.message || 'escrow transfer error'}`);
          }

          // A NEAR-native meme cannot be left on the intents ledger. Its token
          // contract has never registered storage on intents.near, so the
          // credit above is transient — the durable, spendable balance is the
          // plain NEP-141 balance on the recipient's own account, which is what
          // FastNEAR's FT index (and therefore the balance panel and the Send
          // picker) actually reads. Drop it to native now, the same place a
          // deposit lands.
          //
          // Warning-only: the recipient is already paid. Failing to drop must
          // never roll back a settled claim.
          try {
            const drop = await nearRpc.dropNearNativeMemeToNative(
              c.env,
              session.x_id,
              recipientNearAccount,
              payment.asset,
              payment.amount
            );
            if (drop.dropped) {
              console.log(
                `[claim/execute] ${paymentId}: NEAR-native meme dropped to native balance, tx ${drop.txHash}`
              );
            } else if (drop.reason && drop.reason !== 'NOT_A_NEAR_NATIVE_MEME' && drop.reason !== 'INTENTS_BALANCE_NOT_PRESENT') {
              console.warn(
                `[claim/execute] ${paymentId}: meme drop to native skipped (${drop.reason}) — recipient keeps the intents credit`
              );
            }
          } catch (dropErr: any) {
            console.warn(
              `[claim/execute] ${paymentId}: meme drop to native failed:`,
              dropErr?.message || dropErr
            );
          }

          claimResponse = {
            payment: {
              ...payment,
              status: PaymentStatus.CLAIMED,
              claim_tx_hash: txHash,
              updated_at: Date.now(),
            },
            txHash,
          };
        }

        // Settle the protocol fee now that the recipient has been paid.
        // Warn-only on purpose: the fee is held in escrow until claim (it
        // rides the same pooled balance), and a stuck fee must never roll back
        // an already-settled claim. The outcome is still recorded on the row —
        // a fee that silently never arrives is indistinguishable from one that
        // was never attempted, which is how fees.uprail.near stayed at zero
        // even through two claimed payments.
        //
        // When the fee destination IS the escrow holding account there is
        // nothing to move: the gross was deposited at send time and the
        // recipient has just taken their net out, so the fee simply stays put.
        // Emitting a transfer intent here would be a self-transfer, which
        // intents rejects — and which previously showed up as a dispatch
        // failure that nobody could see.
        const feeAmount = parseFloat(payment.fee || '0') || 0;
        if (feeAmount > 0) {
          const feeRecipient = c.env.FEE_ACCOUNT_ID || 'escrow.uprail.near';
          const escrowAccount = c.env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
          let feeDispatchStatus: string;
          let feeDispatchError: string | null = null;

          if (feeRecipient === escrowAccount) {
            feeDispatchStatus = 'retained';
          } else {
            feeDispatchStatus = 'failed';
            try {
              const feeResult = await nearRpc.executeTransferFromEscrowIntent(
                c.env,
                feeRecipient,
                payment.asset,
                payment.fee || '0'
              );
              if (feeResult?.success) {
                feeDispatchStatus = 'sent';
              } else {
                feeDispatchError = feeResult?.error || 'escrow fee transfer failed';
                console.error(
                  `[claim/execute] CRITICAL: fee dispatch failed for ${paymentId} (${payment.fee} ${payment.asset}):`,
                  feeResult?.error
                );
              }
            } catch (feeErr: any) {
              feeDispatchError = feeErr?.message || String(feeErr);
              console.error(`[claim/execute] CRITICAL: fee dispatch error for ${paymentId}:`, feeErr);
            }
          }

          if (c.env.DB) {
            try {
              await c.env.DB.prepare(
                'UPDATE payments SET fee_dispatch_status = ?, fee_dispatch_error = ?, updated_at = ? WHERE id = ?'
              )
                .bind(feeDispatchStatus, feeDispatchError, Date.now(), paymentId)
                .run();
            } catch (feeDbErr) {
              console.error(`[claim/execute] could not record fee dispatch for ${paymentId}:`, feeDbErr);
            }
          }
        }

        // If payment carries an invite code and recipient is claiming, auto-activate recipient
        if (payment.invite_code) {
          try {
            await redeemInvite(c.env, payment.invite_code, {
              x_id: session.x_id,
              x_handle: session.x_handle,
            });
          } catch (inviteErr) {
            // The recipient is already paid; a failed redemption must not roll
            // the claim back, but it must not be invisible either.
            console.warn(
              `[claim/execute] invite ${payment.invite_code} redemption failed for ${paymentId}:`,
              inviteErr
            );
          }
        }

        // Persist the settlement tx hash on the already-reserved row.
        if (c.env.DB) {
          try {
            if (claimResponse!.payment.settlement_status) {
              await c.env.DB.prepare(
                `UPDATE payments
                    SET claim_tx_hash = ?,
                        claim_deposit_address = COALESCE(?, claim_deposit_address),
                        settlement_status = COALESCE(?, settlement_status),
                        confirmed_at = CASE WHEN ? = 'SUCCESS' THEN ? ELSE confirmed_at END,
                        updated_at = ?
                  WHERE id = ?`
              )
                .bind(
                  claimResponse!.txHash,
                  claimResponse!.payment.claim_deposit_address || null,
                  claimResponse!.payment.settlement_status || null,
                  claimResponse!.payment.settlement_status || null,
                  Date.now(),
                  Date.now(),
                  paymentId
                )
                .run();
            } else {
              await c.env.DB.prepare(
                'UPDATE payments SET claim_tx_hash = ?, updated_at = ? WHERE id = ?'
              )
                .bind(claimResponse!.txHash, Date.now(), paymentId)
                .run();
            }
          } catch (dbErr) {
            console.warn('[claim/execute] D1 payment update failed:', dbErr);
          }
        }

        results.push({
          paymentId,
          status: PaymentStatus.CLAIMED,
          txHash: claimResponse!.txHash,
        });
      } catch (err: any) {
        console.error(`Claim error on payment ${paymentId}:`, err);
        // Only roll the reservation back when NO settlement was obtained. If
        // claimResponse is set, the transfer may already have moved funds —
        // reverting to ESCROWED would re-enable a second claim from the
        // pooled escrow.
        if (!claimResponse && payment && c.env.DB) {
          try {
            await c.env.DB.prepare(
              `UPDATE payments SET status = ?, updated_at = ? WHERE id = ? AND status = ?`
            )
              .bind(payment.status, Date.now(), paymentId, PaymentStatus.CLAIMED)
              .run();
          } catch (revertErr) {
            console.error(`[claim/execute] revert failed for ${paymentId}:`, revertErr);
          }
        }
        results.push({
          paymentId,
          status: payment?.status || PaymentStatus.ESCROWED,
          error: publicErrorMessage(err, 'Claim transfer failed'),
        });
      }
    }

    return c.json<ClaimExecuteResponse>({ results });
  } catch (err: any) {
    console.error('Execute claims error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Claim execution failed'), code: 'CLAIM_FAILED' },
      500
    );
  }
});

/**
 * GET /api/claim/balance
 * Returns confidential token balances for the authenticated user's virtual vault.
 * Queries both onchain balances from intents.near and local virtual escrow database
 * so un-withdrawn claimed payments reflect immediately.
 */
claimRouter.get('/balance', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
    const filterAsset = c.req.query('asset')?.toLowerCase();

    // Format into ShieldedBalance[] expected by frontend.
    const tokens = await nearRpc.getSupportedTokens(c.env).catch(() => [] as nearRpc.OnchainToken[]);

    const canonicalKey = (asset: string): string => {
      const matched = nearRpc.resolveTokenForAsset(asset, tokens);
      return (matched?.defuse_asset_id || asset || '').toLowerCase();
    };

    // Net balance calculation per asset
    const netBalances: Record<string, number> = {};
    const addAmount = (asset: string, delta: number) => {
      const key = canonicalKey(asset);
      if (!key) return;
      netBalances[key] = (netBalances[key] || 0) + delta;
    };

    // 1. Live onchain balances (intents + plain pk-subaccount balances)
    let onchainBalances: nearRpc.IntentAccountBalance[] = [];
    try {
      onchainBalances = await nearRpc.getIntentBalances(c.env, nearAccount);
    } catch {}
    for (const ob of onchainBalances) {
      addAmount(ob.defuse_asset_id || ob.symbol, parseFloat(ob.amountFormatted) || 0);
    }
    try {
      const plainBalances = await nearRpc.getPlainBalances(c.env, nearAccount);
      for (const pb of plainBalances) {
        addAmount(pb.defuse_asset_id || pb.symbol, parseFloat(pb.amountFormatted) || 0);
      }
    } catch {}

    // 2. D1 virtual deltas — the SAME canonical algorithm as
    //    getUserAvailableBalance (synthetic-claim guards etc.). The old
    //    hand-rolled version here skipped those guards and double-counted
    //    onchain-settled payments into phantom balance.
    const deltas = await nearRpc.getVirtualBalanceDeltas(c.env, session);
    for (const [asset, delta] of Object.entries(deltas)) {
      addAmount(asset, delta);
    }

    // 3. Confidential Intents balances are spendable but never appear in the
    //    public intent/plain reads above. Merge them here, minus any pending
    //    confidential withdrawal that is already in flight.
    if (isConfidentialRailEnabled(c.env)) {
      try {
        const confidential = await getConfidentialBalances(c.env, session.x_id);
        let pendingConfidential: Array<{ asset: string; amount: string }> = [];
        try {
          const pending = await c.env.DB.prepare(
            `SELECT asset, amount FROM withdrawals
              WHERE x_id = ? AND privacy_rail = 'confidential' AND status = 'PENDING'`
          )
            .bind(session.x_id)
            .all<{ asset: string; amount: string }>();
          pendingConfidential = pending.results || [];
        } catch {}
        for (const cb of confidential) {
          let amount = parseFloat(cb.amountFormatted) || 0;
          for (const row of pendingConfidential) {
            if (
              nearRpc.assetsMatch(row.asset, cb.assetId) ||
              nearRpc.assetsMatch(row.asset, cb.symbol)
            ) {
              amount -= parseFloat(row.amount) || 0;
            }
          }
          if (amount > 0) addAmount(cb.assetId, amount);
        }
      } catch (confErr) {
        console.warn('[claim/balance] confidential balance merge skipped:', confErr);
      }
    }

    // Cap net balances at 0
    for (const k of Object.keys(netBalances)) {
      netBalances[k] = Math.max(0, netBalances[k]);
    }

    let shieldedBalances = Object.entries(netBalances)
      .filter(([_, amt]) => amt > 0)
      .map(([assetKey, amt]) => {
        const matchedToken = nearRpc.resolveTokenForAsset(assetKey, tokens);
        const symbol = matchedToken?.symbol || assetKey.split(':').pop()?.toUpperCase() || assetKey.toUpperCase();
        // Live registry price only. No peg pins, no made-up numbers: an asset
        // without a price reports null and the UI renders it as "—".
        const priceUsd = matchedToken?.priceUsd;
        return {
          token: {
            id: assetKey,
            symbol,
            name: matchedToken?.name || symbol,
            decimals: matchedToken?.decimals ?? (assetKey.includes('wrap.near') ? 24 : 18),
            iconUrl: matchedToken?.icon || '',
            priceUsd,
            chain: matchedToken?.chain || 'near',
            nearContractId: matchedToken?.nearContractId || '',
          },
          amount: amt >= 0.01 ? amt.toFixed(2) : String(amt),
          amountUsd: typeof priceUsd === 'number' ? amt * priceUsd : null,
        };
      });

    if (filterAsset) {
      shieldedBalances = shieldedBalances.filter(
        (b) => b.token.id.toLowerCase() === filterAsset || b.token.symbol.toLowerCase() === filterAsset
      );
    }

    // Partial totals are lies: if any holding is unpriced the whole total is
    // reported as unknown instead of a confidently low number.
    const totalUsd = shieldedBalances.some((b) => b.amountUsd === null)
      ? null
      : shieldedBalances.reduce((acc, b) => acc + (b.amountUsd || 0), 0);

    return c.json({
      nearAccount,
      balances: shieldedBalances,
      totalUsd,
      source: 'virtual_escrow',
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('Balance read error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to read confidential balance: ${publicErrorMessage(err, 'Internal error')}`,
        code: 'BALANCE_ERROR',
      },
      500
    );
  }
});

/**
 * GET /api/claim/confidential-balance
 * Reads the user's Confidential Intents balances through a User-Session
 * token. Disabled unless CONFIDENTIAL_RAIL_ENABLED is explicitly on.
 */
claimRouter.get('/confidential-balance', requireAuth({ passkeyVerified: true }), async (c) => {
  if (!isConfidentialRailEnabled(c.env)) {
    return c.json<ErrorResponse>(
      { error: 'Confidential balance rail is not enabled', code: 'RAIL_DISABLED' },
      404
    );
  }
  try {
    const session = c.get('session')!;
    const balances = await getConfidentialBalances(c.env, session.x_id);
    return c.json({
      balances,
      source: 'confidential_intents',
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('Confidential balance read error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to read confidential balance: ${publicErrorMessage(err, 'Internal error')}`,
        code: 'BALANCE_ERROR',
      },
      500
    );
  }
});

/**
 * GET /api/claim/withdraw-chains?asset=<defuse id or symbol>
 * Destination networks the asset can settle to, resolved live from 1Click.
 * Drives the Send-screen network picker so it never falls behind what the
 * solver actually supports (Sui, Robinhood, new L2s, …).
 */
claimRouter.get('/withdraw-chains', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const asset = c.req.query('asset') || 'usdc';
    const chains = await getWithdrawChains(c.env, asset);
    return c.json({ asset, chains });
  } catch (err) {
    console.error('[withdraw-chains] failed:', err);
    return c.json({ asset: c.req.query('asset') || 'usdc', chains: [] });
  }
});

/**
 * POST /api/claim/withdraw
 * Withdraws funds from virtual escrow vault to an external address (NEAR, EVM, Solana, Bitcoin).
 * Atomically relays a 1Click transfer from escrow pool.
 *
 * SECURITY: requires session auth AND passkey authorization — a withdrawal
 * moves real funds, so it is gated exactly like send and claim.
 */
claimRouter.post('/withdraw', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), (c) =>
  handleWithdraw(c)
);

/**
 * Confidential withdrawal path: the user's Confidential Intents balance is
 * spent by a signed 1Click intent, never by a public Intents transfer.
 */
async function handleConfidentialWithdraw(
  c: Context<AppContext>,
  session: Session,
  params: {
    destinationAddress: string;
    asset: string;
    destinationChain?: string;
    amount?: string;
  }
): Promise<Response> {
  const balance = await getConfidentialAssetBalance(c.env, session.x_id, params.asset);
  const support = await nearRpc.isIntentsSupportedAsset(c.env, balance.contractId);
  if (support === false) {
    return c.json<ErrorResponse>(
      {
        error: `${balance.symbol} can only be sent on the public rail because its token contract does not support Intents.`,
        code: 'PRIVATE_RAIL_UNAVAILABLE',
      },
      400
    );
  }
  if (support === null) {
    return c.json<ErrorResponse>(
      { error: 'Could not verify the private rail for this asset — please try again.', code: 'RAIL_UNAVAILABLE' },
      503
    );
  }

  // Existing balances may still be public (Intents or plain). Read the full
  // spendable amount so `all` is not limited to the confidential slice, then
  // shield only the shortfall before signing the withdrawal.
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
  const publicHolding = await nearRpc.getIntentAssetBalance(c.env, params.asset, nearAccount).catch(
    () => null
  );
  const plainBalances = await nearRpc.getPlainBalances(c.env, nearAccount).catch(() => []);
  const plainAtomic = plainBalances
    .filter(
      (b) =>
        nearRpc.assetsMatch(b.defuse_asset_id, balance.assetId) ||
        nearRpc.assetsMatch(b.nearContractId, balance.contractId)
    )
    .reduce((sum, b) => sum + BigInt(b.amount || '0'), 0n);
  const totalAtomic = balance.amountAtomic + (publicHolding?.balance ?? 0n) + plainAtomic;

  let amountStr: string;
  if (params.amount && params.amount !== 'all') {
    const raw = params.amount.trim();
    if (!/^\d{1,15}(\.\d{1,18})?$/.test(raw)) {
      return c.json<ErrorResponse>({ error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' }, 400);
    }
    amountStr = raw;
  } else {
    if (publicHolding === null) {
      return c.json<ErrorResponse>(
        { error: 'Could not read your full balance — please try again.', code: 'RAIL_UNAVAILABLE' },
        503
      );
    }
    amountStr = formatAtomic(totalAtomic.toString(), balance.decimals);
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, balance.decimals));
  } catch {
    return c.json<ErrorResponse>({ error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' }, 400);
  }
  if (amountAtomic <= 0n) {
    return c.json<ErrorResponse>({ error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' }, 400);
  }
  if (publicHolding !== null && amountAtomic > totalAtomic) {
    return c.json<ErrorResponse>(
      {
        error: `Insufficient balance. Available: ${formatAtomic(totalAtomic.toString(), balance.decimals)} ${balance.symbol}`,
        code: 'INSUFFICIENT_FUNDS',
      },
      400
    );
  }

  try {
    await ensureConfidentialFunds(c.env, session.x_id, params.asset, amountAtomic);
  } catch (fundErr: any) {
    const message = String(fundErr?.message || fundErr);
    if (message.startsWith('INSUFFICIENT_FUNDS')) {
      return c.json<ErrorResponse>(
        {
          error: `Insufficient balance. Available: ${formatAtomic(totalAtomic.toString(), balance.decimals)} ${balance.symbol}`,
          code: 'INSUFFICIENT_FUNDS',
        },
        400
      );
    }
    if (message.startsWith('PUBLIC_BALANCE_UNAVAILABLE') || message.startsWith('SHIELD_')) {
      return c.json<ErrorResponse>(
        {
          error: 'Could not shield your balance for a private withdrawal — please try again.',
          code: 'CONFIDENTIAL_UNAVAILABLE',
        },
        503
      );
    }
    throw fundErr;
  }

  const withdrawalId = 'wth_' + crypto.randomUUID();
  const now = Date.now();
  const reserve = await c.env.DB.prepare(
    `INSERT INTO withdrawals
       (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status,
        privacy_rail, settlement_status, rail, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', 'confidential', 'PENDING', 'confidential', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
     )`
  )
    .bind(
      withdrawalId,
      session.x_id,
      session.x_handle,
      params.destinationAddress,
      params.asset,
      amountStr,
      now,
      now,
      session.x_id,
      params.asset
    )
    .run();

  if ((reserve.meta?.changes ?? 0) === 0) {
    return c.json<ErrorResponse>(
      { error: 'A withdrawal for this asset is already in progress', code: 'WITHDRAWAL_IN_PROGRESS' },
      409
    );
  }

  try {
    const result = await submitPrivateWithdrawal(c.env, session.x_id, {
      asset: params.asset,
      amount: amountStr,
      destinationAddress: params.destinationAddress,
      destinationChain: params.destinationChain,
    });
    await c.env.DB.prepare(
      `UPDATE withdrawals
          SET tx_hash = ?, intent_hash = ?, deposit_address = ?, settlement_status = 'SUBMITTED', updated_at = ?
        WHERE id = ?`
    )
      .bind(result.intentHash, result.intentHash, result.depositAddress, Date.now(), withdrawalId)
      .run();
    return c.json(
      {
        withdrawalId,
        status: 'PENDING',
        txHash: result.intentHash,
        intentHash: result.intentHash,
        depositAddress: result.depositAddress,
        privacy: 'confidential',
      },
      202
    );
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 500);
    console.error(
      `[Withdrawal] confidential settlement failed id=${withdrawalId} x=${session.x_handle} asset=${params.asset} reason=${message.slice(0, 200)}`
    );
    await c.env.DB.prepare(
      "UPDATE withdrawals SET status = 'FAILED', error = ?, error_code = 'SETTLEMENT_FAILED', settlement_status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'"
    )
      .bind(message, Date.now(), withdrawalId)
      .run()
      .catch(() => {});
    return c.json<ErrorResponse>(
      {
        error: `Confidential withdrawal failed: ${publicErrorMessage(err, 'settlement failed')}`,
        code: 'SETTLEMENT_FAILED',
        withdrawalId,
      } as ErrorResponse,
      502
    );
  }
}

export async function handleWithdraw(c: Context<AppContext>): Promise<Response> {
  try {
    const session = c.get('session')!;
    // Body was already parsed by requirePasskeyAuth()
    const body = (c.get('parsedBody' as any) || await c.req.json<{
      destinationAddress: string;
      asset?: string;
      amount?: string;
      destinationChain?: string;
      passkeyAssertion?: unknown;
    }>().catch(() => null)) as {
      destinationAddress: string;
      asset?: string;
      amount?: string;
      destinationChain?: string;
      passkeyAssertion?: unknown;
    } | null;

    if (
      !body ||
      !body.destinationAddress ||
      typeof body.destinationAddress !== 'string' ||
      !body.destinationAddress.trim()
    ) {
      return c.json<ErrorResponse>(
        { error: 'destinationAddress is required', code: 'INVALID_REQUEST' },
        400
      );
    }

    const destinationAddress = body.destinationAddress.trim();
    const asset = (body.asset || 'usdc').toLowerCase();

    // An explicit destination network lets the caller disambiguate EVM, where
    // the same 0x address exists on every chain. Reject a network that does
    // not match the address family so we never quote a route the address
    // cannot receive on.
    const destinationChain =
      typeof body.destinationChain === 'string' && body.destinationChain.trim()
        ? body.destinationChain.trim().toLowerCase()
        : undefined;

    // Shape-check addresses only for families we know (NEAR, EVM, Solana,
    // Bitcoin, XRP). For newer 1Click destinations (Starknet, Aptos, TON,
    // Sui, …) let 1Click validate the recipient rather than rejecting it with
    // the wrong regex.
    if (
      (!destinationChain || hasKnownAddressFamily(destinationChain)) &&
      !isValidDestinationAddress(destinationAddress)
    ) {
      return c.json<ErrorResponse>(
        { error: 'destinationAddress is not a valid blockchain address', code: 'INVALID_DESTINATION' },
        400
      );
    }

    // A selected non-NEAR network is always an external withdrawal, even if
    // the address happens to resemble a NEAR account.
    const isNearAccount = destinationChain
      ? destinationChain === 'near'
      : isNearAccountAddress(destinationAddress);

    if (destinationChain !== undefined) {
      if (!chainMatchesAddress(destinationChain, destinationAddress)) {
        return c.json<ErrorResponse>(
          {
            error: 'The destination address does not match the selected network',
            code: 'INVALID_DESTINATION',
          },
          400
        );
      }
    }

    // Confidential rail: spend the user's Confidential Intents balance with a
    // signed 1Click intent for 1Click-supported assets. Non-1Click native NEAR
    // launchpad tokens settle via the NEAR onchain/native withdrawal path below.
    const oneClickSupported = await nearRpc
      .isOneClickSupportedAsset(c.env, asset)
      .catch(() => true);
    if (isConfidentialRailEnabled(c.env) && oneClickSupported) {
      return await handleConfidentialWithdraw(c, session, {
        destinationAddress,
        asset,
        destinationChain,
        amount: body.amount,
      });
    }

    // 1. Read-only balance preview (authoritative check happens in the
    //    reservation query below, inside the same statement).
    const available = await getWithdrawableBalance(c.env, session, asset);

    // Keep ONE decimal string for the reservation row, the 1Click quote and
    // the onchain settlement — float reformatting (toFixed(6)) used to
    // truncate BTC(8)/NEAR(24) amounts and make the quote disagree with the
    // transfer.
    let amountStr: string;
    if (body.amount && body.amount !== 'all') {
      const raw = body.amount.trim();
      // Plain decimal only — parseFloat alone accepted "1e5", "12abc", "Infinity".
      if (!/^\d{1,15}(\.\d{1,18})?$/.test(raw)) {
        return c.json<ErrorResponse>(
          { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
          400
        );
      }
      amountStr = raw;
    } else {
      amountStr = toPlainDecimalString(available);
    }

    const parsedAmount = parseFloat(amountStr);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
        400
      );
    }

    if (parsedAmount > available + 0.0001) {
      return c.json<ErrorResponse>(
        {
          error: `Insufficient shielded balance. Available: ${available.toFixed(6)} ${asset.toUpperCase()}`,
          code: 'INSUFFICIENT_FUNDS',
        },
        400
      );
    }

    console.log(
      `[withdraw] prepare x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} destination=${destinationAddress} chain=${destinationChain || 'auto'}`
    );

    // Plain balance on the sender's own pk account is deposited into intents
    // first — ft_transfer_call with the user's own address as memo — so the
    // 1Click withdrawal can spend directly-received tokens. No-op when the
    // balance already lives inside intents.
    //
    // Launchpad meme assets are the exception: their token contracts have never
    // registered `intents.near` storage, so the deposit panics "The receiver
    // is not registered" and no intent can ever spend a balance that never
    // arrived. For those we settle the whole withdrawal with a plain
    // ft_transfer straight out of the sender's own account.
    let settlementRail: 'intents' | 'native' = 'intents';
    let plainDeposit: { deposited: boolean; txHash?: string; reason?: string } = { deposited: false };
    let nearAccountForDeposit: string | null = null;
    try {
      nearAccountForDeposit = await nearRpc.resolveUserNearAccount(c.env, session);
      const intentHolding = await nearRpc.getIntentAssetBalance(
        c.env,
        asset,
        nearAccountForDeposit
      );
      const coveredByIntents =
        intentHolding !== null &&
        intentHolding.balance >=
          BigInt(nearRpc.toBaseUnits(amountStr, intentHolding.decimals) || '0');

      let plainBefore: bigint | null = null;
      if (coveredByIntents) {
        // The intents ledger already holds this amount. Depositing the same
        // amount again from the user's plain balance only burns gas and can
        // fail outright when the native NEAR balance is too thin to cover a
        // congested 100 TGas ft_transfer_call.
        plainDeposit = { deposited: true };
        console.log(
          `[withdraw] intents already covers x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} — skipping plain deposit`
        );
      } else {
        plainBefore = await nearRpc.getPlainAssetBalance(
          c.env,
          asset,
          nearAccountForDeposit
        );

        plainDeposit = await nearRpc.depositPlainBalanceToIntents(
          c.env,
          session.x_id,
          asset,
          amountStr,
          nearAccountForDeposit
        );
      }

      // Whole-balance NEAR withdraw: the user has native NEAR but no room for
      // the gas needed to wrap it. Explain it up front (400) rather than failing
      // at settlement with "insufficient balance" on an empty intents account.
      if (!plainDeposit.deposited && plainDeposit.reason?.startsWith('NEAR_GAS_RESERVE_SHORTFALL')) {
        const shortfallYocto = BigInt(plainDeposit.reason.split(':')[1] || '0');
        const shortfallNear = Number(shortfallYocto) / 1e24;
        const pretty = shortfallNear > 0 ? shortfallNear.toFixed(4) : '0.03';
        return c.json<ErrorResponse>(
          {
            error: `You're withdrawing your whole NEAR balance — about ${pretty} NEAR has to stay in your wallet to pay network gas. Lower the amount and try again.`,
            code: 'INSUFFICIENT_PLAIN_BALANCE',
          },
          400
        );
      }

      if (!plainDeposit.deposited && plainDeposit.reason?.includes('NotEnoughBalance')) {
        console.warn(
          `[withdraw] insufficient native NEAR for gas x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} reason=${plainDeposit.reason}`
        );
        return c.json<ErrorResponse>(
          {
            error:
              'Not enough native NEAR to cover network gas for this withdrawal. Add a little NEAR to your wallet and try again.',
            code: 'INSUFFICIENT_NATIVE_GAS',
          },
          400
        );
      }

      if (
        !plainDeposit.deposited &&
        plainDeposit.reason &&
        plainDeposit.reason !== 'INSUFFICIENT_PLAIN_BALANCE'
      ) {
        // A broadcast that timed out but landed would otherwise be spent a
        // second time on the fallback rail, so compare the plain balance
        // before switching.
        const landed = await nearRpc.plainBalanceAbsorbed(
          c.env,
          asset,
          nearAccountForDeposit,
          plainBefore,
          amountStr
        );

        if (landed) {
          // The deposit did land — stay on the intents rail.
          plainDeposit = { deposited: true };
        } else if (isTransientRailReason(plainDeposit.reason)) {
          // An RPC/subrequest/read hiccup is NOT "this asset can't use intents".
          // Downgrading on a transient failure switched a cross-chain withdraw to
          // the plain-NEAR rail, which then failed with the misleading "not
          // available for this asset". Fail retryably and leave funds untouched.
          console.warn(
            `[withdraw] transient intents-rail failure x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} destination=${destinationAddress} reason=${plainDeposit.reason}`
          );
          return c.json<ErrorResponse>(
            {
              error:
                'We could not prepare your balance for settlement right now — please try again in a moment.',
              code: 'RAIL_UNAVAILABLE',
            },
            503
          );
        } else {
          console.warn(
            `[withdraw] intents rail unavailable x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} reason=${plainDeposit.reason} — settling with a direct ft_transfer`
          );
          settlementRail = 'native';
        }
      } else if (!plainDeposit.deposited && plainDeposit.reason === 'INSUFFICIENT_PLAIN_BALANCE') {
        // No plain balance to move. Usually the funds already sit in intents
        // (fine), but a whole-balance native-NEAR withdraw also lands here:
        // wrapping needs the amount PLUS a gas reserve, so the deposit is
        // skipped and the later intents ft_withdraw fails on an empty balance.
        // Log the decision so the persisted failure can be traced back to it.
        console.warn(
          `[withdraw] no plain balance to move x=${session.x_id} handle=${session.x_handle} asset=${asset} amount=${amountStr} — settling from intents`
        );
      }
    } catch (plainErr) {
      console.error('[withdraw] settlement rail selection failed:', plainErr);
      return c.json<ErrorResponse>(
        {
          error: `Could not prepare your ${asset.toUpperCase()} balance for settlement: ${
            plainErr instanceof Error ? plainErr.message : String(plainErr)
          } — no funds were moved.`,
          code: 'DEPOSIT_FAILED',
        },
        502
      );
    }

    // 2. Atomically reserve the withdrawal — and refuse a second concurrent
    //    PENDING withdrawal for the same asset (they would race past the
    //    balance check).
    const withdrawalId = 'wth_' + crypto.randomUUID();
    const now = Date.now();
    const reserve = await c.env.DB.prepare(
      `INSERT INTO withdrawals (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
       )`
    )
      .bind(
        withdrawalId,
        session.x_id,
        session.x_handle,
        destinationAddress,
        asset,
        amountStr,
        now,
        now,
        session.x_id,
        asset
      )
      .run();

    if ((reserve.meta?.changes ?? 0) === 0) {
      return c.json<ErrorResponse>(
        { error: 'A withdrawal for this asset is already in progress', code: 'WITHDRAWAL_IN_PROGRESS' },
        409
      );
    }

    // 3. Execute settlement. For NEAR destinations, settle with a plain
    //    ft_withdraw intent to the account. For external destinations (EVM,
    //    Solana, Bitcoin), obtain a 1Click swap quote and fund its INTENTS
    //    deposit address with a signed transfer intent so the cross-chain swap
    //    actually starts.
    // Which settlement rail is being attempted — recorded on the row so a
    // failure is diagnosable after the fact (a NEAR-account intents withdraw
    // and a cross-chain 1Click swap fail for entirely different reasons).
    const railUsed: 'native' | 'intents' | 'cross_chain' =
      settlementRail === 'native' ? 'native' : isNearAccount ? 'intents' : 'cross_chain';

    let txHash = '';
    try {
      // Meme assets never make it into intents — their token contracts have
      // never registered intents storage — so the whole withdrawal is settled
      // with a plain NEP-141 transfer straight out of the sender's own
      // account. Cross-chain still needs the 1Click solver route, which
      // settles inside intents and therefore cannot serve these assets.
      if (settlementRail === 'native') {
        if (!isNearAccount) {
          throw new Error(
            'Cross-chain withdrawal is not available for this asset — withdraw to a NEAR account'
          );
        }

        const direct = await nearRpc.executeDirectFtWithdraw(
          c.env,
          session.x_id,
          destinationAddress,
          asset,
          amountStr
        );
        if (!direct.success || !direct.txHash) {
          if (direct.error === 'INSUFFICIENT_PLAIN_BALANCE') {
            throw new Error(
              `Your ${asset.toUpperCase()} balance is not available in your wallet account — no funds were moved`
            );
          }
          throw new Error(direct.error || 'Direct transfer to the destination failed');
        }
        txHash = direct.txHash;
      } else if (isNearAccount) {
        // NEAR destination: the user's own vault account is the receiver, so a
        // plain ft_withdraw intent settles it directly.
        const withdrawResult = await nearRpc.executeWithdrawIntent(
          c.env,
          session.x_id,
          destinationAddress,
          asset,
          amountStr
        );
        if (withdrawResult?.success && withdrawResult.txHash) {
          txHash = withdrawResult.txHash;
        } else if (withdrawResult?.ambiguous) {
          // The broadcast may have landed — marking FAILED would orphan a
          // real transfer and free the reservation for a double-withdraw.
          // Keep PENDING for the cron/history to reconcile; surface the id.
          console.error(
            `[Withdrawal] CRITICAL: ambiguous settlement for ${withdrawalId}:`,
            withdrawResult?.error
          );
          await c.env.DB.prepare(
            "UPDATE withdrawals SET error = ?, error_code = 'AMBIGUOUS', rail = ?, updated_at = ? WHERE id = ?"
          )
            .bind(
              String(withdrawResult?.error || 'ambiguous').slice(0, 500),
              railUsed,
              Date.now(),
              withdrawalId
            )
            .run()
            .catch(() => {});
          return c.json<ErrorResponse>(
            {
              error: `Withdrawal status unknown — quote withdrawal id ${withdrawalId} to support`,
              code: 'WITHDRAWAL_UNRECORDED',
              withdrawalId,
            } as ErrorResponse,
            500
          );
        } else {
          throw new Error(withdrawResult?.error || 'Withdrawal intent execution failed');
        }
      } else {
        // External destination (EVM, Solana, Bitcoin, …): the 1Click quote is
        // an INTENTS deposit, so the user's intents balance is moved to the
        // quote's deposit address *inside* Intents — never as a native NEP-141
        // transfer, which 1Click does not observe for an INTENTS quote and
        // would leave the swap stuck at PENDING_DEPOSIT while the NEAR tx
        // "succeeds".
        const quote = await get1ClickWithdrawalQuote(c.env, {
          destinationAddress,
          asset,
          amount: parsedAmount,
          destinationChain,
        });
        const swapResult = await nearRpc.executeCrossChainSwapTransfer(
          c.env,
          session.x_id,
          quote.depositAddress
        );
        if (swapResult?.success && swapResult.txHash) {
          txHash = swapResult.txHash;
        } else if (swapResult?.ambiguous) {
          console.error(
            `[Withdrawal] CRITICAL: ambiguous cross-chain settlement for ${withdrawalId}:`,
            swapResult?.error
          );
          await c.env.DB.prepare(
            "UPDATE withdrawals SET error = ?, error_code = 'AMBIGUOUS', rail = ?, updated_at = ? WHERE id = ?"
          )
            .bind(
              String(swapResult?.error || 'ambiguous').slice(0, 500),
              railUsed,
              Date.now(),
              withdrawalId
            )
            .run()
            .catch(() => {});
          return c.json<ErrorResponse>(
            {
              error: `Withdrawal status unknown — quote withdrawal id ${withdrawalId} to support`,
              code: 'WITHDRAWAL_UNRECORDED',
              withdrawalId,
            } as ErrorResponse,
            500
          );
        } else {
          throw new Error(swapResult?.error || 'Cross-chain settlement failed');
        }
      }
    } catch (transferErr: any) {
      const settlementMsg = transferErr?.message || String(transferErr);
      const transient = isTransientRailReason(settlementMsg);
      // The explanation is what the user sees and what we persist, so a
      // "my withdrawal failed" report is answered in plain language from the
      // DB. The raw error goes to logs for deeper debugging.
      const explanation = explainSettlementFailure(railUsed, settlementMsg, asset);
      console.error(
        `[Withdrawal] settlement failed id=${withdrawalId} x=${session.x_handle} asset=${asset} rail=${railUsed} dest=${destinationAddress} transient=${transient} reason=${settlementMsg.slice(0, 200)}`
      );
      try {
        await c.env.DB.prepare(
          "UPDATE withdrawals SET status = 'FAILED', error = ?, error_code = ?, rail = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
        )
          .bind(
            explanation.slice(0, 500),
            transient ? 'RAIL_UNAVAILABLE' : 'SETTLEMENT_FAILED',
            railUsed,
            Date.now(),
            withdrawalId
          )
          .run();
      } catch (releaseErr) {
        console.error('[Withdrawal] failed to release reservation:', releaseErr);
      }
      // A 1Click outage ("Failed to receive response within timeout …") or an
      // RPC hiccup is not a broken request — the reservation is already
      // released, so tell the user to simply retry instead of surfacing a
      // cryptic "settlement failed".
      if (transient) {
        return c.json<ErrorResponse>(
          {
            error:
              'The cross-chain network is temporarily unavailable — no funds were moved, please try again in a moment.',
            code: 'RAIL_UNAVAILABLE',
          },
          503
        );
      }
      return c.json<ErrorResponse>(
        { error: explanation, code: 'WITHDRAWAL_FAILED' },
        502
      );
    }

    // 4. Finalize the reservation with the real transaction hash.
    const finalize = await c.env.DB.prepare(
      "UPDATE withdrawals SET tx_hash = ?, status = 'COMPLETED', rail = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
    )
      .bind(txHash, railUsed, Date.now(), withdrawalId)
      .run();

    if ((finalize.meta?.changes ?? 0) === 0) {
      console.error(
        `[Withdrawal] CRITICAL: transfer ${txHash} succeeded but reservation ${withdrawalId} could not be finalized`
      );
      return c.json<ErrorResponse>(
        {
          error: `Withdrawal transferred but could not be recorded; contact support with id ${withdrawalId}`,
          code: 'WITHDRAWAL_UNRECORDED',
          withdrawalId,
        } as ErrorResponse,
        500
      );
    }

    return c.json({
      success: true,
      withdrawalId,
      txHash,
      destinationAddress,
      asset: asset.toUpperCase(),
      amount: parsedAmount.toFixed(2),
      // Public receipt link so a wallet send is shareable too, mirroring the
      // claim/receipt link an X-handle send produces. The version query busts
      // platform preview caches when the card artwork changes.
      shareLink: `${resolveOrigin(c.env)}/receipt/${withdrawalId}?v=2`,
      message: `Successfully withdrawn ${parsedAmount.toFixed(2)} ${asset.toUpperCase()} to ${destinationAddress}`,
    });
  } catch (err: any) {
    console.error('Withdrawal error:', err);
    return c.json<ErrorResponse>(
      { error: `Withdrawal failed: ${publicErrorMessage(err, 'Internal error')}`, code: 'WITHDRAWAL_FAILED' },
      500
    );
  }
}

