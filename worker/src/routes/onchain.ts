/**
 * Onchain data routes for UP (UPRAIL.app)
 *
 * All responses are pulled LIVE from the NEAR blockchain via the QuikNode RPC.
 * No hardcoded addresses, no stale token lists, no cached deposit addresses.
 *
 * Access control — every route below is authenticated and scoped to the caller:
 *   - /onchain/tokens          — public, static protocol metadata (no user data)
 *   - /onchain/balances        — requireAuth() — authenticated user's intent account
 *   - /onchain/deposit-address — requireAuth() — authenticated user
 *   - /onchain/deposit-status  — requireAuth() + address ownership check
 *   - /onchain/account         — requireAuth()
 *   - /onchain/history         — requireAuth() — authenticated user
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse, Session } from '../types';
import { requireAuth } from '../middleware/session';
import * as nearRpc from '../services/nearRpc';
import { publicErrorMessage } from '../utils/errors';

export const onchainRouter = new Hono<AppContext>();

// ─── GET /api/onchain/tokens ──────────────────────────────────────────────────
/**
 * Returns the full list of tokens supported by the NEAR Intents protocol,
 * fetched live from the intents contract. Includes all chains, all assets.
 * No exceptions — every token the contract supports is returned.
 */
onchainRouter.get('/tokens', async (c) => {
  try {
    const tokens = await nearRpc.getSupportedTokens(c.env);
    // Short cache: this payload carries live USD prices, so a long TTL turns
    // "realtime" into "whatever it was when you first opened the tab".
    c.header('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=30');
    return c.json({ tokens, source: 'onchain' });
  } catch (err: any) {
    console.error('[onchain/tokens] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch onchain token list: ${publicErrorMessage(err)}`, code: 'ONCHAIN_TOKENS_ERROR' },
      500
    );
  }
});

// ─── GET /api/onchain/balances ────────────────────────────────────────────────
/**
 * Returns the authenticated user's live intent account balances from the
 * onchain intents contract, merged with any virtual escrow vault balances.
 * Data is per-user and access-controlled by session.
 */
