import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';

describe('UPRAIL Cloudflare Worker (Miniflare)', () => {
  /** @type {Miniflare} */
  let mf;

  before(async () => {
    mf = new Miniflare({
      modules: true,
      scriptPath: 'dist/worker.js',
      compatibilityDate: '2026-10-08',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'uprail-db' },
      kvNamespaces: { CACHE: 'cache' },
      durableObjects: {
        ESCROW: 'EscrowDO',
        NEAR_CONTAINER: 'NearContainer',
      },
      bindings: {
        X_CLIENT_ID: 'test_client_id',
        NEAR_API_BASE: 'https://1click.chaindefuser.com',
        SOLVER_RELAY_URL: 'https://solver-relay-v2.chaindefuser.com/rpc',
        ESCROW_ACCOUNT_ID: 'escrow.uprail.near',
        PAYMENT_EXPIRY_DAYS: '30',
        WEBAUTHN_RP_ID: 'uprail.app',
        WEBAUTHN_RP_NAME: 'UPRAIL',
        WEBAUTHN_ORIGIN: 'https://uprail.app',
      },
    });
  });

  after(async () => {
    if (mf) await mf.dispose();
  });

  it('GET /health returns healthy response', async () => {
    const res = await mf.dispatchFetch('http://localhost/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'uprail-worker');
  });

  it('POST /api/resolve validates handle correctly', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: '@alice' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.handle, '@alice');
    assert.equal(body.resolved, false);
  });

  it('POST /api/resolve rejects invalid handles', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'invalid!handle' }),
    });
    assert.equal(res.status, 400);
  });

  it('GET /not-found returns 404', async () => {
    const res = await mf.dispatchFetch('http://localhost/unknown');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'NOT_FOUND');
  });
});
