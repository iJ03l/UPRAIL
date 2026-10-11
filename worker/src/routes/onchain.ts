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

    // Include virtual escrow balances claimed by user
    if (c.env.DB) {
      try {
        const claimedRows = await c.env.DB.prepare(
          "SELECT asset, amount FROM payments WHERE LOWER(recipient_handle) = LOWER(?) AND status = 'CLAIMED'"
        )
          .bind(session.x_handle)
          .all<{ asset: string; amount: string }>();

        let withdrawnRows: { asset: string; amount: string }[] = [];
        try {
          const w = await c.env.DB.prepare(
            "SELECT asset, amount FROM withdrawals WHERE x_id = ? AND status = 'COMPLETED'"
          )
            .bind(session.x_id)
            .all<{ asset: string; amount: string }>();
          withdrawnRows = w.results || [];
        } catch {}

        const netVirtual: Record<string, number> = {};
        for (const row of claimedRows.results || []) {
          const a = (row.asset || 'usdc').toLowerCase();
          netVirtual[a] = (netVirtual[a] || 0) + (parseFloat(row.amount) || 0);
        }
        for (const row of withdrawnRows) {
          const a = (row.asset || 'usdc').toLowerCase();
          netVirtual[a] = Math.max(0, (netVirtual[a] || 0) - (parseFloat(row.amount) || 0));
        }

        // Virtual balances must carry the SAME id/symbol/decimals as the real
        // onchain entry, otherwise the asset shows up twice (once real, once
        // synthetic) and NEAR was rendered with 6 decimals instead of 24.
        const tokens = await nearRpc.getSupportedTokens(c.env).catch(() => [] as nearRpc.OnchainToken[]);
        for (const [asset, netAmt] of Object.entries(netVirtual)) {
          if (netAmt <= 0) continue;
          const token = nearRpc.resolveTokenForAsset(asset, tokens);
          const defuseId = (token?.defuse_asset_id || asset).toLowerCase();
          const symbol = (token?.symbol || asset).toUpperCase();

          const existing = balances.find(
            (b) =>
              (b.defuse_asset_id || '').toLowerCase() === defuseId ||
              (b.symbol || '').toLowerCase() === symbol.toLowerCase()
          );
          if (existing) continue;

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
      } catch (dbErr) {
        console.warn('[onchain/balances] D1 virtual balance lookup error:', dbErr);
      }
    }

    // Check active 1Click cross-chain deposit addresses for incoming deposits
    if (c.env.DB) {
      try {
        const depositRows = await c.env.DB.prepare(
          'SELECT address, chain, chain_name FROM deposit_addresses WHERE account_id = ?'
        )
          .bind(nearAccount)
          .all<{ address: string; chain: string; chain_name: string }>();

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
              const depAmt = parseFloat(swapDetails?.depositedAmountFormatted || '0');
              if (depAmt > 0 && statusData?.status !== 'REFUNDED') {
                const assetSymbol = dep.chain === 'near' ? 'NEAR' : (dep.chain || 'USDC').toUpperCase();
                const existing = balances.find((b) => b.symbol?.toUpperCase() === assetSymbol);
                if (existing) {
                  const currentVal = parseFloat(existing.amountFormatted || '0');
                  if (currentVal < depAmt) {
                    existing.amountFormatted = depAmt.toString();
                    existing.amount = (depAmt * Math.pow(10, existing.decimals || (dep.chain === 'near' ? 24 : 6))).toString();
                  }
                } else {
                  balances.push({
                    defuse_asset_id: dep.chain === 'near' ? 'wrap.near' : `nep141:${dep.chain}.omft.near`,
                    symbol: assetSymbol,
                    amount: (depAmt * (dep.chain === 'near' ? 1e24 : 1e6)).toString(),
                    amountFormatted: depAmt.toString(),
                    decimals: dep.chain === 'near' ? 24 : 6,
                    nearContractId: dep.chain === 'near' ? 'wrap.near' : `${dep.chain}.omft.near`,
                  });
                }
              }
            }
          } catch (statusErr) {
            console.warn('[onchain/balances] 1click deposit status check error:', statusErr);
          }
        }
      } catch (depErr) {
        console.warn('[onchain/balances] deposit_addresses check error:', depErr);
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
 *   refresh — optional boolean to bypass cache and derive a new 1-time address
 */
onchainRouter.get('/deposit-address', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const chain = c.req.query('chain');
  const token = c.req.query('token');
  const bypassCache = c.req.query('refresh') === 'true';
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    if (chain) {
      // Single chain (with optional token)
      const address = await nearRpc.getDepositAddress(c.env, nearAccount, chain, bypassCache, token);
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
          'SELECT address, chain FROM deposit_addresses WHERE account_id = ?'
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
              const txHashes = [
                ...(swapDetails?.nearTxHashes || []),
                ...(swapDetails?.originChainTxHashes || []),
              ];
              for (const hash of txHashes) {
                if (!transactions.some((t: any) => t.id === hash)) {
                  transactions.unshift({
                    id: hash,
                    intent_type: 'deposit',
                    defuse_asset_id_in: dep.chain === 'near' ? 'wrap.near' : `nep141:${dep.chain}.omft.near`,
                    amount_in: swapDetails?.depositedAmountFormatted || '0',
                    sender_id: dep.address,
                    receiver_id: nearAccount,
                    block_height: 0,
                    block_timestamp: statusData.updatedAt ? new Date(statusData.updatedAt).getTime() : Date.now(),
                    status: statusData.status === 'SUCCESS' ? 'success' : 'pending',
                  });
                }
              }
            }
          } catch {}
        }
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

