import { Context, Hono } from 'hono';
import type { AppContext } from '../types';
import { claimLaunchpadFees, registerLaunchpadToken } from '../services/launchpadIntegrations';
import { escrowHoldingAccount } from '../services/launchpadFees';

export const launchpadsRouter = new Hono<AppContext>();

function jsonError(
  c: Context<AppContext>,
  status: 400 | 401 | 409 | 422 | 429 | 500 | 503,
  message: string,
  code: string
) {
  return c.json({ error: message, code }, status);
}

launchpadsRouter.get('/config', (c) => {
  const recipient = c.env.MASTER_ACCOUNT_ID || 'uprail.near';
  return c.json({
    network: 'mainnet',
    escrowAccount: escrowHoldingAccount(c.env),
    registration: {
      method: 'POST',
      path: '/api/launchpads/register',
      auth: 'NEP-413 signature from the token parent account',
      proofRecipient: recipient,
      proofTtlSeconds: 300,
      message: 'UPRAIL launchpad registration\\n<sha256(canonical-json(payload))>',
      payload: {
        token: '<NEP-141 subaccount of the launchpad>',
        handle: '<X handle>',
        launchpad: { id: '<slug>', name: '<display name>' },
        verification: {
          kind: 'token_config',
          method: 'get_config',
          paths: [['fee_to'], ['owner_id']],
        },
        claim: {
          kind: 'token_claim',
          owedMethod: 'get_owed_fees',
          accountArg: 'account_id',
          owedTokenPath: ['token'],
          owedQuotePath: ['quote'],
          claimMethod: 'claim_owed_fees',
          quoteContract: 'wrap.near',
        },
        issuedAt: 0,
      },
    },
    claim: {
      method: 'POST',
      path: '/api/launchpads/claim',
      auth: 'none',
      body: { token: '<registered NEP-141 contract>' },
    },
    verificationKinds: ['token_config', 'factory'],
    claimKinds: ['token_claim'],
  });
});

launchpadsRouter.post('/register', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(c, 400, 'Invalid JSON body.', 'INVALID_BODY');
  }
  const result = await registerLaunchpadToken(c.env, body);
  if (!result.ok) return jsonError(c, result.status, result.error, result.code);

  return c.json(
    {
      token: result.token,
      handle: result.handle,
      launchpad: result.launchpad,
      launchpadName: result.launchpadName,
      launchId: result.launchId,
      verifiedFeeTo: result.verifiedFeeTo,
      created: result.created,
    },
    result.created ? 201 : 200
  );
});

launchpadsRouter.post('/claim', async (c) => {
  let body: { token?: unknown };
  try {
    body = (await c.req.json()) as { token?: unknown };
  } catch {
    return jsonError(c, 400, 'Invalid JSON body.', 'INVALID_BODY');
  }
  if (typeof body.token !== 'string' || !body.token.trim()) {
    return jsonError(c, 400, 'A token contract is required.', 'INVALID_TOKEN');
  }

  const result = await claimLaunchpadFees(c.env, body.token);
  if (!result.ok) {
    return jsonError(c, 422, result.error || 'Could not claim fees.', 'CLAIM_FAILED');
  }
  return c.json({
    token: body.token.trim().toLowerCase(),
    claimed: result.claimed,
    pending: !!result.pending,
    txHash: result.txHash,
  });
});
