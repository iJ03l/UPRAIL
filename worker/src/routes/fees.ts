/**
 * Creator-fee rail for UP (UPRAIL.app).
 *
 * NEAR-native launchpads (Nearly, JustHoot) pay creator fees to a NEAR account
 * the creator nominates. By nominating their UPRAIL vault address, a creator
 * routes those fees onto the same confidential rail as everything else: if the
 * handle behind the address is registered the fees are theirs immediately, and
 * funds that arrive for an unregistered handle are escrowed until claimed —
 * exactly the send/claim behavior already used everywhere else.
 *
 * This router surfaces the address to nominate and the fees that have arrived;
 * it adds no new custody and moves no funds.
 */

import { Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/session';
import * as nearRpc from '../services/nearRpc';

export const feesRouter = new Hono<AppContext>();

interface LaunchpadGuide {
  id: string;
  name: string;
  url: string;
  creatorLabel: string;
  steps: string[];
}

const LAUNCHPADS: LaunchpadGuide[] = [
  {
    id: 'nearly',
    name: 'Nearly',
    url: 'https://nearly.trade',
    creatorLabel: 'Creator fee recipient',
    steps: [
      'Open nearly.trade and start a launch.',
      'Paste your UPRAIL address below into the creator fee recipient field.',
      'Publish. Creator fees stream to this address automatically.',
    ],
  },
  {
    id: 'justhoot',
    name: 'JustHoot',
    url: 'https://justhoot.fun',
    creatorLabel: 'Creator',
    steps: [
      'Open justhoot.fun and create a launch.',
      'Set the creator to your UPRAIL address below.',
      'Publish. Creator rewards accrue to your UPRAIL balance.',
    ],
  },
];

/**
 * GET /api/fees
 * The address to nominate as a launchpad creator, plus setup guides.
 */
feesRouter.get('/', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const payoutAddress = await nearRpc.resolveUserNearAccount(c.env, session);
    return c.json({
      handle: session.x_handle,
      payoutAddress,
      registered: Boolean(session.near_account),
      launchpads: LAUNCHPADS,
    });
  } catch (err) {
    console.error('[fees] payout address resolution failed:', err);
    return c.json({ error: 'Could not resolve your payout address.', code: 'FEE_ADDRESS_ERROR' }, 500);
  }
});

/**
 * GET /api/fees/events
 * Inbound transfers to the creator address (creator fees as they arrive).
 */
feesRouter.get('/events', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const payoutAddress = await nearRpc.resolveUserNearAccount(c.env, session);
    const txs = await nearRpc.getIntentHistory(c.env, payoutAddress, 50);
    const events = (txs || [])
      .filter((t) => t.status === 'success' && (!t.receiver_id || t.receiver_id === payoutAddress))
      .filter((t) => t.intent_type === 'deposit' || t.intent_type === 'transfer' || Boolean(t.amount_in))
      .slice(0, 50);
    return c.json({ payoutAddress, events });
  } catch (err) {
    console.error('[fees] event lookup failed:', err);
    return c.json({ payoutAddress: session.near_account || null, events: [] });
  }
});
