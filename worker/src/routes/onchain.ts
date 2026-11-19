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
import { requireAuth, updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import * as nearRpc from '../services/nearRpc';
import { isConfidentialRailEnabled, getConfidentialBalances } from '../services/confidentialRail';
import { getUserSession, OneClickSelfCustodyAuthRequiredError } from '../services/oneclickAuth';
import { prepareOneClickWebAuthnSession } from '../services/custodyService';
import {
  executeStabilize,
  getStabilizeExecutionStatus,
  getStabilizeQuote,
  StabilizeError,
} from '../services/stabilize';
import { handleCustodyActionError } from '../utils/custodyResponse';
import {
  prepareSelfCustodyShieldTarget,
  prepareSelfCustodyStabilize,
  submitSelfCustodyStabilize,
} from '../services/selfCustodyActions';
import { publicErrorMessage } from '../utils/errors';
import { cleanMemeSymbol } from '../utils/token';
import { getAgentPocketBalances } from '../services/earnVaults';

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
      { error: `Failed to fetch onchain token list: ${publicErrorMessage(err)}`, code: 'TOKEN_LIST_ERROR' },
      502
    );
  }
});

// ─── GET /api/onchain/balances ────────────────────────────────────────────────
/**
 * Returns the authenticated user's live intent account balances from the
 * onchain intents contract, merged with any virtual escrow vault balances.
 * Data is per-user and access-controlled by session.
 */
// ---------------------------------------------------------------------------
// GET /api/onchain/price
// ---------------------------------------------------------------------------
/**
 * USD price for a single asset, by defuse id or contract id.
 *
 * The curated registry head is only ~484 tokens, so a launchpad meme is absent
 * from it - yet the DCL pool pipeline still prices it, which is why a balance
 * row can show $4.83 for a token the registry has never heard of. Exposing that
 * lookup lets any consumer price a native NEP-141 instead of reporting it as
 * unpriced.
 *
 * Public and cacheable: prices are not per-user data. Kept off /history so the
 * per-invocation subrequest budget of the authenticated routes is untouched -
 * this runs in its own invocation with its own budget, and pool lookups are
 * already KV-cached.
 */
onchainRouter.get('/price', async (c) => {
  const asset = (c.req.query('asset') || '').trim();
  if (!asset) {
    return c.json<ErrorResponse>(
      { error: 'Missing asset query parameter', code: 'MISSING_ASSET' },
      400
    );
  }

  const tokens = await nearRpc.getSupportedTokens(c.env).catch(() => [] as nearRpc.OnchainToken[]);
  const known = nearRpc.resolveTokenForAsset(asset, tokens);
  const token = known || (await nearRpc.resolveRheaToken(c.env, asset).catch(() => null));

  const lower = asset.toLowerCase();
  const contract =
    token?.nearContractId || (lower.startsWith('nep141:') ? lower.slice(7) : lower) || null;

  const priceUsd = await nearRpc.resolveTokenUsdPrice(c.env, {
    nearContractId: contract,
    contractId: contract,
    symbol: token?.symbol ?? null,
    decimals: token?.decimals ?? null,
  });

  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
  return c.json({
    asset,
    priceUsd,
    symbol: token?.symbol ?? null,
    decimals: token?.decimals ?? null,
    source: priceUsd === null ? 'none' : known ? 'registry' : 'pool',
  });
});

