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
import * as nearRpc from '../services/nearRpc';
import { redeemInvite } from '../services/inviteService';
import { background } from '../utils/background';
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

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM payments
      WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = ?)
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

    // 3. Update the active session cookie with the resolved vault account
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
      amountStr = String(available);
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
      const plainBefore = await nearRpc.getPlainAssetBalance(
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
        } else {
          console.warn(
            `[withdraw] intents rail unavailable for ${asset} (${plainDeposit.reason}) — settling with a direct ft_transfer`
          );
          settlementRail = 'native';
        }
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

    // 3. Execute settlement. For NEAR destinations, transfer directly to the
    //    account. For external destinations (EVM, Solana, Bitcoin), obtain a
    //    1Click swap quote, settle into the 1Click solver route on NEAR, and
    //    notify 1Click for cross-chain execution.
    let txHash = '';
    let oneClickDepositAddress: string | null = null;
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
      } else {
      let settlementNearRecipient = destinationAddress;

      if (!isNearAccount) {
        const quote = await get1ClickWithdrawalQuote(c.env, {
          destinationAddress,
          asset,
          amount: parsedAmount,
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
      } catch (tErr: any) {
        console.error('[Withdrawal] onchain settlement error:', tErr);
        throw tErr;
      }
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
          error: `Withdrawal settlement failed: ${publicErrorMessage(transferErr, 'settlement error')}`,
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
      message: `Successfully withdrawn ${parsedAmount.toFixed(2)} ${asset.toUpperCase()} to ${destinationAddress}`,
    });
  } catch (err: any) {
    console.error('Withdrawal error:', err);
    return c.json<ErrorResponse>(
      { error: `Withdrawal failed: ${publicErrorMessage(err, 'Internal error')}`, code: 'WITHDRAWAL_FAILED' },
      500
    );
  }
});

