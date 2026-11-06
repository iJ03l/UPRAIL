import { Hono } from 'hono';
import type { AppContext, ErrorResponse, PaymentRequest, PaymentRequestStatus } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { resolveShareTicker } from '../services/share';
import { publicErrorMessage } from '../utils/errors';

function normalizeHandle(rawHandle: string): string {
  return rawHandle.trim().replace(/^@+/, '').toLowerCase();
}

export const requestsRouter = new Hono<AppContext>();

/**
 * Validates X handle format (1-15 characters: letters, numbers, underscores)
 */
function isValidXHandle(handle: string): boolean {
  return /^[a-zA-Z0-9_]{1,15}$/.test(handle);
}

/**
 * Sanitizes memo to prevent XSS / control characters
 */
function sanitizeMemo(memo: unknown): string | null {
  if (typeof memo !== 'string') return null;
  const trimmed = memo.trim();
  if (!trimmed) return null;
  // Strip control chars, limit to 280 characters
  return trimmed.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 280);
}

/**
 * Cleans token ticker and formats clean amount
 */
async function sanitizeRequestRecord(env: any, req: PaymentRequest): Promise<PaymentRequest> {
  const ticker = await resolveShareTicker(env, req.asset);
  const cleanTicker = ticker || (req.asset.includes(':') ? req.asset.split(':').pop() : req.asset) || 'USDC';
  let amountFormatted = req.amount_formatted;
  if (!amountFormatted || amountFormatted.includes('nep141:') || /^[0-9a-f]{64}/i.test(amountFormatted.split(' ').pop() || '')) {
    amountFormatted = `${req.amount} ${cleanTicker}`;
  }
  return {
    ...req,
    amount_formatted: amountFormatted,
    requester_avatar: req.requester_avatar || `https://unavatar.io/twitter/${req.requester_handle}`,
  };
}

/**
 * POST /api/requests
 * Creates a new UPRAIL payment request targeting any 𝕏 handle (registered or not).
 * Requires biometric Passkey authorization.
 * Rate limited to 10 requests / hour per user.
 */