onchainRouter.get('/balances', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
    let balances: any[] = [];
    try {
      balances = await nearRpc.getIntentBalances(c.env, nearAccount);
      for (const b of balances) {
        b.intentsAmount = b.amount;
        b.intentsAmountFormatted = b.amountFormatted;
        b.isPlainOnly = false;
      }
    } catch (rpcErr) {
      console.warn('[onchain/balances] RPC getIntentBalances error:', rpcErr);
    }

    let plainL1Locked: any[] = [];
    // Direct receives sit as plain balances on the user's pk sub-account —
    // merge them into spendable balances only when the server L1 key is still
    // authorized on-chain. Once rotated to an offline Recovery Key, keep them
    // separate so "Max" actions do not trigger an impossible server-signed sweep.
    try {
      const canSignL1 =
        custody.custodyMode !== 'self' ||
        (await nearRpc.canServerSignAccountL1(c.env, session.x_id, nearAccount));
      const plain = await nearRpc.getPlainBalances(c.env, nearAccount);
      if (!canSignL1) {
        plainL1Locked = plain;
      } else {
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
            balances.push({
              ...p,
              intentsAmount: '0',
              intentsAmountFormatted: '0',
              isPlainOnly: true,
            });
          }
        }
      }
    } catch (plainErr) {
      console.warn('[onchain/balances] plain balance merge skipped:', plainErr);
    }

    const tokens = await nearRpc.getSupportedTokens(c.env).catch(
      () => [] as nearRpc.OnchainToken[]
    );

    // Agent Allowance Pocket holds pre-funded spendable Intents tokens for zero-prompt AI chat sends/withdrawals.
    // Merge them seamlessly into the unified balance list so UPRAIL displays and spends them as normal balance.
    try {
      const pocket = await getAgentPocketBalances(c.env, nearAccount);
      for (const pb of pocket.balances) {
        const token = nearRpc.resolveTokenForAsset(pb.defuse_asset_id, tokens);
        const existing = balances.find(
          (b) =>
            nearRpc.assetsMatch(b.defuse_asset_id, pb.defuse_asset_id) ||
            nearRpc.assetsMatch(b.nearContractId, pb.nearContractId) ||
            nearRpc.assetsMatch(b.symbol, pb.symbol)
        );
        if (existing) {
          const decimals = existing.decimals ?? token?.decimals ?? pb.decimals;
          const sum = BigInt(existing.amount || '0') + pb.amountAtomic;
          existing.amount = sum.toString();
          existing.amountFormatted = nearRpc.formatAmount(existing.amount, decimals);
          const sumIntents = BigInt(existing.intentsAmount ?? '0') + pb.amountAtomic;
          existing.intentsAmount = sumIntents.toString();
          existing.intentsAmountFormatted = nearRpc.formatAmount(existing.intentsAmount, decimals);
          existing.isPlainOnly = false;
        } else {
          const decimals = token?.decimals ?? pb.decimals;
          const fmt = nearRpc.formatAmount(pb.amount, decimals);
          const price = nearRpc.tokenUsdPrice(token?.symbol || pb.symbol, token?.priceUsd);
          balances.push({
            defuse_asset_id: pb.defuse_asset_id,
            symbol: pb.symbol,
            amount: pb.amount,
            amountFormatted: fmt,
            intentsAmount: pb.amount,
            intentsAmountFormatted: fmt,
            isPlainOnly: false,
            decimals,
            nearContractId: token?.nearContractId || pb.nearContractId,
            ...(token?.icon ? { icon: token.icon } : {}),
            ...(price !== null ? { priceUsd: price } : {}),
          });
        }
      }
    } catch (pocketErr) {
      console.warn('[onchain/balances] agent pocket balance merge skipped:', pocketErr);
    }

    let oneClickSessionRequired = false;

    // Confidential Intents balances are held off the public ledger. Merge them
    // in so the dashboard and Receive tab show the same spendable total the
    // send/withdraw paths use.
    if (isConfidentialRailEnabled(c.env)) {
      try {
        const confidential = await getConfidentialBalances(c.env, session.x_id);
        let pendingConfidential: Array<{ asset: string; amount: string }> = [];
        if (c.env.DB) {
          try {
            const pending = await c.env.DB.prepare(
              `SELECT asset, amount FROM withdrawals
                WHERE x_id = ? AND privacy_rail = 'confidential' AND status = 'PENDING'`
            )
              .bind(session.x_id)
              .all<{ asset: string; amount: string }>();
            pendingConfidential = pending.results || [];
          } catch {}
        }
        for (const cb of confidential) {
          const token = nearRpc.resolveTokenForAsset(cb.assetId, tokens);
          const decimals = cb.decimals ?? token?.decimals ?? 6;
          let amount = parseFloat(cb.amountFormatted) || 0;
          for (const row of pendingConfidential) {
            if (
              nearRpc.assetsMatch(row.asset, cb.assetId) ||
              nearRpc.assetsMatch(row.asset, cb.symbol)
            ) {
              amount -= parseFloat(row.amount) || 0;
            }
          }
          if (amount <= 0) continue;

          const existing = balances.find(
            (b) =>
              nearRpc.assetsMatch(b.defuse_asset_id, cb.assetId) ||
              nearRpc.assetsMatch(b.nearContractId, token?.nearContractId) ||
              nearRpc.assetsMatch(b.symbol, cb.symbol)
          );
          if (existing) {
            const current = BigInt(existing.amount || '0');
            const add = BigInt(
              nearRpc.toBaseUnits(amount.toFixed(Math.min(decimals, 18)), decimals) || '0'
            );
            existing.amount = (current + add).toString();
            existing.amountFormatted = nearRpc.formatAmount(
              existing.amount,
              existing.decimals ?? decimals
            );
            const currentIntents = BigInt(existing.intentsAmount ?? '0');
            existing.intentsAmount = (currentIntents + add).toString();
            existing.intentsAmountFormatted = nearRpc.formatAmount(
              existing.intentsAmount,
              existing.decimals ?? decimals
            );
            existing.isPlainOnly = false;
          } else {
            const baseUnits = nearRpc.toBaseUnits(
              amount.toFixed(Math.min(decimals, 18)),
              decimals
            );
            const fmt = nearRpc.formatAmount(baseUnits, decimals);
            const price = nearRpc.tokenUsdPrice(token?.symbol || cb.symbol, token?.priceUsd);
            balances.push({
              defuse_asset_id: cb.assetId,
              symbol: cb.symbol,
              amount: baseUnits,
              amountFormatted: fmt,
              intentsAmount: baseUnits,
              intentsAmountFormatted: fmt,
              isPlainOnly: false,
              decimals,
              nearContractId: token?.nearContractId || '',
              ...(token?.icon ? { icon: token.icon } : {}),
              ...(price !== null ? { priceUsd: price } : {}),
            });
          }
        }
      } catch (confErr) {
        if (confErr instanceof OneClickSelfCustodyAuthRequiredError) {
          oneClickSessionRequired = true;
        }
        console.warn('[onchain/balances] confidential balance merge skipped:', confErr);
      }
    }

    // Include virtual escrow balances claimed by user, minus active sent payments
    // and withdrawals — same canonical algorithm as getUserAvailableBalance.
    if (c.env.DB) {
      try {
        const netVirtual = await nearRpc.getVirtualBalanceDeltas(c.env, session);

        // Virtual balances must carry the SAME id/symbol/decimals as the real
        // onchain entry, otherwise the asset shows up twice.
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
            const decimals = existing.decimals || token?.decimals || 6;
            // Keep full precision — toFixed(2) here used to round sub-cent
            // virtual amounts to 0, making sent funds disappear from the UI.
            existing.amountFormatted = nearRpc.formatAmount(
              nearRpc.toBaseUnits(total.toFixed(Math.min(decimals, 18)), decimals),
              decimals
            );
            existing.amount = nearRpc.toBaseUnits(total.toFixed(Math.min(decimals, 18)), decimals);
            continue;
          }

          // If not in onchain balances and netAmt is positive, add virtual entry
          if (netAmt > 0) {
            const decimals = token?.decimals ?? (defuseId.includes('wrap.near') ? 24 : 18);
            const baseUnits = nearRpc.toBaseUnits(netAmt.toFixed(Math.min(decimals, 18)), decimals);
            const price = nearRpc.tokenUsdPrice(token?.symbol || symbol, token?.priceUsd);

            balances.push({
              defuse_asset_id: defuseId,
              symbol,
              amount: baseUnits,
              amountFormatted: nearRpc.formatAmount(baseUnits, decimals),
              decimals,
              nearContractId: token?.nearContractId || '',
              ...(token?.icon ? { icon: token.icon } : {}),
              ...(price !== null ? { priceUsd: price } : {}),
            });
          }
        }
      } catch (dbErr) {
        console.warn('[onchain/balances] D1 virtual balance lookup error:', dbErr);
      }
    }

    // On-chain balances come pre-priced; virtual ones only know what the
    // registry lists, so a launchpad holding recorded as a virtual row would
    // otherwise drop out of the dashboard subtotal.
    await nearRpc.attachMissingPrices(c.env, balances);

    // Tag 1Click-supported tokens so UI only enables Stabilize on assets that have
    // live 1Click routes (native NEAR, wNEAR, USDC, USDT, and any registry token with oneClickSupported).
    for (const b of balances) {
      const bId = (b.defuse_asset_id || '').toLowerCase();
      const bSym = (b.symbol || '').toUpperCase();
      const bContract = (b.nearContractId || '').toLowerCase();
      const regTok = tokens.find(
        (t) =>
          nearRpc.assetsMatch(t.defuse_asset_id, bId) ||
          nearRpc.assetsMatch(t.nearContractId, bContract) ||
          (t.symbol || '').toUpperCase() === bSym
      );
      const is1Click =
        bSym === 'NEAR' ||
        bSym === 'WNEAR' ||
        bId === 'nep141:wrap.near' ||
        bContract === 'wrap.near' ||
        regTok?.oneClickSupported === true;
      b.supportsOneClick = Boolean(is1Click);
    }

    return c.json({
      nearAccount,
      balances,
      ...(plainL1Locked.length > 0 ? { plainL1Locked } : {}),
      custodyMode: custody?.custodyMode ?? 'server',
      oneClickSessionRequired,
      source: 'onchain_and_virtual',
      fetchedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[onchain/balances] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch onchain balances: ${publicErrorMessage(err)}`, code: 'ONCHAIN_BALANCE_ERROR' },
      502
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
onchainRouter.get('/deposit-address', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const chain = c.req.query('chain');
  const token = c.req.query('token');
  const amount = c.req.query('amount');
  // Pin the exact NEP-141 contract when the picker knows it — tickers are not
  // unique on NEAR and a symbol-only lookup can resolve the wrong asset.
  const contract = c.req.query('contract');
  const swapTypeRaw = (c.req.query('swapType') || '').trim().toUpperCase();
  if (swapTypeRaw && swapTypeRaw !== 'EXACT_INPUT' && swapTypeRaw !== 'FLEX_INPUT') {
    return c.json<ErrorResponse>(
      { error: 'swapType must be EXACT_INPUT or FLEX_INPUT', code: 'INVALID_SWAP_TYPE' },
      400
    );
  }
  const swapType: 'EXACT_INPUT' | 'FLEX_INPUT' =
    swapTypeRaw === 'FLEX_INPUT' ? 'FLEX_INPUT' : 'EXACT_INPUT';
  const bypassCache = c.req.query('refresh') === 'true' || !!amount;
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    if (chain) {
      // Single chain (with optional token, pinned contract, exact amount, and swapType)
      const address = await nearRpc.getDepositAddress(
        c.env,
        nearAccount,
        chain,
        bypassCache,
        token,
        amount,
        contract,
        { xId: session.x_id, swapType }
      );
      if (!address) {
        return c.json<ErrorResponse>(
          { error: `No deposit address available for chain: ${chain}${token ? ` (${token})` : ''}`, code: 'NO_DEPOSIT_ADDRESS' },
          404
        );
      }
      return c.json({ address, nearAccount, source: 'onchain', fetchedAt: Date.now() });
    } else {
      // All chains
      const addresses = await nearRpc.getAllDepositAddresses(c.env, nearAccount, bypassCache, {
        xId: session.x_id,
      });
      return c.json({ addresses, nearAccount, source: 'onchain', fetchedAt: Date.now() });
    }
  } catch (err: any) {
    if (
      err instanceof OneClickSelfCustodyAuthRequiredError ||
      err?.name === 'OneClickSelfCustodyAuthRequiredError'
    ) {
      const oneClickPrepare = await prepareOneClickWebAuthnSession(
        c.env,
        session.x_id,
        session.x_handle
      );
      return c.json(
        {
          error: 'Confirm once with your passkey to unlock private receiving addresses.',
          code: 'ONECLICK_AUTH_REQUIRED',
          oneClickPrepare,
        },
        401
      );
    }
    console.error('[onchain/deposit-address] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to fetch deposit address: ${publicErrorMessage(err)}`, code: 'DEPOSIT_ADDRESS_ERROR' },
      502
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
onchainRouter.get('/deposit-status', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const address = c.req.query('address');
  if (!address) {
    return c.json<ErrorResponse>({ error: 'Missing address query param', code: 'INVALID_REQUEST' }, 400);
  }

  // NEAR-native vault ingress: assets the 1Click status API has never heard of
  // (launchpad NEP-141s) settle by arriving as a plain FT balance on the
  // caller's own vault, so their status is read from the token contract
  // instead of the bridge tracker.
  const contract = (c.req.query('contract') || '').trim();
  const tokenSymbol = c.req.query('token');

  try {
    const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);
    const effectiveContract = contract || (tokenSymbol?.toUpperCase() === 'NEAR' ? 'wrap.near' : '');
    if (effectiveContract && nearAccount && address.toLowerCase() === nearAccount.toLowerCase()) {
      const native = await nearRpc.probeNativeFtDeposit(
        c.env,
        nearAccount,
        effectiveContract,
        tokenSymbol
      );
      if (native) return c.json(native as any);
    }

    const owned = await callerOwnsDepositAddress(c.env, session, address);
    if (!owned) {
      return c.json<ErrorResponse>(
        { error: 'Deposit address not found for this account', code: 'FORBIDDEN' },
        403
      );
    }

    let authToken: string | undefined;
    if (isConfidentialRailEnabled(c.env)) {
      try {
        authToken = (await getUserSession(c.env, session.x_id)).accessToken;
      } catch (sessionErr) {
        console.warn('[onchain/deposit-status] could not mint User-Session:', sessionErr);
      }
    }

    const memoRow = await c.env.DB.prepare(
      'SELECT memo FROM deposit_addresses WHERE address = ? AND account_id = ? LIMIT 1'
    )
      .bind(address, nearAccount)
      .first<{ memo: string | null }>()
      .catch(() => null);

    const probeRes = await probeDepositStatus(
      address,
      authToken,
      c.env.ONE_CLICK_API_KEY || c.env.ONE_CLICK_JWT,
      memoRow?.memo || undefined
    );

    // If 1Click reports settled, return immediately
    const probeData = (await probeRes.clone().json().catch(() => null)) as any;
    if (probeData?.isSettled) {
      return probeRes;
    }

    // Fallback: On-chain check for mismatched/un-forwarded deposits on NEAR address
    const isNearAddress = address.length === 64 || address.endsWith('.near');
    if (isNearAddress && (contract || tokenSymbol)) {
      try {
        const supportedTokens = await nearRpc.getSupportedTokens(c.env);
        const resolvedToken = contract
          ? nearRpc.resolveTokenForAsset(contract, supportedTokens)
          : (tokenSymbol ? nearRpc.resolveTokenForAsset(tokenSymbol, supportedTokens) : null);

        const targetFtContract = contract || resolvedToken?.nearContractId || (resolvedToken?.defuse_asset_id?.startsWith('nep141:') ? resolvedToken.defuse_asset_id.replace(/^nep141:/, '') : '');
        const decimals = resolvedToken?.decimals ?? 6;

        if (targetFtContract) {
          const rawFt = await nearRpc.getPlainFtBalanceStrict(
            c.env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com',
            targetFtContract,
            address
          );
          if (rawFt && rawFt > 0n) {
            const formatted = nearRpc.formatAmount(rawFt.toString(), decimals);

            // Check if already credited in D1 to guarantee idempotency
            let txHash: string | null = null;
            const already = await c.env.DB?.prepare(
              'SELECT tx_hash FROM rescued_deposits WHERE address = ? AND contract = ? LIMIT 1'
            )
              .bind(address, targetFtContract)
              .first<{ tx_hash: string | null }>();

            if (already) {
              txHash = already.tx_hash;
            } else {
              // Forward from escrow.uprail.near to user's intents account!
              const assetName = resolvedToken?.symbol || tokenSymbol || targetFtContract;
              const settlement = await nearRpc.executeTransferFromEscrowIntent(
                c.env,
                nearAccount,
                assetName,
                formatted
              );
            if (settlement.success) {
              txHash = settlement.txHash || null;
              await c.env.DB?.prepare(
                'INSERT INTO rescued_deposits (address, contract, account_id, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
              )
                .bind(address, targetFtContract, nearAccount, formatted, txHash, Date.now())
                .run();
            } else {
              console.warn('[onchain/deposit-status] escrow rescue transfer failed:', settlement.error);
            }
          }

          if (txHash || already) {
            return c.json({
              status: 'SUCCESS',
              depositedAmount: rawFt.toString(),
              depositedAmountFormatted: formatted,
              depositedAmountUsd: formatted,
              amountInFormatted: formatted,
              amountOutFormatted: formatted,
              timeEstimate: null,
              txHashes: txHash ? [txHash] : [],
              updatedAt: new Date().toISOString(),
              isSettled: true,
              source: 'onchain_rescued_deposit',
            });
          }
        }
      }
    } catch (rescueErr) {
        console.warn('[onchain/deposit-status] rescue check error:', rescueErr);
      }
    }

    return probeRes;
  } catch (err: any) {
    // A lookup failure is not "still pending" — masking it here made the UI
    // sit on PENDING_DEPOSIT forever while the backend was actually broken.
    console.error('[onchain/deposit-status] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to check deposit status: ${publicErrorMessage(err)}`, code: 'DEPOSIT_STATUS_ERROR' },
      502
    );
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
               OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?)))
        LIMIT 1`
    )
      .bind(address, session.x_id, session.x_id, session.x_handle)
      .first<{ ok: number }>();
    return Boolean(payment);
  } catch (err) {
    // Propagate: swallowing this used to turn DB hiccups into a misleading
    // 403 "address not found".
    console.warn('[onchain/deposit-status] ownership check failed:', err);
    throw err;
  }
}

/** Queries 1Click for the deposit status of an already-authorized address. */
async function probeDepositStatus(
  address: string,
  authToken?: string,
  apiKey?: string,
  depositMemo?: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const params = new URLSearchParams({ depositAddress: address });
    if (depositMemo) params.set('depositMemo', depositMemo);
    const resp = await fetch(
      `https://1click.chaindefuser.com/v0/status?${params.toString()}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
          Accept: 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      }
    );
    clearTimeout(timeoutId);

    if (!resp.ok) {
      // 1Click is down/degraded — the deposit is genuinely unknown, so
      // PENDING_DEPOSIT is the honest state; surface the error so the UI
      // can warn instead of silently spinning.
      return Response.json({
        status: 'PENDING_DEPOSIT',
        depositedAmount: '0',
        depositedAmountFormatted: '0',
        depositedAmountUsd: '0',
        txHashes: [],
        updatedAt: null,
        isSettled: false,
        error: `Deposit status service returned ${resp.status}`,
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
onchainRouter.get('/history', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const limitParam = c.req.query('limit');
  const parsedLimit = parseInt(limitParam || '', 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session);

  try {
    const transactions = await nearRpc.getIntentHistory(c.env, nearAccount, limit);

    // Merge any detected 1Click deposit transactions
    if (c.env.DB) {
      try {
        const depositRows = await c.env.DB.prepare(
          'SELECT address, chain, memo FROM deposit_addresses WHERE account_id = ? ORDER BY updated_at DESC LIMIT 15'
        )
          .bind(nearAccount)
          .all<{ address: string; chain: string; memo: string | null }>();

        let authToken: string | undefined;
        if (isConfidentialRailEnabled(c.env)) {
          try {
            authToken = (await getUserSession(c.env, session.x_id)).accessToken;
          } catch (sessionErr) {
            console.warn('[onchain/history] could not mint User-Session:', sessionErr);
          }
        }

        // Probe all deposit addresses in parallel — sequential fetches here
        // used to stack up to ~52s of timeouts on one request.
        const depositStatuses = await Promise.all(
          (depositRows.results || [])
            .filter((dep) => dep.address)
            .map(async (dep) => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);
                const statusParams = new URLSearchParams({ depositAddress: dep.address });
                if (dep.memo) statusParams.set('depositMemo', dep.memo);
                const statusResp = await fetch(
                  `https://1click.chaindefuser.com/v0/status?${statusParams.toString()}`,
                  {
                    signal: controller.signal,
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
                      Accept: 'application/json',
                      ...(c.env.ONE_CLICK_API_KEY || c.env.ONE_CLICK_JWT
                        ? { 'X-API-Key': c.env.ONE_CLICK_API_KEY || c.env.ONE_CLICK_JWT! }
                        : {}),
                      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    },
                  }
                );
                clearTimeout(timeoutId);
                if (!statusResp.ok) return null;
                return { dep, statusData: (await statusResp.json()) as any };
              } catch {
                return null;
              }
            })
        );

        const detectedDeposits: any[] = [];
        for (const entry of depositStatuses) {
          if (!entry) continue;
          const { dep, statusData } = entry;
          try {
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
            // correlationId is unique per deposit quote, so it keeps two
            // deposits to the same address distinct even when the tx hashes are
            // absent and we would otherwise fall back to the shared address.
            const correlationId = statusData?.correlationId;
            const primaryId =
              originTx || destTx || nearTx || correlationId || dep.address;

            if (primaryId) {
              const originAsset =
                statusData?.quoteResponse?.quoteRequest?.originAsset ||
                (dep.chain === 'near' ? 'wrap.near' : `nep141:${dep.chain}.omft.near`);

              detectedDeposits.push({
                id: primaryId,
                alt_id: destTx,
                intent_type: 'deposit',
                defuse_asset_id_in: originAsset,
                amount_in: depAmt,
                // Human-readable: taken from the API's *Formatted field.
                amount_source: 'human',
                symbol: cleanMemeSymbol(originAsset),
                sender_id: dep.address,
                receiver_id: nearAccount,
                block_height: 0,
                block_timestamp: statusData.updatedAt ? new Date(statusData.updatedAt).getTime() : Date.now(),
                status: isSuccess ? 'success' : statusData.status === 'REFUNDED' ? 'failed' : 'pending',
              });
            }
          } catch {}
        }

        // The per-address status API reports only that address's latest deposit,
        // so a second deposit to a reused address used to *replace* the first in
        // the client's "Received this week" total. Persist each distinct deposit
        // and merge the accumulated set instead of the current snapshot only.
        const accumulatedDeposits = await nearRpc.recordOneClickDepositEvents(
          c.env,
          nearAccount,
          detectedDeposits
        );
        for (const dep of accumulatedDeposits) {
          const altId = (dep as any).alt_id as string | undefined;
          if (!transactions.some((t: any) => t.id === dep.id || (altId && t.id === altId))) {
            transactions.push(dep);
          }
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
              // Human-readable: straight from this worker's own D1 row.
              amount_source: 'human',
              symbol: cleanMemeSymbol(w.asset),
              sender_id: nearAccount,
              receiver_id: w.destination_address,
              block_height: 0,
              block_timestamp: new Date(w.created_at).getTime(),
              status: w.status === 'COMPLETED' ? 'success' : w.status === 'FAILED' ? 'failed' : 'pending',
            });
          }
        }

        transactions.sort((a: any, b: any) => (Number(b.block_timestamp) || 0) - (Number(a.block_timestamp) || 0));
      } catch (enrichErr) {
        // Do not fail the whole history response on an enrichment error, but
        // never swallow it either — a silent drop here looks like the user
        // simply has no local deposit/withdraw history.
        console.warn('[onchain/history] local history enrichment failed:', enrichErr);
      }
    }

    // Ensure all transactions report a clean token name/symbol (e.g. "RAEN" instead of "RAEN-E1328C")
    for (const tx of transactions as any[]) {
      if (tx.symbol) {
        tx.symbol = cleanMemeSymbol(tx.symbol);
      } else {
        const asset = tx.defuse_asset_id_in || tx.defuse_asset_id_out;
        if (asset) {
          tx.symbol = cleanMemeSymbol(asset);
        }
      }
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
      502
    );
  }
});

