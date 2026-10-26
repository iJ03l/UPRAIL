import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OneClickError,
  getAccountBalances,
  getExecutionStatus,
  requestQuote,
  submitSwapIntent,
} from '../src/services/oneclickClient';

const env = {
  NEAR_API_BASE: 'https://1click.example',
  ONE_CLICK_API_KEY: 'partner-key',
} as any;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const publicQuote = {
  quote: {
    depositAddress: 'deposit-address',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    amountIn: '1000',
    amountOut: '900',
  },
  quoteRequest: { confidentiality: 'public' },
};

describe('1Click quote validation', () => {
  it('accepts a nested public quote and sends no user auth', async () => {
    let headers: HeadersInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers;
      return jsonResponse(publicQuote, 201);
    }) as any;

    const result = await requestQuote(env, {
      originAsset: 'nep141:token.near',
      destinationAsset: 'nep141:token.near',
      amount: '1000',
      recipient: 'recipient.near',
      recipientType: 'INTENTS',
      refundTo: 'sender.near',
      refundType: 'INTENTS',
      depositType: 'INTENTS',
      confidentiality: 'public',
      deadline: new Date(Date.now() + 60_000).toISOString(),
    });

    assert.equal(result.quote.depositAddress, 'deposit-address');
    assert.equal((headers as Record<string, string>)['X-API-Key'], 'partner-key');
    assert.equal((headers as Record<string, string>).Authorization, undefined);
  });

  it('refuses a confidential quote without a User-Session token', async () => {
    await assert.rejects(
      requestQuote(env, {
        originAsset: 'nep141:token.near',
        destinationAsset: 'nep141:token.near',
        amount: '1000',
        recipient: 'recipient.near',
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: 'sender.near',
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        deadline: new Date(Date.now() + 60_000).toISOString(),
      }),
      (err: any) => err instanceof OneClickError && err.code === 'ONE_CLICK_USER_SESSION_MISSING'
    );
  });


  it('sends partner auth in X-API-Key and the user session in Authorization', async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({
        quote: publicQuote.quote,
        quoteRequest: {
          confidentiality: 'basic',
          depositType: 'CONFIDENTIAL_INTENTS',
        },
      }, 201);
    }) as any;

    await requestQuote(
      env,
      {
        originAsset: 'nep141:token.near',
        destinationAsset: 'nep141:token.near',
        amount: '1000',
        recipient: 'recipient.near',
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: 'sender.near',
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        deadline: new Date(Date.now() + 60_000).toISOString(),
      },
      { userSession: 'user-session' }
    );

    assert.equal(headers['X-API-Key'], 'partner-key');
    assert.equal(headers.Authorization, 'Bearer user-session');
  });

  it('fails closed when 1Click downgrades confidentiality', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        quote: publicQuote.quote,
        quoteRequest: { confidentiality: 'public', depositType: 'CONFIDENTIAL_INTENTS' },
      })) as any;

    await assert.rejects(
      requestQuote(
        env,
        {
          originAsset: 'nep141:token.near',
          destinationAsset: 'nep141:token.near',
          amount: '1000',
          recipient: 'recipient.near',
          recipientType: 'CONFIDENTIAL_INTENTS',
          refundTo: 'sender.near',
          refundType: 'CONFIDENTIAL_INTENTS',
          depositType: 'CONFIDENTIAL_INTENTS',
          confidentiality: 'basic',
          deadline: new Date(Date.now() + 60_000).toISOString(),
        },
        { userSession: 'user-session' }
      ),
      (err: any) => err instanceof OneClickError && err.code === 'ONE_CLICK_PRIVACY_DOWNGRADE'
    );
  });

  it('rejects a quote whose amount does not match the request', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        quote: { ...publicQuote.quote, amountIn: '999' },
        quoteRequest: { confidentiality: 'public' },
      })) as any;

    await assert.rejects(
      requestQuote(env, {
        originAsset: 'nep141:token.near',
        destinationAsset: 'nep141:token.near',
        amount: '1000',
        recipient: 'recipient.near',
        recipientType: 'INTENTS',
        refundTo: 'sender.near',
        refundType: 'INTENTS',
        depositType: 'INTENTS',
        confidentiality: 'public',
        deadline: new Date(Date.now() + 60_000).toISOString(),
      }),
      (err: any) => err instanceof OneClickError && err.code === 'ONE_CLICK_QUOTE_MISMATCH'
    );
  });
});

describe('1Click account balances', () => {
  it('parses tokenId/available base units and ignores malformed rows', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        balances: [
          { tokenId: 'nep141:usdc.near', available: '123456', source: 'private' },
          { tokenId: 'nep141:bad.near', available: 'not-a-number' },
        ],
      })) as any;

    const balances = await getAccountBalances(env, 'user-session', ['nep141:usdc.near']);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].tokenId, 'nep141:usdc.near');
    assert.equal(balances[0].available, '123456');
    assert.equal(balances[0].source, 'private');
  });
});

describe('1Click submit-intent', () => {
  it('returns the intent hash from the response', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ intentHash: 'intent-hash', correlationId: 'corr' })) as any;

    const result = await submitSwapIntent(env, {
      standard: 'nep413',
      payload: { message: '{}', nonce: 'nonce', recipient: 'intents.near' },
      public_key: 'ed25519:key',
      signature: 'ed25519:sig',
    });
    assert.equal(result.intentHash, 'intent-hash');
    assert.equal(result.correlationId, 'corr');
  });
});


describe('1Click execution status auth', () => {
  it('sends the User-Session token so confidential quotes resolve', async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({ status: 'SUCCESS' });
    }) as any;

    const status = await getExecutionStatus(env, 'deposit-address', undefined, 'user-session');
    assert.equal(status.status, 'SUCCESS');
    assert.equal(headers['X-API-Key'], 'partner-key');
    assert.equal(headers.Authorization, 'Bearer user-session');
  });

  it('keeps partner-only auth for public status checks', async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({ status: 'PENDING_DEPOSIT' });
    }) as any;

    await getExecutionStatus(env, 'deposit-address');
    assert.equal(headers['X-API-Key'], 'partner-key');
    assert.equal(headers.Authorization, undefined);
  });
});