requestsRouter.post('/', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) {
      return c.json<ErrorResponse>({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }

    const body = ((c.get('parsedBody' as any) || await c.req.json().catch(() => ({}))) as {
      requestedHandle: string;
      asset: string;
      amount: string;
      memo?: string;
      expiresInDays?: number;
    });

    const targetHandle = normalizeHandle(body.requestedHandle || '');
    if (!targetHandle || !isValidXHandle(targetHandle)) {
      return c.json<ErrorResponse>(
        { error: 'Valid 𝕏 handle required (1-15 characters, alphanumeric or _)', code: 'INVALID_HANDLE' },
        400
      );
    }

    const requesterHandle = normalizeHandle(session.x_handle);
    if (targetHandle === requesterHandle) {
      return c.json<ErrorResponse>(
        { error: 'You cannot request payment from yourself', code: 'SELF_REQUEST_FORBIDDEN' },
        400
      );
    }

    const amountNum = parseFloat(body.amount);
    if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
      return c.json<ErrorResponse>(
        { error: 'Amount must be a positive number', code: 'INVALID_AMOUNT' },
        400
      );
    }

    const asset = (body.asset || 'USDC').trim();
    if (!asset || asset.length > 128) {
      return c.json<ErrorResponse>(
        { error: 'Invalid asset specified', code: 'INVALID_ASSET' },
        400
      );
    }

    // 1. Anti-spam Rate Limit: max 10 requests per hour per user
    const oneHourAgo = Date.now() - 3600 * 1000;
    const hourlyCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM payment_requests WHERE requester_x_id = ? AND created_at > ?`
    )
      .bind(session.x_id, oneHourAgo)
      .first<{ count: number }>();

    if (hourlyCount && hourlyCount.count >= 10) {
      return c.json<ErrorResponse>(
        { error: 'Rate limit reached: Maximum 10 payment requests per hour', code: 'RATE_LIMIT_EXCEEDED' },
        429
      );
    }

    // 2. Check if the target user has blocked this requester
    const blocked = await c.env.DB.prepare(
      `SELECT 1 FROM request_blocks b
       JOIN x_identities x ON b.user_x_id = x.x_id
       WHERE LOWER(x.x_handle) = ? AND (LOWER(b.blocked_handle) = ? OR b.blocked_handle = ?)`
    )
      .bind(targetHandle, requesterHandle, session.x_id)
      .first();

    if (blocked) {
      return c.json<ErrorResponse>(
        { error: 'This user is not accepting payment requests', code: 'REQUEST_BLOCKED' },
        403
      );
    }

    // 3. Resolve target user registration status
    const targetUser = await c.env.DB.prepare(
      `SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ?`
    )
      .bind(targetHandle)
      .first<{ x_id: string }>();

    const targetXId = targetUser?.x_id || null;

    // 4. Duplicate pending check: avoid spamming the exact same request within 24h
    const oneDayAgo = Date.now() - 86400 * 1000;
    const existing = await c.env.DB.prepare(
      `SELECT id FROM payment_requests
       WHERE requester_x_id = ? AND LOWER(requested_handle) = ? AND asset = ? AND amount = ? AND status = 'PENDING' AND created_at > ?`
    )
      .bind(session.x_id, targetHandle, asset, body.amount, oneDayAgo)
      .first<{ id: string }>();

    if (existing) {
      return c.json<ErrorResponse>(
        { error: 'An identical pending request to this user already exists', code: 'DUPLICATE_REQUEST' },
        409
      );
    }

    // 5. Expiration: default 7 days, max 30 days
    const days = Math.min(Math.max(body.expiresInDays || 7, 1), 30);
    const now = Date.now();
    const expiresAt = now + days * 86400 * 1000;

    const id = `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const memo = sanitizeMemo(body.memo);
    const ticker = await resolveShareTicker(c.env, asset);
    const cleanTicker = ticker || (asset.includes(':') ? asset.split(':').pop() : asset) || 'USDC';
    const amountFormatted = `${body.amount} ${cleanTicker}`;

    await c.env.DB.prepare(
      `INSERT INTO payment_requests (
        id, requester_x_id, requester_handle, requested_handle, requested_x_id,
        asset, amount, amount_formatted, memo, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
    )
      .bind(
        id,
        session.x_id,
        requesterHandle,
        targetHandle,
        targetXId,
        asset,
        body.amount,
        amountFormatted,
        memo,
        now,
        expiresAt
      )
      .run();

    // 6. Record or update in contacts table
    try {
      const contactId = `cnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await c.env.DB.prepare(
        `INSERT INTO contacts (id, user_x_id, contact_handle, contact_x_id, preferred_asset, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(user_x_id, contact_handle) DO UPDATE SET updated_at = ?`
      )
        .bind(contactId, session.x_id, targetHandle, targetXId, asset, now, now, now)
        .run();
    } catch {}

    const requestRecord: PaymentRequest = {
      id,
      requester_x_id: session.x_id,
      requester_handle: requesterHandle,
      requested_handle: targetHandle,
      requested_x_id: targetXId,
      asset,
      amount: body.amount,
      amount_formatted: amountFormatted,
      memo,
      status: 'PENDING',
      created_at: now,
      expires_at: expiresAt,
    };

    return c.json({ success: true, request: requestRecord });
  } catch (err) {
    console.error('[createRequest] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to create payment request'), code: 'REQUEST_CREATE_FAILED' },
      500
    );
  }
});

/**
 * GET /api/requests/incoming
 * Returns incoming payment requests for the authenticated user.
 */
requestsRouter.get('/incoming', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) return c.json({ requests: [] });

    const userHandle = normalizeHandle(session.x_handle);
    const now = Date.now();

    // Auto-expire overdue requests in background
    await c.env.DB.prepare(
      `UPDATE payment_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?`
    )
      .bind(now)
      .run();

    const rows = await c.env.DB.prepare(
      `SELECT * FROM payment_requests
       WHERE (LOWER(requested_handle) = ? OR requested_x_id = ?)
       ORDER BY created_at DESC LIMIT 50`
    )
      .bind(userHandle, session.x_id)
      .all<PaymentRequest>();

    const sanitized = await Promise.all((rows.results || []).map((r) => sanitizeRequestRecord(c.env, r)));
    return c.json({ requests: sanitized });
  } catch (err) {
    console.error('[incomingRequests] error:', err);
    return c.json({ requests: [] });
  }
});

/**
 * GET /api/requests/outgoing
 * Returns requests created by the authenticated user.
 */