onchainRouter.get('/balances', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    let balances: any[] = [];
    try {
      balances = await nearRpc.getIntentBalances(c.env, nearAccount);
    } catch (rpcErr) {
      console.warn('[onchain/balances] RPC getIntentBalances error:', rpcErr);
    }

    // Direct receives sit as plain balances on the user's pk sub-account —
    // merge them in so tokens sent straight to the account are visible.
    try {
      const plain = await nearRpc.getPlainBalances(c.env, nearAccount);
      for (const p of plain) {
        const existing = balances.find(
          (b) =>
            (b.defuse_asset_id || '').toLowerCase() === (p.defuse_asset_id || '').toLowerCase() ||
            (b.symbol || '').toUpperCase() === (p.symbol || '').toUpperCase()
        );
        if (existing) {
          const sum = BigInt(existing.amount || '0') + BigInt(p.amount || '0');
          existing.amount = sum.toString();
          existing.amountFormatted = nearRpc.formatAmount(
            existing.amount,
            existing.decimals ?? p.decimals
          );
        } else {
          balances.push(p);
        }
      }
    } catch (plainErr) {
      console.warn('[onchain/balances] plain balance merge skipped:', plainErr);
    }

    // Include virtual escrow balances claimed by user, minus active sent payments and withdrawals
    if (c.env.DB) {
      try {
        const claimedRows = await c.env.DB.prepare(
          "SELECT asset, amount, claim_tx_hash FROM payments WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = LOWER(?)) AND status = 'CLAIMED'"
        )
          .bind(session.x_id, session.x_handle)
          .all<{ asset: string; amount: string; claim_tx_hash?: string | null }>();

        const sentRows = await c.env.DB.prepare(
          "SELECT asset, amount, fee, status, claim_tx_hash FROM payments WHERE (sender_x_id = ? OR LOWER(sender_x_handle) = LOWER(?)) AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED', 'CLAIMED')"
        )
          .bind(session.x_id, session.x_handle)
          .all<{ asset: string; amount: string; fee?: string; status: string; claim_tx_hash?: string | null }>();

        let withdrawnRows: { asset: string; amount: string; status: string; tx_hash?: string | null }[] = [];
        try {
          const w = await c.env.DB.prepare(
            "SELECT asset, amount, status, tx_hash FROM withdrawals WHERE x_id = ? AND status IN ('COMPLETED', 'PENDING')"
          )
            .bind(session.x_id)
            .all<{ asset: string; amount: string; status: string; tx_hash?: string | null }>();
          withdrawnRows = w.results || [];
        } catch {}

        const netVirtual: Record<string, number> = {};
        for (const row of claimedRows.results || []) {
          if (nearRpc.isSyntheticTxHash(row.claim_tx_hash)) {
            const a = (row.asset || 'usdc').toLowerCase();
            netVirtual[a] = (netVirtual[a] || 0) + (parseFloat(row.amount) || 0);
          }
        }
        for (const row of sentRows.results || []) {
          if (row.status !== 'CLAIMED' || nearRpc.isSyntheticTxHash(row.claim_tx_hash)) {
            const a = (row.asset || 'usdc').toLowerCase();
            const amt = (parseFloat(row.amount) || 0) + (parseFloat(row.fee || '0') || 0);
            netVirtual[a] = (netVirtual[a] || 0) - amt;
          }
        }
        for (const row of withdrawnRows) {
          if (row.status === 'PENDING' || nearRpc.isSyntheticTxHash(row.tx_hash)) {
            const a = (row.asset || 'usdc').toLowerCase();
            netVirtual[a] = (netVirtual[a] || 0) - (parseFloat(row.amount) || 0);
          }
        }

        // Virtual balances must carry the SAME id/symbol/decimals as the real
        // onchain entry, otherwise the asset shows up twice.
        const tokens = await nearRpc.getSupportedTokens(c.env).catch(() => [] as nearRpc.OnchainToken[]);
        for (const [asset, netAmt] of Object.entries(netVirtual)) {
          if (netAmt === 0) continue;
          const token = nearRpc.resolveTokenForAsset(asset, tokens);
          const defuseId = (token?.defuse_asset_id || asset).toLowerCase();
          const symbol = (token?.symbol || asset).toUpperCase();

          const existing = balances.find(
            (b) =>
              nearRpc.assetsMatch(b.defuse_asset_id, asset) ||
              nearRpc.assetsMatch(b.symbol, symbol) ||
              nearRpc.assetsMatch(b.nearContractId, token?.nearContractId)
          );
          if (existing) {
            const currentAmt = parseFloat(existing.amountFormatted || '0');
            const total = Math.max(0, currentAmt + netAmt);
            existing.amountFormatted = total.toFixed(2);
            const decimals = existing.decimals || token?.decimals || 6;
            existing.amount = nearRpc.toBaseUnits(total.toFixed(Math.min(decimals, 18)), decimals);
            continue;
          }

          // If not in onchain balances and netAmt is positive, add virtual entry
          if (netAmt > 0) {
            const decimals = token?.decimals ?? (defuseId.includes('wrap.near') ? 24 : 18);
            const baseUnits = nearRpc.toBaseUnits(netAmt.toFixed(Math.min(decimals, 18)), decimals);

            balances.push({
              defuse_asset_id: defuseId,
              symbol,
              amount: baseUnits,
              amountFormatted: netAmt.toFixed(2),
              decimals,
              nearContractId: token?.nearContractId || '',
              ...(token?.icon ? { icon: token.icon } : {}),
            });
          }
        }
      } catch (dbErr) {
        console.warn('[onchain/balances] D1 virtual balance lookup error:', dbErr);
      }
    }

    return c.json({
      nearAccount,
      balances,
      source: 'onchain_and_virtual',
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[onchain/balances] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch onchain balances: ${publicErrorMessage(err)}`, code: 'ONCHAIN_BALANCE_ERROR' },
      500
    );
  }
});

// ─── GET /api/onchain/deposit-address ─────────────────────────────────────────
/**
 * Returns the user's deposit address for a specific chain and token.
 * These addresses are EPHEMERAL — generated per-user by the intents solver network
 * and must always be fetched fresh. Never use a cached/hardcoded deposit address.
 *
 * Query params:
 *   chain  — optional, e.g. "base", "arbitrum", "sol", "near", "eth", "btc"
 *   token  — optional, e.g. "USDC", "USDT", "NEAR", "ETH", "SOL", "BTC"
 *   amount — optional exact deposit amount (e.g. "2.13", "10")
 *   refresh — optional boolean to bypass cache and derive a new 1-time address
 */
onchainRouter.get('/deposit-address', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const chain = c.req.query('chain');
  const token = c.req.query('token');
  const amount = c.req.query('amount');
  const bypassCache = c.req.query('refresh') === 'true' || !!amount;
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    if (chain) {
      // Single chain (with optional token and exact amount)
      const address = await nearRpc.getDepositAddress(c.env, nearAccount, chain, bypassCache, token, amount);
      if (!address) {
        return c.json<ErrorResponse>(
          { error: `No deposit address available for chain: ${chain}${token ? ` (${token})` : ''}`, code: 'NO_DEPOSIT_ADDRESS' },
          404
        );
      }
      return c.json({ address, nearAccount, source: 'onchain', fetchedAt: Date.now() });
    } else {
      // All chains
      const addresses = await nearRpc.getAllDepositAddresses(c.env, nearAccount, bypassCache);
      return c.json({ addresses, nearAccount, source: 'onchain', fetchedAt: Date.now() });
    }
  } catch (err: any) {
    console.error('[onchain/deposit-address] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch deposit address: ${publicErrorMessage(err)}`, code: 'DEPOSIT_ADDRESS_ERROR' },
      500
    );
  }
});