// ─── GET /api/onchain/account ─────────────────────────────────────────────────
/**
 * Returns the authenticated user's intent account info — existence, near account id.
 * In Virtual Intents Escrow, account creation is $0 and instant.
 */
onchainRouter.get('/account', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const report: nearRpc.ProvisionReport = { attempted: false, created: false };
  const nearAccount = await nearRpc.resolveUserNearAccount(c.env, session, report);
  // accountExists distinguishes "definitely missing" (false) from "could not
  // read" (throws). Collapsing both into hasIntentAccount:false is what made a
  // funded recipient look like they had no account, and with it no balance.
  let exists: boolean;
  try {
    exists = await nearRpc.accountExists(c.env, nearAccount);
  } catch (existsErr: any) {
    console.error('[onchain/account] accountExists failed:', existsErr);
    return c.json<ErrorResponse>(
      {
        error: 'Could not verify your on-chain account right now. Please try again.',
        code: 'ACCOUNT_LOOKUP_FAILED',
      },
      502
    );
  }

  return c.json({
    hasIntentAccount: exists,
    nearAccount,
    xHandle: session.x_handle,
    source: 'virtual_escrow',
    ...(report.error ? { provisionError: report.error } : {}),
  });
});

// ─── POST /api/onchain/stabilize/quote ────────────────────────────────────────
/**
 * Returns an accurate live 1Click quote for converting `amount` of `sourceAsset`
 * into `targetAsset` ('USDC' or 'USDT'), including the exact 1% protocol fee
 * calculated in base units.
 */
