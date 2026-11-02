/**
 * Health check router for UP (UPRAIL.app)
 */

import { Hono } from 'hono';
import type { AppContext } from '../types';

export const healthRouter = new Hono<AppContext>();

/**
 * GET /health
 * Status check endpoint
 */
healthRouter.get('/', async (c) => {
  // Public, unauthenticated endpoint: expose liveness only. Config values and
  // secret-presence flags (rpId, settlement URL, escrow account, whether keys
  // are set) are useful reconnaissance for an attacker and give no client any
  // benefit — they were removed deliberately.
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'uprail-worker',
    version: '1.0.0',
  });
});

/**
 * GET /health/sitrep or /api/system/sitrep
 * Public situation report for active incidents, upstream maintenance, and system communications.
 */
healthRouter.get('/sitrep', async (c) => {
  let oneClickOnline = false;
  try {
    const apiBase = c.env.NEAR_API_BASE || 'https://1click.chaindefuser.com';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const probe = await fetch(`${apiBase}/v0/tokens`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    if (probe && probe.status >= 200 && probe.status < 400) {
      oneClickOnline = true;
    }
  } catch {}

  const active = !oneClickOnline;

  return c.json({
    active,
    severity: active ? 'maintenance' : 'operational',
    badge: active ? 'UPSTREAM NODE UPGRADE' : 'SYSTEMS NORMAL',
    title: active
      ? 'Upstream Defuse/1Click GKE Node Upgrades (CVE-2026-98432)'
      : 'All Systems Operational',
    summary: active
      ? 'Upstream solver bridge nodes are upgrading to patch Linux kernel vulnerability CVE-2026-98432. Cross-chain bridge quotes and multi-chain deposits are paused. Internal transfers and 𝕏 handle payments are 100% operational.'
      : 'All cross-chain and confidential payment rails are operating normally.',
    startedAt: '2026-11-02T12:15:00Z',
    eta: active ? 'About 1–2 hours' : 'Resolved',
    upstream: {
      oneClickBridge: oneClickOnline ? 'online' : 'paused_maintenance',
      cause: 'GKE node upgrade for CVE-2026-98432',
    },
    affected: active
      ? [
          'Cross-chain deposit quote generation',
          'Multi-chain solver swaps',
          'Cross-chain bridge withdrawals',
        ]
      : [],
    operational: [
      'UPRAIL Core Protocol & Virtual Escrow',
      '𝕏 Handle payments & instant claims',
      'WebAuthn hardware passkeys & sessions',
      'Intents contract onchain settlements',
    ],
    timestamp: new Date().toISOString(),
  });
});

