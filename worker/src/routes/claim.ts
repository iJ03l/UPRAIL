/**
 * Claim routes for UP (UPRAIL.app)
 * Pending payment discovery, WebAuthn passkey registration, claim execution, and balance checks
 */

import { Hono } from 'hono';
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
import * as nearProxy from '../services/nearProxy';
import * as nearRpc from '../services/nearRpc';
import { redeemInvite } from '../services/inviteService';
import { background } from '../utils/background';
import {
  getDb,
  savePasskey,
  updateIdentityNearAccount,
  saveAuthChallenge,
  consumeAuthChallenge,
  getPendingPaymentsForRecipient,
} from '../db/postgres';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import {
  isValidDestinationAddress,
  isNearAccountAddress,
  get1ClickWithdrawalQuote,
  submit1ClickDeposit,
} from '../services/oneclickWithdraw';
import { publicErrorMessage } from '../utils/errors';

export const claimRouter = new Hono<AppContext>();

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
 * GET /api/claim/pending
 * Returns pending escrow payments matching the logged-in user's X handle
 */
claimRouter.get('/pending', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const userHandle = session.x_handle.toLowerCase();

    const sql = getDb(c.env);
    if (sql) {
      try {
        const pgPending = await getPendingPaymentsForRecipient(sql, session.x_id, userHandle);
        if (pgPending && pgPending.length > 0) {
          return c.json({ payments: pgPending });
        }
      } catch (pgErr) {
        console.warn('Postgres getPendingPaymentsForRecipient error, fallback to D1:', pgErr);
      }
    }

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM payments
      WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = ?)
        AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED')
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

    const options = await webauthn.generateRegistrationOptions({
      userId: session.x_id,
      userName: session.x_handle,
      rpId,
      rpName,
    });

    // Store challenge via challengeService (zero KV writes)
    await storeChallenge(c.env, {
      key: `webauthn_reg:${session.x_id}`,
      challenge: options.challenge,
      xId: session.x_id,
      purpose: 'registration',
      ttlSeconds: 300,
    });
    try {
      const sql = getDb(c.env);
      if (sql) {
        await saveAuthChallenge(sql, session.x_id, options.challenge, 'registration', 300);
      }
    } catch {}

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

    // Retrieve expected challenge strictly from server cache (fail-closed, single-use, zero KV writes)
    let expectedChallenge = await consumeChallenge(c.env, {
      key: `webauthn_reg:${session.x_id}`,
      purpose: 'registration',
    });

    if (!expectedChallenge) {
      try {
        const sql = getDb(c.env);
        if (sql) {
          expectedChallenge = await consumeAuthChallenge(sql, session.x_id, 'registration');
        }
      } catch {}
    }

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

    // Resolve deterministic, authentic confidential sub-account for user
    // Fully provisions subaccount and registers authentic keys on intents.near
    const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
    const now = Date.now();
    const passkeyId = crypto.randomUUID();

    // 1. Store passkey in PostgreSQL first
    try {
      const sql = getDb(c.env);
      if (sql) {
        await savePasskey(sql, {
          x_id: session.x_id,
          credential_id: verification.credentialId,
          public_key: verification.publicKeyHex,
          counter: verification.counter,
          transports: body.attestation.response?.transports || [],
        });
        await updateIdentityNearAccount(sql, session.x_id, nearAccount);
      }
    } catch (pgErr) {
      console.warn('Postgres passkey save failed, using D1:', pgErr);
    }

    // 2. Also persist to D1 if D1 binding is present
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

    // 3. Update active session in KV + Postgres
    await updateSession(c, {
      near_account: nearAccount,
    });

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
        error: `Passkey registration failed: ${publicErrorMessage(err, 'Internal error')})`,
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
claimRouter.post('/execute', requireAuth(), requirePasskeyAuth(), async (c) => {
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

    const results: ClaimExecuteResult[] = [];
    const normalizedUserHandle = session.x_handle.toLowerCase();

    for (const paymentId of body.paymentIds) {
      let payment: Payment | null = null;
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

        const claimableStatuses = [
          PaymentStatus.PENDING,
          PaymentStatus.DEPOSIT_WAITING,
          PaymentStatus.ESCROWED,
        ];
        if (payment.status === PaymentStatus.CLAIMED) {
          results.push({
            paymentId,
            status: PaymentStatus.CLAIMED,
            txHash: payment.claim_tx_hash || undefined,
            error: 'Payment already claimed',
          });
          continue;
        }
        if (!claimableStatuses.includes(payment.status)) {
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
                 AND status IN (?, ?, ?)`
            )
              .bind(
                PaymentStatus.CLAIMED,
                session.x_id,
                Date.now(),
                paymentId,
                PaymentStatus.PENDING,
                PaymentStatus.DEPOSIT_WAITING,
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

        let claimResponse: { payment: Payment; txHash: string };

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
            } else {
              throw new Error(escrowTransfer?.error || 'Escrow transfer execution failed');
            }
          } catch (tErr: any) {
            console.error('[claim/execute] onchain escrow transfer failed:', tErr);
            throw new Error(`Onchain settlement failed: ${tErr.message || 'escrow transfer error'}`);
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

        // If payment carries an invite code and recipient is claiming, auto-activate recipient
        if (payment.invite_code) {
          try {
            await redeemInvite(c.env, payment.invite_code, {
              x_id: session.x_id,
              x_handle: session.x_handle,
            });
          } catch {}
        }

        // Persist the settlement tx hash on the already-reserved row.
        if (c.env.DB) {
          try {
            await c.env.DB.prepare(
              'UPDATE payments SET claim_tx_hash = ?, updated_at = ? WHERE id = ?'
            )
              .bind(claimResponse.txHash, Date.now(), paymentId)
              .run();
          } catch (dbErr) {
            console.warn('[claim/execute] D1 payment update failed:', dbErr);
          }
        }

        results.push({
          paymentId,
          status: PaymentStatus.CLAIMED,
          txHash: claimResponse.txHash,
        });
      } catch (err: any) {
        console.error(`Claim error on payment ${paymentId}:`, err);
        // Roll the reservation back so the payment stays claimable/retryable.
        if (payment && c.env.DB) {
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
claimRouter.get('/balance', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
    const filterAsset = c.req.query('asset')?.toLowerCase();

    // 1. Query claimed payments from D1
    let claimedRows: { asset: string; amount: string }[] = [];
    if (c.env.DB) {
      try {
        const rows = await c.env.DB.prepare(
          `SELECT asset, amount FROM payments
            WHERE status = ?
              AND (recipient_x_id = ? OR LOWER(recipient_handle) = LOWER(?))`
        )
          .bind(PaymentStatus.CLAIMED, session.x_id, session.x_handle)
          .all<{ asset: string; amount: string }>();
        claimedRows = rows.results || [];
      } catch (e) {
        console.warn('[claim/balance] Query claimed payments error:', e);
      }
    }

    // 2. Query sent active payments and completed withdrawals from D1
    let sentRows: {
      asset: string;
      amount: string;
      fee?: string;
      status: string;
      claim_tx_hash?: string | null;
      intent_hash?: string | null;
    }[] = [];
    let withdrawnRows: { asset: string; amount: string }[] = [];
    if (c.env.DB) {
      try {
        const sRows = await c.env.DB.prepare(
          "SELECT asset, amount, fee, status, claim_tx_hash, intent_hash FROM payments WHERE (sender_x_id = ? OR LOWER(sender_x_handle) = LOWER(?)) AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED', 'CLAIMED')"
        )
          .bind(session.x_id, session.x_handle)
          .all<{
            asset: string;
            amount: string;
            fee?: string;
            status: string;
            claim_tx_hash?: string | null;
            intent_hash?: string | null;
          }>();
        sentRows = sRows.results || [];
      } catch (e) {
        console.warn('[claim/balance] Query sent payments error:', e);
      }

      try {
        const wRows = await c.env.DB.prepare(
          "SELECT asset, amount FROM withdrawals WHERE x_id = ? AND status IN ('COMPLETED', 'PENDING')"
        )
          .bind(session.x_id)
          .all<{ asset: string; amount: string }>();
        withdrawnRows = wRows.results || [];
      } catch (e) {
        console.warn('[claim/balance] Query withdrawals error:', e);
      }
    }

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

    // 3. Query onchain balances if available
    let onchainBalances: nearRpc.IntentAccountBalance[] = [];
    try {
      onchainBalances = await nearRpc.getIntentBalances(c.env, nearAccount);
    } catch {}

    for (const ob of onchainBalances) {
      addAmount(ob.defuse_asset_id || ob.symbol, parseFloat(ob.amountFormatted) || 0);
    }
    // Plain balances sitting directly on the pk account (direct receives)
    try {
      const plainBalances = await nearRpc.getPlainBalances(c.env, nearAccount);
      for (const pb of plainBalances) {
        addAmount(pb.defuse_asset_id || pb.symbol, parseFloat(pb.amountFormatted) || 0);
      }
    } catch {}
    for (const r of claimedRows) {
      addAmount(r.asset || 'usdc', parseFloat(r.amount) || 0);
    }
    for (const s of sentRows) {
      // Already-debited onchain rows must not be subtracted again (the
      // intents balance read above is live and already reflects the debit).
      const settledOnchain =
        (s.status === 'CLAIMED' && !nearRpc.isSyntheticTxHash(s.claim_tx_hash)) ||
        (s.status === 'ESCROWED' && !nearRpc.isSyntheticTxHash(s.intent_hash));
      if (settledOnchain) continue;
      const amt = (parseFloat(s.amount) || 0) + (parseFloat(s.fee || '0') || 0);
      addAmount(s.asset || 'usdc', -amt);
    }
    for (const w of withdrawnRows) {
      addAmount(w.asset || 'usdc', -(parseFloat(w.amount) || 0));
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
        error: `Failed to read confidential balance: ${publicErrorMessage(err, 'Internal error')})`,
        code: 'BALANCE_ERROR',
      },
      500
    );
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
claimRouter.post('/withdraw', requireAuth(), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    // Body was already parsed by requirePasskeyAuth()
    const body = (c.get('parsedBody' as any) || await c.req.json<{
      destinationAddress: string;
      asset?: string;
      amount?: string;
      passkeyAssertion?: unknown;
    }>().catch(() => null)) as {
      destinationAddress: string;
      asset?: string;
      amount?: string;
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

    // Destination address validation: supports NEAR accounts, EVM (0x...), Solana, and Bitcoin addresses.
    if (!isValidDestinationAddress(destinationAddress)) {
      return c.json<ErrorResponse>(
        { error: 'destinationAddress is not a valid blockchain address', code: 'INVALID_DESTINATION' },
        400
      );
    }

    const isNearAccount = isNearAccountAddress(destinationAddress);

    // 1. Read-only balance preview (authoritative check happens in the
    //    reservation query below, inside the same statement).
    const available = await getWithdrawableBalance(c.env, session, asset);

    let withdrawAmount = available;
    if (body.amount && body.amount !== 'all') {
      const parsed = parseFloat(body.amount);
      if (isNaN(parsed) || parsed <= 0) {
        return c.json<ErrorResponse>(
          { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
          400
        );
      }
      withdrawAmount = parsed;
    }

    if (withdrawAmount <= 0) {
      return c.json<ErrorResponse>(
        { error: 'No funds available to withdraw', code: 'ZERO_BALANCE' },
        400
      );
    }

    if (withdrawAmount > available + 0.0001) {
      return c.json<ErrorResponse>(
        {
          error: `Insufficient shielded balance. Available: ${available.toFixed(6)} ${asset.toUpperCase()}`,
          code: 'INSUFFICIENT_FUNDS',
        },
        400
      );
    }

    // Plain balance on the sender's own pk account is deposited into intents
    // first — ft_transfer_call with the user's own address as memo — so the
    // 1Click withdrawal can spend directly-received tokens. No-op when the
    // balance already lives inside intents.
    try {
      const nearAccountForDeposit = await nearRpc.resolveUserNearAccount(c.env, session);
      await nearRpc.depositPlainBalanceToIntents(
        c.env,
        session.x_id,
        asset,
        String(withdrawAmount),
        nearAccountForDeposit
      );
    } catch (plainErr) {
      console.warn('[withdraw] plain-balance deposit skipped:', plainErr);
    }

    // 2. Atomically reserve the withdrawal.
    const withdrawalId = 'wth_' + crypto.randomUUID();
    const now = Date.now();
    const amountUnits = withdrawAmount.toFixed(6).replace(/\.?0+$/, '') || '0';
    await c.env.DB.prepare(
      `INSERT INTO withdrawals (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?)`
    )
      .bind(
        withdrawalId,
        session.x_id,
        session.x_handle,
        destinationAddress,
        asset,
        amountUnits,
        now,
        now
      )
      .run();

    // 3. Execute settlement. For NEAR destinations, transfer directly to the
    //    account. For external destinations (EVM, Solana, Bitcoin), obtain a
    //    1Click swap quote, settle into the 1Click solver route on NEAR, and
    //    notify 1Click for cross-chain execution.
    let txHash = '';
    let oneClickDepositAddress: string | null = null;
    try {
      let settlementNearRecipient = destinationAddress;

      if (!isNearAccount) {
        const quote = await get1ClickWithdrawalQuote(c.env, {
          destinationAddress,
          asset,
          amount: withdrawAmount,
        });
        settlementNearRecipient = quote.depositAddress;
        oneClickDepositAddress = quote.depositAddress;
      }

      try {
        const withdrawResult = await nearRpc.executeWithdrawIntent(
          c.env,
          session.x_id,
          settlementNearRecipient,
          asset,
          amountUnits
        );
        if (withdrawResult?.success && withdrawResult.txHash) {
          txHash = withdrawResult.txHash;
        } else {
          throw new Error(withdrawResult?.error || 'Withdrawal intent execution failed');
        }
      } catch (tErr: any) {
        console.error('[Withdrawal] onchain settlement error:', tErr);
        throw tErr;
      }

      if (oneClickDepositAddress && txHash && !nearRpc.isSyntheticTxHash(txHash)) {
        await submit1ClickDeposit(c.env, txHash, oneClickDepositAddress);
      }
    } catch (transferErr: any) {
      console.error('[Withdrawal] settlement failed:', transferErr);
      try {
        await c.env.DB.prepare(
          "UPDATE withdrawals SET status = 'FAILED' WHERE id = ? AND status = 'PENDING'"
        )
          .bind(withdrawalId)
          .run();
      } catch (releaseErr) {
        console.error('[Withdrawal] failed to release reservation:', releaseErr);
      }
      return c.json<ErrorResponse>(
        {
          error: `Withdrawal settlement failed: ${transferErr.message || 'transfer error'}`,
          code: 'WITHDRAWAL_FAILED',
        },
        502
      );
    }

    // 4. Finalize the reservation with the real transaction hash.
    const finalize = await c.env.DB.prepare(
      "UPDATE withdrawals SET tx_hash = ?, status = 'COMPLETED' WHERE id = ? AND status = 'PENDING'"
    )
      .bind(txHash, withdrawalId)
      .run();

    if ((finalize.meta?.changes ?? 0) === 0) {
      console.error(
        `[Withdrawal] CRITICAL: transfer ${txHash} succeeded but reservation ${withdrawalId} could not be finalized`
      );
      return c.json<ErrorResponse>(
        {
          error: 'Withdrawal transferred but could not be recorded; contact support with this id',
          code: 'WITHDRAWAL_UNRECORDED',
        },
        500
      );
    }

    return c.json({
      success: true,
      withdrawalId,
      txHash,
      destinationAddress,
      asset: asset.toUpperCase(),
      amount: withdrawAmount.toFixed(2),
      message: `Successfully withdrawn ${withdrawAmount.toFixed(2)} ${asset.toUpperCase()} to ${destinationAddress}`,
    });
  } catch (err: any) {
    console.error('Withdrawal error:', err);
    return c.json<ErrorResponse>(
      { error: `Withdrawal failed: ${publicErrorMessage(err, 'Internal error')})`, code: 'WITHDRAWAL_FAILED' },
      500
    );
  }
});