onchainRouter.post(
  '/stabilize/quote',
  requireAuth({ passkeyVerified: true }),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = await c.req
        .json<{
          sourceAsset?: string;
          targetAsset?: string;
          amount?: string;
        }>()
        .catch(() => null);

      const quote = await getStabilizeQuote(c.env, session, {
        sourceAsset: body?.sourceAsset || '',
        targetAsset: body?.targetAsset || 'USDC',
        amount: body?.amount || '',
      });
      return c.json({ quote });
    } catch (err: any) {
      if (err instanceof StabilizeError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[onchain/stabilize/quote] error:', err);
      return c.json<ErrorResponse>(
        {
          error: `Could not calculate stabilize quote: ${publicErrorMessage(err)}`,
          code: 'STABILIZE_QUOTE_FAILED',
        },
        502
      );
    }
  }
);

// ─── POST /api/onchain/stabilize ──────────────────────────────────────────────
/**
 * Executes a passkey-authorized, gas-sponsored confidential 1Click stabilization
 * swap of any held token (including plain native NEAR and NEP-141s) into USDC or
 * USDT inside the user's Confidential Intents vault, with a 1% protocol fee.
 */
onchainRouter.post(
  '/stabilize',
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      if (custody?.custodyMode === 'self') {
        return c.json<ErrorResponse>(
          {
            error:
              'Self-custody accounts must authorize stabilization via /api/onchain/stabilize/prepare and /api/onchain/stabilize/submit.',
            code: 'SELF_CUSTODY_SIGNATURE_REQUIRED',
          },
          409
        );
      }

      const body = (c.get('parsedBody' as any) ||
        (await c.req
          .json<{
            sourceAsset?: string;
            targetAsset?: string;
            amount?: string;
          }>()
          .catch(() => null))) as {
        sourceAsset?: string;
        targetAsset?: string;
        amount?: string;
      } | null;

      const result = await executeStabilize(c.env, session, {
        sourceAsset: body?.sourceAsset || '',
        targetAsset: body?.targetAsset || 'USDC',
        amount: body?.amount || '',
      });
      return c.json({ result });
    } catch (err: any) {
      if (err instanceof StabilizeError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[onchain/stabilize] error:', err);
      return c.json<ErrorResponse>(
        {
          error: `Stabilize failed: ${publicErrorMessage(err)}`,
          code: 'STABILIZE_FAILED',
        },
        502
      );
    }
  }
);

