import { Hono } from 'hono';
import type { AppContext, Contact, ErrorResponse } from '../types';
import { requireAuth } from '../middleware/session';
import { publicErrorMessage } from '../utils/errors';
import { resolveAccount } from '../services/accountResolver';

function normalizeHandle(rawHandle: string): string {
  return rawHandle.trim().replace(/^@+/, '').toLowerCase();
}

export const contactsRouter = new Hono<AppContext>();

/**
 * GET /api/contacts
 * Returns persistent and frequently-used recipients for the authenticated user,
 * automatically merged with transfer history from the payments table.
 */
contactsRouter.get('/', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) {
      return c.json({ contacts: [] });
    }

    // 1. Fetch persistent user-saved contacts
    const saved = await c.env.DB.prepare(
      `SELECT * FROM contacts WHERE user_x_id = ? ORDER BY is_pinned DESC, updated_at DESC`
    )
      .bind(session.x_id)
      .all<Contact>();

    const savedContacts = saved.results || [];
    const contactMap = new Map<string, Contact>();
    for (const sc of savedContacts) {
      contactMap.set(sc.contact_handle.toLowerCase(), { ...sc });
    }

    // 2. Fetch past payment recipients to automatically populate frequent transfers
    const history = await c.env.DB.prepare(
      `SELECT recipient_handle, MAX(created_at) as last_transfer_at, COUNT(*) as transfer_count, asset, amount
         FROM payments
        WHERE sender_x_id = ? AND status != 'CANCELLED'
        GROUP BY recipient_handle
        ORDER BY last_transfer_at DESC
        LIMIT 25`
    )
      .bind(session.x_id)
      .all<{ recipient_handle: string; last_transfer_at: number; transfer_count: number; asset: string; amount: string }>();

    const historyRows = history.results || [];

    // 3. Merge history into contacts
    for (const h of historyRows) {
      const cleanHandle = normalizeHandle(h.recipient_handle);
      if (!cleanHandle) continue;

      if (contactMap.has(cleanHandle)) {
        const existing = contactMap.get(cleanHandle)!;
        existing.last_transfer_at = h.last_transfer_at;
        existing.transfer_count = h.transfer_count;
        if (!existing.preferred_asset) existing.preferred_asset = h.asset;
      } else {
        contactMap.set(cleanHandle, {
          id: `hist_${cleanHandle}`,
          user_x_id: session.x_id,
          contact_handle: cleanHandle,
          contact_x_id: null,
          nickname: null,
          preferred_amount: null,
          preferred_asset: h.asset || 'USDC',
          is_pinned: 0,
          created_at: h.last_transfer_at,
          updated_at: h.last_transfer_at,
          last_transfer_at: h.last_transfer_at,
          transfer_count: h.transfer_count,
        });
      }
    }

    // 4. Batch query x_identities to check who is registered on UPRAIL
    const allHandles = Array.from(contactMap.keys());
    if (allHandles.length > 0) {
      const placeholders = allHandles.map(() => '?').join(',');
      const identities = await c.env.DB.prepare(
        `SELECT x_id, x_handle, avatar_url FROM x_identities WHERE LOWER(x_handle) IN (${placeholders})`
      )
        .bind(...allHandles)
        .all<{ x_id: string; x_handle: string; avatar_url: string | null }>();

      const identityMap = new Map<string, { id: string; avatar_url: string | null }>();
      for (const id of identities.results || []) {
        identityMap.set(id.x_handle.toLowerCase(), { id: id.x_id, avatar_url: id.avatar_url });
      }

      for (const [handle, item] of contactMap.entries()) {
        const match = identityMap.get(handle);
        if (match) {
          item.is_registered = true;
          item.contact_x_id = match.id;
          item.avatar_url = match.avatar_url || `https://unavatar.io/twitter/${handle}`;
        } else {
          item.is_registered = false;
          item.avatar_url = `https://unavatar.io/twitter/${handle}`;
        }
      }
    } else {
      for (const [handle, item] of contactMap.entries()) {
        item.avatar_url = `https://unavatar.io/twitter/${handle}`;
      }
    }

    // 5. Sort: Pinned first, then by most recent transfer
    const sorted = Array.from(contactMap.values()).sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
      const tA = a.last_transfer_at || a.updated_at || 0;
      const tB = b.last_transfer_at || b.updated_at || 0;
      return tB - tA;
    });

    return c.json({ contacts: sorted });
  } catch (err: any) {
    console.error('[/api/contacts] fetch error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to retrieve contacts', code: 'FETCH_CONTACTS_ERROR' },
      500
    );
  }
});