// ─── GET /api/onchain/deposit-status ──────────────────────────────────────────
/**
 * Real-time deposit tracker: checks 1Click status for a specific deposit address.
 * Enables live UI updates: PENDING_DEPOSIT -> PROCESSING -> SUCCESS.
 *
 * SECURITY: authenticated, and the address must belong to the caller — either
 * one of their cached 1Click deposit addresses or the deposit address of a
 * payment they sent or are the recipient of. Without this check the endpoint is
 * an open proxy to the 1Click status API and a cross-user address oracle.
 */
onchainRouter.get('/deposit-status', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const address = c.req.query('address');
  if (!address) {
    return c.json<ErrorResponse>({ error: 'Missing address query param', code: 'INVALID_REQUEST' }, 400);
  }

  try {
    const owned = await callerOwnsDepositAddress(c.env, session, address);
    if (!owned) {
      return c.json<ErrorResponse>(
        { error: 'Deposit address not found for this account', code: 'FORBIDDEN' },
        403
      );
    }

    return await probeDepositStatus(address);
  } catch (err: any) {
    return c.json({
      status: 'PENDING_DEPOSIT',
      depositedAmount: '0',
      depositedAmountFormatted: '0',
      depositedAmountUsd: '0',
      txHashes: [],
      isSettled: false,
      error: publicErrorMessage(err),
    });
  }
});

/**
 * True when `address` is a deposit address the authenticated user may inspect.
 */
async function callerOwnsDepositAddress(
  env: AppContext['Bindings'],
  session: Session,
  address: string
): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
    const cached = await env.DB.prepare(
      'SELECT 1 AS ok FROM deposit_addresses WHERE address = ? AND account_id = ? LIMIT 1'
    )
      .bind(address, nearAccount)
      .first<{ ok: number }>();
    if (cached) return true;

    const payment = await env.DB.prepare(
      `SELECT 1 AS ok FROM payments
        WHERE deposit_address = ?
          AND (sender_x_id = ?
               OR recipient_x_id = ?
               OR LOWER(recipient_handle) = LOWER(?))
        LIMIT 1`
    )
      .bind(address, session.x_id, session.x_id, session.x_handle)
      .first<{ ok: number }>();
    return Boolean(payment);
  } catch (err) {
    console.warn('[onchain/deposit-status] ownership check failed:', err);
    return false;
  }
}

