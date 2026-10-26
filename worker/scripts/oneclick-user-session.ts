/**
 * Mints a 1Click User-Session for a NEAR account and optionally checks
 * confidential balances or requests a dry private quote.
 *
 * Usage:
 *   NEAR_ACCOUNT_ID=acct.near NEAR_PRIVATE_KEY=ed25519:... \
 *   ONE_CLICK_API_KEY=... npx tsx scripts/oneclick-user-session.ts [--balances]
 *
 * No tokens move: auth signs an empty intent, and --quote always uses dry=true.
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
const partnerJwt = process.env.ONE_CLICK_API_KEY || process.env.ONE_CLICK_JWT;
const rpcUrl = process.env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
const apiBase = (process.env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
const intentsContract = process.env.INTENTS_CONTRACT_ID || 'intents.near';

if (!accountId || !privateKey) {
  throw new Error('NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY are required');
}
if (!partnerJwt) {
  throw new Error('ONE_CLICK_API_KEY is required');
}

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
  const raw = decodeRpcBytes(data?.result?.result);
  const parsed = JSON.parse(raw);
  const salt = typeof parsed === 'string' ? parsed : parsed?.salt;
  if (!/^[0-9a-fA-F]{8}$/.test(salt || '')) throw new Error(`Invalid salt: ${raw}`);
  return salt;
}

async function main() {
  const rawKey = base58Decode(privateKey!);
  const secret = rawKey.slice(0, 32);
  const publicKey = ed25519.getPublicKey(secret);
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
  const serialized = nep413Serialize(message, base64ToBytes(nonce), intentsContract);
  const digest = await crypto.subtle.digest('SHA-256', serialized);
  const signature = ed25519.sign(new Uint8Array(digest), secret);

  const authResp = await fetch(`${apiBase}/v0/auth/authenticate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': partnerJwt,
    },
    body: JSON.stringify({
      signedData: {
        standard: 'nep413',
        payload: { message, nonce, recipient: intentsContract },
        public_key: `ed25519:${base58Encode(publicKey)}`,
        signature: `ed25519:${base58Encode(signature)}`,
      },
    }),
  });
  const authBody = (await authResp.json().catch(() => ({}))) as any;
  if (!authResp.ok || !authBody.accessToken) {
    throw new Error(`1Click auth failed HTTP ${authResp.status}: ${JSON.stringify(authBody)}`);
  }

  const out: Record<string, unknown> = {
    accountId,
    accessToken: process.argv.includes('--show-token') ? authBody.accessToken : '<redacted>',
    expiresIn: authBody.expiresIn,
  };

  if (process.argv.includes('--balances')) {
    const resp = await fetch(`${apiBase}/v0/account/balances`, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': partnerJwt,
        Authorization: `Bearer ${authBody.accessToken}`,
      },
    });
    out.balances = await resp.json().catch(() => null);
    out.balancesStatus = resp.status;
  }

  const statusIdx = process.argv.indexOf('--status');
  if (statusIdx >= 0) {
    const depositAddress = process.argv[statusIdx + 1];
    const resp = await fetch(
      `${apiBase}/v0/status?depositAddress=${encodeURIComponent(depositAddress || '')}`,
      {
        headers: {
          Accept: 'application/json',
          'X-API-Key': partnerJwt,
          Authorization: `Bearer ${authBody.accessToken}`,
        },
      }
    );
    out.status = await resp.json().catch(() => null);
    out.statusStatus = resp.status;
  }

  if (process.argv.includes('--history')) {
    const resp = await fetch(`${apiBase}/v0/account/history?limit=10`, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': partnerJwt,
        Authorization: `Bearer ${authBody.accessToken}`,
      },
    });
    out.history = await resp.json().catch(() => null);
    out.historyStatus = resp.status;
  }

  if (process.argv.includes('--filtered')) {
    const assetId = process.env.ONE_CLICK_ASSET_ID || '';
    const resp = await fetch(
      `${apiBase}/v0/account/balances?tokenIds=${encodeURIComponent(assetId)}`,
      {
        headers: {
          Accept: 'application/json',
          'X-API-Key': partnerJwt,
          Authorization: `Bearer ${authBody.accessToken}`,
        },
      }
    );
    out.filtered = await resp.json().catch(() => null);
    out.filteredStatus = resp.status;
  }

  const quoteIndex = process.argv.indexOf('--quote');
  if (quoteIndex >= 0) {
    const recipient = process.argv[quoteIndex + 1];
    const assetId = process.argv[quoteIndex + 2];
    const amount = process.argv[quoteIndex + 3];
    if (!recipient || !assetId || !amount) {
      throw new Error('--quote requires <recipient> <assetId> <amountAtomic>');
    }
    const quoteResp = await fetch(`${apiBase}/v0/quote`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': partnerJwt,
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({
        dry: true,
        swapType: 'EXACT_INPUT',
        originAsset: assetId,
        destinationAsset: assetId,
        amount,
        recipient,
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: accountId,
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        slippageTolerance: 100,
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
    out.quote = await quoteResp.json().catch(() => null);
    out.quoteStatus = quoteResp.status;
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