onchainRouter.post('/stabilize/prepare', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const body = await c.req
      .json<{ sourceAsset?: string; targetAsset?: string; amount?: string }>()
      .catch(() => null);
    const prepared = await prepareSelfCustodyStabilize(c.env, session, {
      sourceAsset: body?.sourceAsset || '',
      targetAsset: body?.targetAsset || 'USDC',
      amount: body?.amount || '',
    });
    return c.json(prepared);
  } catch (err: any) {
    if (err instanceof StabilizeError) {
      return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
    }
    return handleCustodyActionError(c, err, 'SELF_CUSTODY_PREPARE_FAILED', '[onchain/stabilize/prepare]');
  }
});

onchainRouter.post('/stabilize/submit', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const body = await c.req
      .json<{ actionId?: string; assertion?: unknown; step?: string }>()
      .catch(() => null);
    if (!body?.actionId || !body?.assertion) {
      return c.json<ErrorResponse>(
        { error: 'Missing actionId or WebAuthn assertion', code: 'INVALID_REQUEST' },
        400
      );
    }
    const result = await submitSelfCustodyStabilize({
      env: c.env,
      session,
      actionId: body.actionId,
      assertion: body.assertion,
      step: body.step,
    });
    await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
    return c.json(result);
  } catch (err: any) {
    if (err instanceof StabilizeError) {
      return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
    }
    return handleCustodyActionError(c, err, 'SELF_CUSTODY_SUBMIT_FAILED', '[onchain/stabilize/submit]');
  }
});