/** Queries 1Click for the deposit status of an already-authorized address. */
async function probeDepositStatus(address: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await fetch(
      `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(address)}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
          Accept: 'application/json',
        },
      }
    );
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return Response.json({
        status: 'PENDING_DEPOSIT',
        depositedAmount: '0',
        depositedAmountFormatted: '0',
        depositedAmountUsd: '0',
        txHashes: [],
        updatedAt: null,
        isSettled: false,
      });
    }

    const data = (await resp.json()) as any;
    const swapDetails = data.swapDetails;
    const txHashes = [
      ...(swapDetails?.nearTxHashes || []),
      ...(swapDetails?.originChainTxHashes || []),
      ...(swapDetails?.destinationChainTxHashes || []),
    ];

    const depAmt = parseFloat(swapDetails?.depositedAmountFormatted || '0');
    const isSettled = data.status === 'SUCCESS' || depAmt > 0;

    return Response.json({
      status: data.status || 'PENDING_DEPOSIT',
      depositedAmount: swapDetails?.depositedAmount || '0',
      depositedAmountFormatted: swapDetails?.depositedAmountFormatted || '0',
      depositedAmountUsd: swapDetails?.depositedAmountUsd || '0',
      amountInFormatted: swapDetails?.amountInFormatted || swapDetails?.depositedAmountFormatted || '0',
      amountOutFormatted: swapDetails?.amountOutFormatted || null,
      timeEstimate: data.quoteResponse?.quote?.timeEstimate || null,
      txHashes,
      updatedAt: data.updatedAt || null,
      isSettled,
    });
  } catch (err: any) {
    return Response.json({
      status: 'PENDING_DEPOSIT',
      depositedAmount: '0',
      depositedAmountFormatted: '0',
      depositedAmountUsd: '0',
      txHashes: [],
      isSettled: false,
      error: publicErrorMessage(err),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── GET /api/onchain/history ─────────────────────────────────────────────────
/**
 * Returns the authenticated user's onchain intent transaction history.
 * Scoped strictly to the authenticated user — never leaks other users' data.
 * Pulled live from the intents contract event log.
 */
onchainRouter.get('/history', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const limitParam = c.req.query('limit');
  const limit = Math.min(parseInt(limitParam || '50', 10), 200);
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    const transactions = await nearRpc.getIntentHistory(c.env, nearAccount, limit);

    // Merge any detected 1Click deposit transactions
    if (c.env.DB) {
      try {
        const depositRows = await c.env.DB.prepare(
          'SELECT address, chain FROM deposit_addresses WHERE account_id = ? ORDER BY updated_at DESC LIMIT 15'
        )
          .bind(nearAccount)
          .all<{ address: string; chain: string }>();

        for (const dep of depositRows.results || []) {
          if (!dep.address) continue;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            const statusResp = await fetch(
              `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(dep.address)}`,
              {
                signal: controller.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
                  Accept: 'application/json',
                },
              }
            );
            clearTimeout(timeoutId);

            if (statusResp.ok) {
              const statusData = (await statusResp.json()) as any;
              const swapDetails = statusData?.swapDetails;
              const depAmt = swapDetails?.depositedAmountFormatted || swapDetails?.amountInFormatted || '0';
              const numAmt = parseFloat(depAmt);
              const isSuccess = statusData?.status === 'SUCCESS';

              // Ignore unused deposit addresses that have no deposit
              if (!isSuccess && (!numAmt || numAmt <= 0)) {
                continue;
              }

              const rawOrigin = swapDetails?.originChainTxHashes?.[0];
              const originTx = typeof rawOrigin === 'string' ? rawOrigin : rawOrigin?.hash;
              const rawDest = swapDetails?.destinationChainTxHashes?.[0];
              const destTx = typeof rawDest === 'string' ? rawDest : rawDest?.hash;
              const nearTx = swapDetails?.nearTxHashes?.[0];
              const primaryId = originTx || destTx || nearTx || dep.address;

              if (primaryId && !transactions.some((t: any) => t.id === primaryId || (destTx && t.id === destTx))) {
                const originAsset =
                  statusData?.quoteResponse?.quoteRequest?.originAsset ||
                  (dep.chain === 'near' ? 'wrap.near' : `nep141:${dep.chain}.omft.near`);

                transactions.unshift({
                  id: primaryId,
                  intent_type: 'deposit',
                  defuse_asset_id_in: originAsset,
                  amount_in: depAmt,
                  sender_id: dep.address,
                  receiver_id: nearAccount,
                  block_height: 0,
                  block_timestamp: statusData.updatedAt ? new Date(statusData.updatedAt).getTime() : Date.now(),
                  status: isSuccess ? 'success' : statusData.status === 'REFUNDED' ? 'failed' : 'pending',
                });
              }
            }
          } catch {}
        }

        // Include withdrawals recorded for this user
        const withdrawRows = await c.env.DB.prepare(
          "SELECT id, asset, amount, destination_address, tx_hash, status, created_at FROM withdrawals WHERE x_id = ? ORDER BY created_at DESC LIMIT 50"
        )
          .bind(session.x_id)
          .all<{ id: string; asset: string; amount: string; destination_address: string; tx_hash: string | null; status: string; created_at: string }>();

        for (const w of withdrawRows.results || []) {
          const wId = w.tx_hash || w.id;
          if (!transactions.some((t: any) => t.id === wId)) {
            transactions.push({
              id: wId,
              intent_type: 'withdrawal',
              defuse_asset_id_in: w.asset,
              amount_in: w.amount,
              sender_id: nearAccount,
              receiver_id: w.destination_address,
              block_height: 0,
              block_timestamp: new Date(w.created_at).getTime(),
              status: w.status === 'COMPLETED' ? 'success' : w.status === 'FAILED' ? 'failed' : 'pending',
            });
          }
        }

        transactions.sort((a: any, b: any) => (Number(b.block_timestamp) || 0) - (Number(a.block_timestamp) || 0));
      } catch {}
    }

    return c.json({
      transactions,
      nearAccount,
      source: 'onchain',
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[onchain/history] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch onchain history: ${publicErrorMessage(err)}`, code: 'ONCHAIN_HISTORY_ERROR' },
      500
    );
  }
});

// ─── GET /api/onchain/account ─────────────────────────────────────────────────
/**
 * Returns the authenticated user's intent account info — existence, near account id.
 * In Virtual Intents Escrow, account creation is $0 and instant.
 */
onchainRouter.get('/account', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const report: nearRpc.ProvisionReport = { attempted: false, created: true };
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session, report);
  const exists = Boolean(nearAccount) || (await nearRpc.accountExists(c.env, nearAccount));

  return c.json({
    hasIntentAccount: exists,
    nearAccount,
    xHandle: session.x_handle,
    source: 'virtual_escrow',
    provisionError: undefined,
  });
});