requestsRouter.get('/outgoing', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) return c.json({ requests: [] });

    const now = Date.now();
    await c.env.DB.prepare(
      `UPDATE payment_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?`
    )
      .bind(now)
      .run();

    const rows = await c.env.DB.prepare(
      `SELECT * FROM payment_requests
       WHERE requester_x_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
      .bind(session.x_id)
      .all<PaymentRequest>();

    const sanitized = await Promise.all((rows.results || []).map((r) => sanitizeRequestRecord(c.env, r)));
    return c.json({ requests: sanitized });
  } catch (err) {
    console.error('[outgoingRequests] error:', err);
    return c.json({ requests: [] });
  }
});

/**
 * GET /api/requests/blocks
 * Lists users blocked from sending requests to the authenticated user.
 */
requestsRouter.get('/blocks', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) return c.json({ blockedHandles: [] });

    const rows = await c.env.DB.prepare(
      `SELECT blocked_handle, created_at FROM request_blocks WHERE user_x_id = ? ORDER BY created_at DESC`
    )
      .bind(session.x_id)
      .all<{ blocked_handle: string; created_at: number }>();

    return c.json({ blocked: rows.results || [] });
  } catch (err) {
    return c.json({ blocked: [] });
  }
});

/**
 * POST /api/requests/block
 * Blocks a handle from sending payment requests.
 */
requestsRouter.post('/block', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const body = await c.req.json<{ handle: string }>();
    const handle = normalizeHandle(body.handle || '');
    if (!handle) {
      return c.json<ErrorResponse>({ error: 'Handle required', code: 'INVALID_HANDLE' }, 400);
    }

    await c.env.DB.prepare(
      `INSERT INTO request_blocks (user_x_id, blocked_handle, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_x_id, blocked_handle) DO NOTHING`
    )
      .bind(session.x_id, handle, Date.now())
      .run();

    return c.json({ success: true, blocked: handle });
  } catch (err) {
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to block handle'), code: 'BLOCK_FAILED' }, 500);
  }
});

/**
 * DELETE /api/requests/block/:handle
 * Unblocks a handle.
 */
requestsRouter.delete('/block/:handle', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const handle = normalizeHandle(c.req.param('handle'));

    await c.env.DB.prepare(
      `DELETE FROM request_blocks WHERE user_x_id = ? AND LOWER(blocked_handle) = ?`
    )
      .bind(session.x_id, handle)
      .run();

    return c.json({ success: true, unblocked: handle });
  } catch (err) {
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to unblock handle'), code: 'UNBLOCK_FAILED' }, 500);
  }
});

/**
 * GET /api/requests/:id
 * PUBLIC endpoint: anyone can view a payment request (no auth required!).
 * Crucial requirement: recipients do not need an account just to view the request.
 */
requestsRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      return c.json<ErrorResponse>({ error: 'Invalid request ID', code: 'NOT_FOUND' }, 404);
    }

    if (!c.env.DB) {
      return c.json<ErrorResponse>({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }

    const req = await c.env.DB.prepare(
      `SELECT * FROM payment_requests WHERE id = ?`
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!req) {
      return c.json<ErrorResponse>({ error: 'Payment request not found', code: 'NOT_FOUND' }, 404);
    }

    // Check expiry
    const now = Date.now();
    if (req.status === 'PENDING' && req.expires_at < now) {
      req.status = 'EXPIRED';
      await c.env.DB.prepare(`UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?`).bind(id).run();
    }

    // Get requester info
    let requester: { x_handle: string; x_name: string; avatar_url: string | null } | null = null;
    try {
      requester = await c.env.DB.prepare(
        `SELECT x_handle, x_name, avatar_url FROM x_identities WHERE x_id = ?`
      )
        .bind(req.requester_x_id)
        .first<{ x_handle: string; x_name: string; avatar_url: string | null }>();
    } catch {
      try {
        const r = await c.env.DB.prepare(
          `SELECT x_handle, x_name FROM x_identities WHERE x_id = ?`
        )
          .bind(req.requester_x_id)
          .first<{ x_handle: string; x_name: string }>();
        if (r) requester = { ...r, avatar_url: null };
      } catch {}
    }

    // Check if target recipient is registered
    const recipientUser = await c.env.DB.prepare(
      `SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ?`
    )
      .bind(normalizeHandle(req.requested_handle))
      .first<{ x_id: string }>();

    const sanitized = await sanitizeRequestRecord(c.env, req);

    return c.json({
      request: {
        ...sanitized,
        requester_name: requester?.x_name || req.requester_handle,
        requester_avatar: requester?.avatar_url || `https://unavatar.io/twitter/${requester?.x_handle || req.requester_handle}`,
        is_recipient_registered: !!recipientUser,
      },
    });
  } catch (err) {
    console.error('[getRequest] error:', err);
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to fetch request'), code: 'REQUEST_FETCH_FAILED' }, 500);
  }
});

/**
 * POST /api/requests/:id/decline
 * Allows the requested recipient to decline the payment request.
 */
