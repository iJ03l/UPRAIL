/**
 * Live, small-amount spike for Confidential Intents.
 *
 * Modes:
 *   --shield <amountAtomic>
 *   --private-transfer <recipientAccount> <amountAtomic>
 *   --private-withdraw <destinationAddress> <amountAtomic>
 *   --balances
 *
 * Env: NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, ONE_CLICK_API_KEY,
 *      [ONE_CLICK_ASSET_ID], [NEAR_RPC_URL].
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import {
  base64ToBytes,
  createTimestampedNonceBytes,
  encodeVersionedNonce,
  saltFromHex,
} from '../src/services/intentsNonce';
import { nep413Serialize } from '../src/services/nearRpc';
import { base58Decode, base58Encode } from '../src/utils/base58';

const accountId = process.env.NEAR_ACCOUNT_ID;
const privateKey = process.env.NEAR_PRIVATE_KEY;
const partnerKey = process.env.ONE_CLICK_API_KEY || process.env.ONE_CLICK_JWT;
const rpcUrl = process.env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
const apiBase = (process.env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
const intentsContract = process.env.INTENTS_CONTRACT_ID || 'intents.near';
const assetId =
  process.env.ONE_CLICK_ASSET_ID ||
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

if (!accountId || !privateKey || !partnerKey) {
  throw new Error('NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, and ONE_CLICK_API_KEY are required');
}

const rawKey = base58Decode(privateKey);
const secret = rawKey.slice(0, 32);
const publicKeyB58 = `ed25519:${base58Encode(ed25519.getPublicKey(secret))}`;

async function rpc(body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`NEAR RPC HTTP ${resp.status}`);
  const data = (await resp.json()) as any;
  if (data?.error) throw new Error(data.error?.message || 'NEAR RPC error');
  return data;
}

function decodeRpcBytes(value: unknown): string {
  if (Array.isArray(value)) return new TextDecoder().decode(Uint8Array.from(value as number[]));
  if (typeof value !== 'string') return '';
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

async function currentSalt(): Promise<string> {
  const data = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: intentsContract,
      method_name: 'current_salt',
      args_base64: btoa('{}'),
    },
  });
  const parsed = JSON.parse(decodeRpcBytes(data?.result?.result));
  const salt = typeof parsed === 'string' ? parsed : parsed?.salt;
  if (!/^[0-9a-fA-F]{8}$/.test(salt || '')) throw new Error(`Invalid salt: ${parsed}`);
  return salt;
}

async function signNep413(
  message: string,
  nonce: string,
  recipient = intentsContract
): Promise<Record<string, string>> {
  const serialized = nep413Serialize(message, base64ToBytes(nonce), recipient);
  const digest = await crypto.subtle.digest('SHA-256', serialized);
  const signature = ed25519.sign(new Uint8Array(digest), secret);
  return {
    standard: 'nep413',
    public_key: publicKeyB58,
    signature: `ed25519:${base58Encode(signature)}`,
  };
}

async function userSession(): Promise<string> {
  const deadline = new Date(Date.now() + 10 * 60_000);
  const nonce = encodeVersionedNonce(
    saltFromHex(await currentSalt()),
    deadline,
    createTimestampedNonceBytes()
  );
  const message = JSON.stringify({
    deadline: deadline.toISOString(),
    intents: [],
    signer_id: accountId,
  });
  const signed = await signNep413(message, nonce);
  const resp = await fetch(`${apiBase}/v0/auth/authenticate`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': partnerKey! },
    body: JSON.stringify({
      signedData: {
        ...signed,
        payload: { message, nonce, recipient: intentsContract },
      },
    }),
  });
  const body = (await resp.json().catch(() => ({}))) as any;
  if (!resp.ok || !body.accessToken) {
    throw new Error(`auth failed HTTP ${resp.status}: ${JSON.stringify(body)}`);
  }
  return body.accessToken;
}

async function publicBalance(): Promise<string> {
  const data = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: intentsContract,
      method_name: 'mt_balance_of',
      args_base64: btoa(JSON.stringify({ account_id: accountId, token_id: assetId })),
    },
  });
  return JSON.parse(decodeRpcBytes(data?.result?.result) || '"0"');
}

async function confidentialBalance(session: string): Promise<string> {
  // Fetch all balances; the tokenIds filter currently reports zero for held
  // assets even though the unfiltered response includes them.
  const resp = await fetch(`${apiBase}/v0/account/balances`, {
    headers: { Accept: 'application/json', 'X-API-Key': partnerKey!, Authorization: `Bearer ${session}` },
  });
  const body = (await resp.json().catch(() => ({}))) as any;
  if (!resp.ok) throw new Error(`balances failed HTTP ${resp.status}: ${JSON.stringify(body)}`);
  const row = Array.isArray(body?.balances)
    ? body.balances.find((b: any) => String(b.tokenId).toLowerCase() === assetId.toLowerCase())
    : null;
  return String(row?.available || '0');
}

async function quote(
  session: string,
  opts: {
    depositType: 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    recipientType: 'CONFIDENTIAL_INTENTS' | 'DESTINATION_CHAIN';
    refundType: 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    recipient: string;
    amount: string;
    confidentiality?: 'basic';
  }
): Promise<any> {
  const resp = await fetch(`${apiBase}/v0/quote`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': partnerKey!,
      Authorization: `Bearer ${session}`,
    },
    body: JSON.stringify({
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: assetId,
      destinationAsset: assetId,
      amount: opts.amount,
      recipient: opts.recipient,
      recipientType: opts.recipientType,
      refundTo: accountId,
      refundType: opts.refundType,
      depositType: opts.depositType,
      ...(opts.confidentiality ? { confidentiality: opts.confidentiality } : {}),
      slippageTolerance: 100,
      deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
  });
  const body = (await resp.json().catch(() => ({}))) as any;
  if (!resp.ok) throw new Error(`quote failed HTTP ${resp.status}: ${JSON.stringify(body)}`);
  if (!body?.quote?.depositAddress) throw new Error(`quote has no depositAddress: ${JSON.stringify(body)}`);
  return body;
}

async function generateAndSubmit(depositAddress: string): Promise<string> {
  const genResp = await fetch(`${apiBase}/v0/generate-intent`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': partnerKey! },
    body: JSON.stringify({
      type: 'swap_transfer',
      standard: 'nep413',
      signerId: accountId,
      depositAddress,
    }),
  });
  const generated = (await genResp.json().catch(() => ({}))) as any;
  if (!genResp.ok || !generated?.intent?.payload) {
    throw new Error(`generate-intent failed HTTP ${genResp.status}: ${JSON.stringify(generated)}`);
  }
  const payload = generated.intent.payload;
  const message = JSON.parse(payload.message);
  if (message.signer_id !== accountId) throw new Error(`intent signer mismatch: ${message.signer_id}`);
  if (![intentsContract, 'intents.far'].includes(payload.recipient)) {
    throw new Error(`intent recipient mismatch: ${payload.recipient}`);
  }
  const signed = await signNep413(payload.message, payload.nonce, payload.recipient);

  const subResp = await fetch(`${apiBase}/v0/submit-intent`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': partnerKey! },
    body: JSON.stringify({
      type: 'swap_transfer',
      signedData: {
        ...signed,
        payload: { message: payload.message, nonce: payload.nonce, recipient: payload.recipient },
      },
    }),
  });
  const submitted = (await subResp.json().catch(() => ({}))) as any;
  if (!subResp.ok || !submitted?.intentHash) {
    throw new Error(`submit-intent failed HTTP ${subResp.status}: ${JSON.stringify(submitted)}`);
  }
  return submitted.intentHash;
}

async function waitFor(depositAddress: string, session: string): Promise<string> {
  const started = Date.now();
  let last = 'UNKNOWN';
  while (Date.now() - started < 120_000) {
    const resp = await fetch(`${apiBase}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': partnerKey!,
        Authorization: `Bearer ${session}`,
      },
    });
    const body = (await resp.json().catch(() => ({}))) as any;
    const row = Array.isArray(body) ? body[0] : body;
    last = String(row?.status || row?.swapStatus || 'UNKNOWN').toUpperCase();
    if (['SUCCESS', 'FAILED', 'REFUNDED'].includes(last)) return last;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return last;
}

async function main() {
  const session = await userSession();
  const beforePublic = await publicBalance();
  const beforePrivate = await confidentialBalance(session);
  const out: Record<string, unknown> = {
    accountId,
    assetId,
    before: { public: beforePublic, confidential: beforePrivate },
  };

  const shieldIdx = process.argv.indexOf('--shield');
  if (shieldIdx >= 0) {
    const amount = process.argv[shieldIdx + 1];
    if (!amount) throw new Error('--shield requires <amountAtomic>');
    const q = await quote(session, {
      depositType: 'INTENTS',
      recipientType: 'CONFIDENTIAL_INTENTS',
      refundType: 'INTENTS',
      recipient: accountId,
      amount,
    });
    const intentHash = await generateAndSubmit(q.quote.depositAddress);
    out.shield = { amount, depositAddress: q.quote.depositAddress, intentHash, status: await waitFor(q.quote.depositAddress, session) };
  }

  const transferIdx = process.argv.indexOf('--private-transfer');
  if (transferIdx >= 0) {
    const recipient = process.argv[transferIdx + 1];
    const amount = process.argv[transferIdx + 2];
    if (!recipient || !amount) throw new Error('--private-transfer requires <recipient> <amountAtomic>');
    const q = await quote(session, {
      depositType: 'CONFIDENTIAL_INTENTS',
      recipientType: 'CONFIDENTIAL_INTENTS',
      refundType: 'CONFIDENTIAL_INTENTS',
      recipient,
      amount,
      confidentiality: 'basic',
    });
    if (process.argv.includes('--quote-only')) {
      out.privateTransferQuote = q;
    } else {
      const intentHash = await generateAndSubmit(q.quote.depositAddress);
      out.privateTransfer = {
        recipient,
        amount,
        depositAddress: q.quote.depositAddress,
        intentHash,
        status: await waitFor(q.quote.depositAddress, session),
      };
    }
  }

  const withdrawIdx = process.argv.indexOf('--private-withdraw');
  if (withdrawIdx >= 0) {
    const destination = process.argv[withdrawIdx + 1];
    const amount = process.argv[withdrawIdx + 2];
    if (!destination || !amount) throw new Error('--private-withdraw requires <destination> <amountAtomic>');
    const q = await quote(session, {
      depositType: 'CONFIDENTIAL_INTENTS',
      recipientType: 'DESTINATION_CHAIN',
      refundType: 'CONFIDENTIAL_INTENTS',
      recipient: destination,
      amount,
      confidentiality: 'basic',
    });
    const intentHash = await generateAndSubmit(q.quote.depositAddress);
    out.privateWithdraw = {
      destination,
      amount,
      depositAddress: q.quote.depositAddress,
      intentHash,
      status: await waitFor(q.quote.depositAddress, session),
    };
  }

  const afterSession = process.argv.some((a) => ['--shield', '--private-transfer', '--private-withdraw'].includes(a))
    ? await userSession()
    : session;
  out.after = {
    public: await publicBalance(),
    confidential: await confidentialBalance(afterSession),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
