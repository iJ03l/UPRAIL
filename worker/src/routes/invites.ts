/**
 * Invite API Routes for UPRAIL
 * Handles personal invite viewing, validation, and first-time user activation
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse, RedeemInviteRequest } from '../types';
import { requireAuth, updateSession } from '../middleware/session';
import {
  getUserInvite,
  validateInviteCode,
  redeemInvite,
  redeemSystemSkipInvite,
  isUserActivated,
} from '../services/inviteService';
import { publicErrorMessage } from '../utils/errors';

export const invitesRouter = new Hono<AppContext>();

/**
 * GET /api/invites/my-invite
 * Returns the authenticated user's reusable personal ref code,
 * referral usage history, and any payment-attached invites.
 */
invitesRouter.get('/my-invite', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const inviteData = await getUserInvite(c.env, session.x_id, session.x_handle);
    return c.json(inviteData);
  } catch (err: any) {
    console.error('Failed to get user invite:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to retrieve invite details'), code: 'INVITE_GET_ERROR' },
      500
    );
  }
});

/**
 * GET /api/invites/status
 * Returns whether the authenticated user has already completed invite activation.
 */
invitesRouter.get('/status', async (c) => {
  try {
    const session = c.get('session');
    if (!session) {
      return c.json({ authenticated: false, isActivated: false, personalInviteCode: null });
    }
    const activated = await isUserActivated(c.env, session.x_id);
    return c.json({
      authenticated: true,
      isActivated: activated,
      personalInviteCode: session.personal_invite_code || null,
    });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to check status'), code: 'STATUS_ERROR' },
      500
    );
  }
});

/**
 * POST /api/invites/validate
 * Public endpoint to check if an invite code is valid and available.
 */
invitesRouter.post('/validate', async (c) => {
  try {
    const body = (await c.req.json<{ code?: string }>().catch(() => ({}))) as { code?: string };
    if (!body?.code) {
      return c.json<ErrorResponse>(
        { error: 'Invite code is required', code: 'MISSING_CODE' },
        400
      );
    }

    const check = await validateInviteCode(c.env, body.code);
    if (!check.valid) {
      return c.json({
        valid: false,
        reason: check.reason,
      });
    }

    return c.json({
      valid: true,
      code: check.invite?.code,
      creator: check.invite?.creator_x_handle ? `@${check.invite.creator_x_handle}` : 'UPRAIL',
    });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Validation error'), code: 'VALIDATION_ERROR' },
      500
    );
  }
});

/**
 * POST /api/invites/redeem
 * Redeems an invite code for the authenticated user, activating their account
 * and issuing their reusable personal ref code.
 */
invitesRouter.post('/redeem', requireAuth({ passkeyVerified: true }), async (c) => {
  try {
    const session = c.get('session')!;
    const body = await c.req
      .json<RedeemInviteRequest & { skip?: boolean }>()
      .catch(() => ({ code: '', skip: false }));
    const result = body?.skip
      ? await redeemSystemSkipInvite(c.env, {
          x_id: session.x_id,
          x_handle: session.x_handle,
        })
      : await (() => {
          if (!body?.code) {
            throw new Error('Please enter a 6-letter invite code');
          }
          return redeemInvite(c.env, body.code, {
            x_id: session.x_id,
            x_handle: session.x_handle,
          });
        })();

    await updateSession(c, {
      is_activated: true,
      personal_invite_code: result.personalInviteCode,
    });

    return c.json(result);
  } catch (err: any) {
    console.error('Invite redemption error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to redeem invite code'), code: 'REDEEM_ERROR' },
      400
    );
  }
});