requestsRouter.post('/:id/decline', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const id = c.req.param('id');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));

    const req = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?`).bind(id).first<PaymentRequest>();
    if (!req) {
      return c.json<ErrorResponse>({ error: 'Request not found', code: 'NOT_FOUND' }, 404);
    }

    const currentHandle = normalizeHandle(session.x_handle);
    const requestedHandle = normalizeHandle(req.requested_handle);

    if (session.x_id !== req.requested_x_id && currentHandle !== requestedHandle) {
      return c.json<ErrorResponse>({ error: 'Unauthorized: Only the requested recipient can decline', code: 'UNAUTHORIZED' }, 403);
    }

    if (req.status !== 'PENDING') {
      return c.json<ErrorResponse>({ error: `Request cannot be declined (current status: ${req.status})`, code: 'INVALID_STATUS' }, 400);
    }

    const reason = sanitizeMemo(body.reason);
    const declineResult = await c.env.DB.prepare(
      `UPDATE payment_requests SET status = 'DECLINED', decline_reason = ?, completed_at = ? WHERE id = ? AND status = 'PENDING'`
    )
      .bind(reason, Date.now(), id)
      .run();

    if ((declineResult.meta?.changes ?? 0) === 0) {
      return c.json<ErrorResponse>({ error: 'Request is no longer pending', code: 'INVALID_STATUS' }, 409);
    }

    return c.json({ success: true, status: 'DECLINED' });
  } catch (err) {
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to decline request'), code: 'DECLINE_FAILED' }, 500);
  }
});

/**
 * POST /api/requests/:id/cancel
 * Allows the requester to cancel their own pending request.
 */
requestsRouter.post('/:id/cancel', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const id = c.req.param('id');

    const req = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?`).bind(id).first<PaymentRequest>();
    if (!req) {
      return c.json<ErrorResponse>({ error: 'Request not found', code: 'NOT_FOUND' }, 404);
    }

    if (session.x_id !== req.requester_x_id) {
      return c.json<ErrorResponse>({ error: 'Unauthorized: Only the requester can cancel', code: 'UNAUTHORIZED' }, 403);
    }

    if (req.status !== 'PENDING') {
      return c.json<ErrorResponse>({ error: `Request cannot be cancelled (current status: ${req.status})`, code: 'INVALID_STATUS' }, 400);
    }

    const cancelResult = await c.env.DB.prepare(
      `UPDATE payment_requests SET status = 'CANCELLED', completed_at = ? WHERE id = ? AND status = 'PENDING'`
    )
      .bind(Date.now(), id)
      .run();

    if ((cancelResult.meta?.changes ?? 0) === 0) {
      return c.json<ErrorResponse>({ error: 'Request is no longer pending', code: 'INVALID_STATUS' }, 409);
    }

    return c.json({ success: true, status: 'CANCELLED' });
  } catch (err) {
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to cancel request'), code: 'CANCEL_FAILED' }, 500);
  }
});

/**
 * POST /api/requests/:id/accept
 * Marks a request completed when paid.
 * Can be called with paymentId to link settlement.
 */
requestsRouter.post('/:id/accept', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const id = c.req.param('id');
    const body = ((c.get('parsedBody' as any) || await c.req.json().catch(() => ({}))) as { paymentId?: string });

    const req = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?`).bind(id).first<PaymentRequest>();
    if (!req) {
      return c.json<ErrorResponse>({ error: 'Request not found', code: 'NOT_FOUND' }, 404);
    }

    const currentHandle = normalizeHandle(session.x_handle);
    const requestedHandle = normalizeHandle(req.requested_handle);

    if (session.x_id !== req.requested_x_id && currentHandle !== requestedHandle) {
      return c.json<ErrorResponse>({ error: 'Unauthorized: Only the requested recipient can accept', code: 'UNAUTHORIZED' }, 403);
    }

    if (req.status === 'COMPLETED') {
      return c.json({ success: true, status: 'COMPLETED', paymentId: req.payment_id });
    }

    if (req.status !== 'PENDING') {
      return c.json<ErrorResponse>({ error: `Request cannot be accepted (current status: ${req.status})`, code: 'INVALID_STATUS' }, 400);
    }

    // If paymentId was provided, verify it belongs to this transaction
    if (body.paymentId) {
      const payment = await c.env.DB.prepare(
        `SELECT id, sender_x_id, recipient_handle FROM payments WHERE id = ?`
      )
        .bind(body.paymentId)
        .first<{ id: string; sender_x_id: string; recipient_handle: string }>();

      if (!payment || payment.sender_x_id !== session.x_id) {
        return c.json<ErrorResponse>({ error: 'Invalid payment ID provided', code: 'INVALID_PAYMENT' }, 400);
      }
    }

    const now = Date.now();
    const acceptResult = await c.env.DB.prepare(
      `UPDATE payment_requests SET status = 'COMPLETED', payment_id = ?, completed_at = ? WHERE id = ? AND status = 'PENDING'`
    )
      .bind(body.paymentId || null, now, id)
      .run();

    if ((acceptResult.meta?.changes ?? 0) === 0) {
      return c.json<ErrorResponse>({ error: 'Request is no longer pending or already completed', code: 'INVALID_STATUS' }, 409);
    }

    return c.json({ success: true, status: 'COMPLETED', paymentId: body.paymentId || null });
  } catch (err) {
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Failed to complete request'), code: 'COMPLETE_FAILED' }, 500);
  }
});