/**
 * POST /api/contacts
 * Adds or updates a saved contact (pinning, nickname, preferred amount)
 */
contactsRouter.post('/', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) {
      return c.json<ErrorResponse>({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }

    const body = await c.req.json().catch(() => ({})) as any;
    const cleanHandle = normalizeHandle(body.handle || '');
    if (!cleanHandle) {
      return c.json<ErrorResponse>({ error: 'Valid X handle is required', code: 'INVALID_HANDLE' }, 400);
    }

    // Disallow self-contact
    if (cleanHandle === session.x_handle.toLowerCase()) {
      return c.json<ErrorResponse>({ error: 'Cannot add yourself to contacts', code: 'SELF_CONTACT' }, 400);
    }

    const resolved = await resolveAccount(c.env, cleanHandle);
    if (!resolved.ok) {
      return c.json<ErrorResponse>({ error: resolved.error, code: resolved.code }, resolved.status as any);
    }

    // Check if user is registered on UPRAIL
    const targetUser = await c.env.DB.prepare(
      'SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ?'
    )
      .bind(cleanHandle)
      .first<{ x_id: string }>();

    const contactId = `cnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Date.now();
    const isPinned = body.isPinned ? 1 : 0;
    const nickname = (body.nickname || '').trim().slice(0, 50) || null;
    const preferredAmount = (body.preferredAmount || '').trim().slice(0, 30) || null;
    const preferredAsset = (body.preferredAsset || '').trim().toUpperCase().slice(0, 20) || null;

    await c.env.DB.prepare(
      `INSERT INTO contacts (
         id, user_x_id, contact_handle, contact_x_id, nickname, preferred_amount, preferred_asset, is_pinned, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_x_id, contact_handle) DO UPDATE SET
         contact_x_id = excluded.contact_x_id,
         nickname = COALESCE(excluded.nickname, contacts.nickname),
         preferred_amount = COALESCE(excluded.preferred_amount, contacts.preferred_amount),
         preferred_asset = COALESCE(excluded.preferred_asset, contacts.preferred_asset),
         is_pinned = excluded.is_pinned,
         updated_at = excluded.updated_at`
    )
      .bind(
        contactId,
        session.x_id,
        cleanHandle,
        targetUser?.x_id || null,
        nickname,
        preferredAmount,
        preferredAsset,
        isPinned,
        now,
        now
      )
      .run();

    const saved = await c.env.DB.prepare(
      'SELECT * FROM contacts WHERE user_x_id = ? AND contact_handle = ?'
    )
      .bind(session.x_id, cleanHandle)
      .first<Contact>();

    return c.json({
      contact: {
        ...saved,
        is_registered: Boolean(targetUser?.x_id),
      },
    });
  } catch (err: any) {
    console.error('[/api/contacts] upsert error:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to save contact: ${publicErrorMessage(err)}`, code: 'SAVE_CONTACT_ERROR' },
      500
    );
  }
});

/**
 * DELETE /api/contacts/:handle
 * Removes a saved contact or unpins it
 */
contactsRouter.delete('/:handle', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    if (!c.env.DB) {
      return c.json<ErrorResponse>({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }

    const cleanHandle = normalizeHandle(c.req.param('handle') || '');
    if (!cleanHandle) {
      return c.json<ErrorResponse>({ error: 'Valid handle required', code: 'INVALID_HANDLE' }, 400);
    }

    await c.env.DB.prepare(
      'DELETE FROM contacts WHERE user_x_id = ? AND contact_handle = ?'
    )
      .bind(session.x_id, cleanHandle)
      .run();

    return c.json({ success: true, handle: cleanHandle });
  } catch (err: any) {
    console.error('[/api/contacts] delete error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to delete contact', code: 'DELETE_CONTACT_ERROR' },
      500
    );
  }
});