onchainRouter.post('/stabilize/shield/prepare', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const body = await c.req
      .json<{
        assetId?: string;
        expectedAmountAtomic?: string;
        sourceSwapDepositAddress?: string;
      }>()
      .catch(() => null);
    const prepared = await prepareSelfCustodyShieldTarget({
      env: c.env,
      session,
      assetId: (body?.assetId || 'usdc').trim(),
      expectedAmountAtomic: body?.expectedAmountAtomic ? BigInt(body.expectedAmountAtomic) : undefined,
      sourceSwapDepositAddress: body?.sourceSwapDepositAddress?.trim() || undefined,
      nextStep: 'stabilize',
    });
    return c.json(prepared);
  } catch (err: any) {
    return handleCustodyActionError(c, err, 'SELF_CUSTODY_SHIELD_PREPARE_FAILED', '[onchain/stabilize/shield/prepare]');
  }
});

// ─── GET /api/onchain/stabilize/status ────────────────────────────────────────
/**
 * Polls the settlement status of an in-flight confidential stabilization swap
 * by 1Click depositAddress, enabling responsive async UI progress tracking.
 */
onchainRouter.get(
  '/stabilize/status',
  requireAuth({ passkeyVerified: true }),
  async (c) => {
    const session = c.get('session')!;
    const depositAddress = (c.req.query('depositAddress') || '').trim();
    if (!depositAddress) {
      return c.json<ErrorResponse>(
        { error: 'Missing depositAddress query parameter', code: 'MISSING_PARAM' },
        400
      );
    }
    try {
      const status = await getStabilizeExecutionStatus(c.env, session, depositAddress);
      return c.json(status);
    } catch (err: any) {
      if (err instanceof OneClickSelfCustodyAuthRequiredError) {
        return c.json({
          status: 'PENDING',
          terminal: false,
          depositAddress,
          oneClickSessionRequired: true,
          code: 'ONECLICK_AUTH_REQUIRED',
        });
      }
      console.warn('[onchain/stabilize/status] status check error:', err);
      return c.json({
        status: 'PENDING',
        terminal: false,
        depositAddress,
      });
    }
  }
);



