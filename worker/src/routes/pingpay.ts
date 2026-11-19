/**
 * PingPay Fiat Onramp Proxy Routes (`/api/pingpay/*`)
 *
 * Exposes a locked-down, USDC-only fiat onramp API inside UPRAIL by fronting
 * PingPay's onramp endpoints (`https://api.pingpay.io/api/onramp/*`):
 *   - Strips `CRYPTO` payment methods (crypto deposits already have dedicated tabs)
 *   - Locks destination asset/network server-side to USDC on NEAR
 *   - Verifies recipientAddress ownership against the caller's UPRAIL account
 *   - Pre-probes fiat payment methods against PingPay `/quote` so unsupported
 *     regional methods never render a broken "No quote found for asset" state
 *   - Stores PingPay upstream session cookies server-side in KV scoped to `x_id`
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext, Env, ErrorResponse, Session } from '../types';
import { requireAuth } from '../middleware/session';
import * as nearRpc from '../services/nearRpc';
import { publicErrorMessage } from '../utils/errors';

const PINGPAY_API_ORIGIN = 'https://api.pingpay.io';
const PINGPAY_WIDGET_ORIGIN = 'https://onramp.pingpay.io';
const ALLOWED_FIAT_METHODS = new Set(['APPLE_PAY', 'GOOGLE_PAY']);
const LOCKED_TARGET = { chain: 'near', asset: 'USDC' } as const;
const SESSION_KV_TTL_SECONDS = 900; // 15 minutes

export const pingpayRouter = new Hono<AppContext>();

function cookieKey(xId: string): string {
  return `pingpay:session:${xId}`;
}

function mergeCookies(existing: string | null, setCookies: string[]): string {
  const jar = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  for (const raw of setCookies) {
    const kv = raw.split(';')[0]?.trim() || '';
    const eq = kv.indexOf('=');
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function extractSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as any;
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie() as string[];
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

async function pingpayRequest(
  c: any,
  xId: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: any; rawText: string }> {
  const kvKey = cookieKey(xId);
  let storedCookie: string | null = null;
  if (c.env.CACHE) {
    storedCookie = await c.env.CACHE.get(kvKey).catch(() => null);
  }

  const ua = c.req.header('user-agent');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': PINGPAY_WIDGET_ORIGIN,
    'Referer': `${PINGPAY_WIDGET_ORIGIN}/`,
  };
  if (ua) headers['User-Agent'] = ua;
  if (storedCookie) headers['Cookie'] = storedCookie;

  const res = await fetch(`${PINGPAY_API_ORIGIN}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const incomingCookies = extractSetCookies(res);
  if (incomingCookies.length > 0 && c.env.CACHE) {
    const merged = mergeCookies(storedCookie, incomingCookies);
    if (merged) {
      await c.env.CACHE.put(kvKey, merged, { expirationTtl: SESSION_KV_TTL_SECONDS }).catch(() => {});
    }
  }

  const rawText = await res.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, rawText };
}

function parsePositiveAmount(raw: unknown): string | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return s;
}

function validateFiatMethod(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!s || s === 'CRYPTO' || !ALLOWED_FIAT_METHODS.has(s)) return null;
  return s;
}

function normalizeUsPhone(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (/^\+1\d{10}$/.test(s)) return s;
  return null;
}

function extractPingPayError(data: any, rawText: string, fallback: string): string {
  return (
    data?.details?.error ||
    data?.error ||
    data?.message ||
    (rawText && rawText.length < 180 ? rawText : fallback)
  );
}

function pingpayUpstreamError(
  c: any,
  res: { status: number; data: any; rawText: string },
  code: string,
  fallback: string
) {
  const status = (res.status >= 400 && res.status < 500 ? res.status : 502) as ContentfulStatusCode;
  return c.json(
    { error: extractPingPayError(res.data, res.rawText, fallback), code },
    status
  );
}

async function verifyOwnedRecipientAddress(
  env: Env,
  session: Session,
  address: string
): Promise<boolean> {
  const trimmed = address.trim();
  if (!trimmed) return false;
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  if (trimmed === nearAccount) return true;
  if (!env.DB) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM deposit_addresses WHERE address = ? AND account_id = ? LIMIT 1'
  )
    .bind(trimmed, nearAccount)
    .first<{ ok: number }>()
    .catch(() => null);
  return Boolean(row?.ok);
}

// ─── GET /api/pingpay/config ─────────────────────────────────────────────────
pingpayRouter.get('/config', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const currency = (c.req.query('currency') || 'USD').trim().toUpperCase() || 'USD';
  const cfCountry = ((c.req.raw as any)?.cf?.country as string | undefined) || null;

  try {
    const cfgRes = await pingpayRequest(c, session.x_id, '/api/onramp/config', {
      targetAsset: LOCKED_TARGET,
      currency,
    });
    if (!cfgRes.ok || !cfgRes.data) {
      return c.json<ErrorResponse>(
        { error: 'Could not check payment methods right now.', code: 'PINGPAY_CONFIG_FAILED' },
        502
      );
    }

    const rawAvailable: string[] = Array.isArray(cfgRes.data.availablePaymentMethods)
      ? cfgRes.data.availablePaymentMethods
      : [];
    // Never offer Pay using Crypto in Card & Cash
    const fiatCandidates = rawAvailable.filter((m) => validateFiatMethod(m) !== null);

    const rawCurrencies: Array<{ id?: string; limits?: Array<{ id: string; min: string; max: string }> }> =
      Array.isArray(cfgRes.data.paymentCurrencies) ? cfgRes.data.paymentCurrencies : [];
    const currencyIds = rawCurrencies
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    const activeCurrency = currencyIds[0] || currency;

    // Pre-probe every candidate fiat method with $25 quote so we only expose
    // methods that actually return a valid USDC quote (never "No quote found for asset").
    const probeResults = await Promise.all(
      fiatCandidates.map(async (method) => {
        const q = await pingpayRequest(c, session.x_id, '/api/onramp/quote', {
          amount: '25',
          sourceCurrency: activeCurrency,
          destinationAsset: LOCKED_TARGET,
          paymentMethod: method,
        });
        return q.ok && q.data?.estimatedReceiveAmount ? method : null;
      })
    );
    const workingMethods = probeResults.filter((m): m is string => Boolean(m));

    const limitsByMethod: Record<string, { min: string; max: string }> = {};
    const firstCurrencyObj = rawCurrencies[0];
    if (firstCurrencyObj && Array.isArray(firstCurrencyObj.limits)) {
      for (const lim of firstCurrencyObj.limits) {
        if (lim?.id) {
          limitsByMethod[lim.id.toUpperCase()] = { min: lim.min, max: lim.max };
        }
      }
    }

    const fiatAvailable = workingMethods.length > 0;
    return c.json({
      fiatAvailable,
      availablePaymentMethods: workingMethods,
      paymentCurrencies: currencyIds.length > 0 ? currencyIds : fiatAvailable ? [activeCurrency] : [],
      defaultCurrency: activeCurrency,
      limitsByMethod,
      isIosDevice: Boolean(cfgRes.data.isIosDevice),
      userCountry: cfCountry,
      lockedTarget: LOCKED_TARGET,
    });
  } catch (err: any) {
    console.error('[pingpay/config] error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to load payment options: ${publicErrorMessage(err)}`, code: 'PINGPAY_ERROR' },
      502
    );
  }
});

// ─── POST /api/pingpay/quote ─────────────────────────────────────────────────
pingpayRouter.post('/quote', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = parsePositiveAmount(body.amount);
  const paymentMethod = validateFiatMethod(body.paymentMethod);
  const sourceCurrency =
    typeof body.sourceCurrency === 'string' && /^[A-Z]{3}$/.test(body.sourceCurrency.trim().toUpperCase())
      ? body.sourceCurrency.trim().toUpperCase()
      : 'USD';

  if (!amount || !paymentMethod) {
    return c.json<ErrorResponse>(
      { error: 'Enter a valid amount and fiat payment method.', code: 'INVALID_REQUEST' },
      400
    );
  }

  try {
    const res = await pingpayRequest(c, session.x_id, '/api/onramp/quote', {
      amount,
      sourceCurrency,
      destinationAsset: LOCKED_TARGET,
      paymentMethod,
    });
    if (!res.ok || !res.data?.estimatedReceiveAmount) {
      return pingpayUpstreamError(
        c,
        res,
        'PINGPAY_QUOTE_UNAVAILABLE',
        'Could not get a quote for this amount.'
      );
    }
    return c.json({
      estimatedReceiveAmount: res.data.estimatedReceiveAmount,
      fees: res.data.fees || null,
      originNetwork: res.data.originNetwork || null,
      originAsset: res.data.originAsset || null,
      quoteDeadline: res.data.quoteDeadline || null,
      lockedTarget: LOCKED_TARGET,
    });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: `Quote failed: ${publicErrorMessage(err)}`, code: 'PINGPAY_QUOTE_ERROR' },
      502
    );
  }
});

// ─── POST /api/pingpay/otp/start ─────────────────────────────────────────────
pingpayRouter.post('/otp/start', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = normalizeUsPhone(body.phone);
  if (!phone) {
    return c.json<ErrorResponse>(
      { error: 'Enter a valid 10-digit US mobile number.', code: 'INVALID_PHONE' },
      400
    );
  }
  const res = await pingpayRequest(c, session.x_id, '/api/onramp/otp/start', { phone });
  if (!res.ok) {
    return pingpayUpstreamError(c, res, 'OTP_START_FAILED', "Couldn't send the code.");
  }
  return c.json({ sent: true });
});

// ─── POST /api/pingpay/otp/check ─────────────────────────────────────────────
pingpayRouter.post('/otp/check', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = normalizeUsPhone(body.phone);
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  if (!phone || code.length !== 6) {
    return c.json<ErrorResponse>(
      { error: 'Enter the 6-digit code sent to your US number.', code: 'INVALID_OTP' },
      400
    );
  }
  const res = await pingpayRequest(c, session.x_id, '/api/onramp/otp/check', { phone, code });
  if (!res.ok || !res.data?.token) {
    return pingpayUpstreamError(c, res, 'OTP_CHECK_FAILED', "That code wasn't right. Try again.");
  }
  return c.json({
    status: res.data.status,
    token: res.data.token,
    exp: res.data.exp,
  });
});

function isHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

async function parseOrderPrepareBody(
  c: any,
  session: Session
): Promise<
  | {
      ok: true;
      amount: string;
      recipientAddress: string;
      selectedCurrency: string;
      body: Record<string, unknown>;
    }
  | { ok: false; response: Response }
> {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = parsePositiveAmount(body.amount);
  const recipientAddress =
    typeof body.recipientAddress === 'string' ? body.recipientAddress.trim() : '';
  const selectedCurrency =
    typeof body.selectedCurrency === 'string' &&
    /^[A-Z]{3}$/.test(body.selectedCurrency.trim().toUpperCase())
      ? body.selectedCurrency.trim().toUpperCase()
      : 'USD';

  if (!amount) {
    return {
      ok: false,
      response: c.json({ error: 'Enter a valid amount.', code: 'INVALID_AMOUNT' }, 400),
    };
  }
  if (!(await verifyOwnedRecipientAddress(c.env, session, recipientAddress))) {
    return {
      ok: false,
      response: c.json(
        { error: 'Receiving address does not match your account.', code: 'FORBIDDEN' },
        403
      ),
    };
  }
  return { ok: true, amount, recipientAddress, selectedCurrency, body };
}

// ─── POST /api/pingpay/create-order ──────────────────────────────────────────
pingpayRouter.post('/create-order', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const parsed = await parseOrderPrepareBody(c, session);
  if (!parsed.ok) return parsed.response;

  const { amount, recipientAddress, selectedCurrency, body } = parsed;
  const paymentMethod = validateFiatMethod(body.paymentMethod);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = normalizeUsPhone(body.phone);
  const verificationToken =
    typeof body.verificationToken === 'string' ? body.verificationToken.trim() : undefined;

  if (!paymentMethod) {
    return c.json<ErrorResponse>(
      { error: 'Only Apple Pay and Google Pay are supported.', code: 'INVALID_ORDER_PARAMS' },
      400
    );
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone) {
    return c.json<ErrorResponse>(
      { error: 'Valid email and US mobile number are required.', code: 'INVALID_CONTACT' },
      400
    );
  }

  const res = await pingpayRequest(c, session.x_id, '/api/onramp/headless/create-order', {
    amount,
    paymentMethod,
    recipientAddress,
    selectedAsset: LOCKED_TARGET.asset,
    selectedNetwork: LOCKED_TARGET.chain,
    selectedCurrency,
    partnerUserRef: `uprail_${session.x_id}`,
    email,
    phone,
    ...(verificationToken ? { verificationToken } : {}),
  });

  if (res.status === 403) {
    return c.json(
      {
        error: extractPingPayError(res.data, res.rawText, 'Phone verification required'),
        code: 'VERIFICATION_REQUIRED',
      },
      403
    );
  }
  if (!res.ok || !isHttpsUrl(res.data?.paymentLinkUrl)) {
    return pingpayUpstreamError(
      c,
      res,
      'PINGPAY_ORDER_FAILED',
      'Could not start Apple Pay / Google Pay checkout.'
    );
  }

  return c.json(res.data);
});
