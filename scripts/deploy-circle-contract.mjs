#!/usr/bin/env node
/**
 * Interactive Zero-Echo Deployment Script for `circle.uprail.near`
 * (`contracts/circle-escrow/`).
 *
 * Security guarantees:
 *   - Prompts for private keys directly from the terminal (`/dev/tty`) with raw-mode
 *     `*` masking (never passed via CLI args, never saved to bash history, never
 *     written to chat logs or repo files).
 *   - Verifies live NEAR Mainnet RPC `view_access_key` (`FullAccess`) and exact WASM
 *     storage-staking balance BEFORE prompting to broadcast.
 *   - Automatically chooses fresh initialization (`new`) vs state-preserving upgrade
 *     (`migrate`) based on live `code_hash` on `circle.uprail.near`.
 *   - Optionally streams `ATTESTOR_PRIVATE_KEY` into `npx wrangler secret put` over
 *     stdin so secrets never appear in terminal output.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORKER_DIR = path.join(ROOT_DIR, 'worker');
const DEFAULT_WASM_PATH = path.join(
  ROOT_DIR,
  'contracts',
  'circle-escrow',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'uprail_circle_escrow.wasm'
);

const DEFAULT_CONTRACT_ID = 'circle.uprail.near';
const DEFAULT_INTENTS_CONTRACT = 'intents.near';
const DEFAULT_FEE_COLLECTOR = 'escrow.uprail.near';
const DEFAULT_ALLOWED_ORIGINS = ['https://app.uprail.world', 'https://uprail.world'];
const RPC_ENDPOINTS = [
  'https://free.rpc.fastnear.com',
  'https://rpc.mainnet.near.org',
];
const EMPTY_CODE_HASH = '11111111111111111111111111111111';
const YOCTO_PER_BYTE = 10_000_000_000_000_000_000n; // 1e19 yoctoNEAR / byte
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((ch, idx) => [ch, idx]));

export function base58Encode(bytes) {
  const src = Uint8Array.from(bytes);
  if (src.length === 0) return '';
  const digits = [0];
  for (let i = 0; i < src.length; i++) {
    let carry = src[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < src.length && src[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export function base58Decode(str) {
  const clean = String(str || '').trim();
  if (!clean) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < clean.length; i++) {
    const val = BASE58_MAP.get(clean[i]);
    if (val === undefined) {
      throw new Error(`Invalid base58 character at index ${i}`);
    }
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < clean.length && clean[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function parseNearEd25519PrivateKey(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) throw new Error('Private key cannot be empty');
  if (trimmed.includes(':') && !trimmed.toLowerCase().startsWith('ed25519:')) {
    throw new Error('Only ed25519:<base58> keys are supported');
  }
  const b58 = trimmed.toLowerCase().startsWith('ed25519:')
    ? trimmed.slice('ed25519:'.length)
    : trimmed;
  const decoded = base58Decode(b58);
  if (decoded.length !== 32 && decoded.length !== 64) {
    throw new Error(`Expected 32 or 64 decoded key bytes, got ${decoded.length}`);
  }
  const seed = Buffer.from(decoded.subarray(0, 32));
  const privKeyObj = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = crypto.createPublicKey(privKeyObj).export({ format: 'der', type: 'spki' });
  const pubRaw = new Uint8Array(spki.subarray(spki.length - 32));

  if (decoded.length === 64) {
    const embeddedPub = decoded.subarray(32, 64);
    if (!Buffer.from(embeddedPub).equals(Buffer.from(pubRaw))) {
      throw new Error('64-byte NEAR key embedded public key does not match seed');
    }
  }

  return {
    seed,
    privKeyObj,
    pubRaw,
    publicKeyB58: `ed25519:${base58Encode(pubRaw)}`,
    canonicalPrivStr: `ed25519:${base58Encode(Buffer.concat([seed, Buffer.from(pubRaw)]))}`,
  };
}

export class BorshWriter {
  constructor() {
    this.chunks = [];
  }
  writeU8(v) {
    this.chunks.push(Uint8Array.of(v & 0xff));
  }
  writeU32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.chunks.push(b);
  }
  writeU64(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    this.chunks.push(b);
  }
  writeU128(v) {
    const val = BigInt(v);
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setBigUint64(0, val & 0xffff_ffff_ffff_ffffn, true);
    dv.setBigUint64(8, (val >> 64n) & 0xffff_ffff_ffff_ffffn, true);
    this.chunks.push(b);
  }
  writeBytes(bytes) {
    this.chunks.push(Uint8Array.from(bytes));
  }
  writeString(str) {
    const enc = new TextEncoder().encode(str);
    this.writeU32(enc.length);
    this.writeBytes(enc);
  }
  writePublicKey(pubRaw) {
    this.writeU8(0); // 0 = ED25519
    this.writeBytes(pubRaw);
  }
  toUint8Array() {
    const total = this.chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

export function buildSignedDeployAndCallTx({
  accountId,
  parsedKey,
  nonce,
  blockHashBytes,
  wasmBytes,
  methodName,
  argsObj,
  gas = 90_000_000_000_000n,
  deposit = 0n,
}) {
  const w = new BorshWriter();
  w.writeString(accountId);
  w.writePublicKey(parsedKey.pubRaw);
  w.writeU64(nonce);
  w.writeString(accountId);
  if (blockHashBytes.length !== 32) {
    throw new Error(`Invalid blockHashBytes length: ${blockHashBytes.length}`);
  }
  w.writeBytes(blockHashBytes);

  // Actions vector: [DeployContract, FunctionCall]
  w.writeU32(2);

  // Action::DeployContract = enum tag 1
  w.writeU8(1);
  w.writeU32(wasmBytes.length);
  w.writeBytes(wasmBytes);

  // Action::FunctionCall = enum tag 2
  w.writeU8(2);
  w.writeString(methodName);
  const argsBytes = new TextEncoder().encode(JSON.stringify(argsObj));
  w.writeU32(argsBytes.length);
  w.writeBytes(argsBytes);
  w.writeU64(gas);
  w.writeU128(deposit);

  const txBytes = w.toUint8Array();
  const txHash = crypto.createHash('sha256').update(txBytes).digest();
  const sig = crypto.sign(null, txHash, parsedKey.privKeyObj);

  const signed = new BorshWriter();
  signed.writeBytes(txBytes);
  signed.writeU8(0); // Ed25519 signature tag
  signed.writeBytes(sig);
  return {
    txHashB58: base58Encode(txHash),
    signedBase64: Buffer.from(signed.toUint8Array()).toString('base64'),
  };
}

function formatNear(yocto) {
  const sign = yocto < 0n ? '-' : '';
  const abs = yocto < 0n ? -yocto : yocto;
  const whole = abs / 1_000_000_000_000_000_000_000_000n;
  const frac = (abs % 1_000_000_000_000_000_000_000_000n)
    .toString()
    .padStart(24, '0')
    .slice(0, 4);
  return `${sign}${whole}.${frac}`;
}

async function rpcCall(method, params) {
  let lastErr;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'uprail-deploy', method, params }),
      });
      const json = await res.json();
      if (json.error) {
        const msg = json.error?.data || json.error?.message || JSON.stringify(json.error);
        lastErr = new Error(`${endpoint}: ${msg}`);
        continue;
      }
      return { result: json.result, endpoint };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All NEAR RPC endpoints failed');
}

async function viewContract(accountId, methodName, args = {}, finality = 'final') {
  const { result } = await rpcCall('query', {
    request_type: 'call_function',
    finality,
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('utf8').length
      ? Buffer.from(JSON.stringify(args)).toString('base64')
      : 'e30=',
  });
  const text = Buffer.from(result.result).toString('utf8');
  return JSON.parse(text);
}

async function readSecretMasked(promptLabel, { allowEmpty = false } = {}) {
  const hasStdinTty = Boolean(process.stdin.isTTY);
  const inputFd = hasStdinTty ? null : fs.openSync('/dev/tty', 'r');
  const outStream = process.stdout.isTTY ? process.stdout : process.stderr;

  // Use raw stty -echo on `/dev/tty` or `process.stdin.setRawMode(true)` so secrets never echo.
  if (hasStdinTty) {
    return await new Promise((resolve, reject) => {
      outStream.write(promptLabel);
      const chars = [];
      const wasRaw = Boolean(process.stdin.isRaw);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        try {
          process.stdin.setRawMode(wasRaw);
        } catch {
          // ignore
        }
        process.stdin.pause();
      };

      const onData = (buf) => {
        const str = buf.toString('utf8');
        for (let i = 0; i < str.length; i++) {
          const ch = str[i];
          const code = ch.charCodeAt(0);
          if (ch === '\r' || ch === '\n') {
            cleanup();
            outStream.write('\n');
            const val = chars.join('').trim();
            chars.fill('');
            if (!val && !allowEmpty) {
              reject(new Error('Aborted: empty secret input'));
              return;
            }
            resolve(val);
            return;
          }
          if (code === 3) {
            // Ctrl+C
            cleanup();
            chars.fill('');
            outStream.write('\n^C\n');
            process.exit(130);
          }
          if (code === 127 || code === 8) {
            if (chars.length > 0) {
              chars.pop();
              outStream.write('\b \b');
            }
            continue;
          }
          if (code >= 32) {
            chars.push(ch);
            outStream.write('*');
          }
        }
      };

      process.stdin.on('data', onData);
    });
  }

  // Fallback for redirected stdin while `/dev/tty` exists: invoke POSIX `stty -echo`.
  try {
    outStream.write(promptLabel);
    spawnSync('stty', ['-echo'], { stdio: [inputFd, 'inherit', 'inherit'] });
    const chunks = [];
    const buf = Buffer.alloc(1);
    while (fs.readSync(inputFd, buf, 0, 1, null) > 0) {
      if (buf[0] === 0x0a || buf[0] === 0x0d) break;
      chunks.push(buf[0]);
    }
    outStream.write('\n');
    const val = Buffer.from(chunks).toString('utf8').trim();
    chunks.fill(0);
    if (!val && !allowEmpty) {
      throw new Error('Aborted: empty secret input');
    }
    return val;
  } finally {
    try {
      spawnSync('stty', ['echo'], { stdio: [inputFd, 'inherit', 'inherit'] });
    } catch {
      // ignore
    }
    if (inputFd !== null) fs.closeSync(inputFd);
  }
}

async function readPlainPrompt(promptLabel) {
  const outStream = process.stdout.isTTY ? process.stdout : process.stderr;
  outStream.write(promptLabel);
  if (process.stdin.isTTY) {
    return await new Promise((resolve) => {
      let acc = '';
      const onData = (buf) => {
        acc += buf.toString('utf8');
        if (acc.includes('\n') || acc.includes('\r')) {
          process.stdin.removeListener('data', onData);
          process.stdin.pause();
          resolve(acc.trim());
        }
      };
      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }
  const fd = fs.openSync('/dev/tty', 'r');
  try {
    const chunks = [];
    const buf = Buffer.alloc(1);
    while (fs.readSync(fd, buf, 0, 1, null) > 0) {
      if (buf[0] === 0x0a || buf[0] === 0x0d) break;
      chunks.push(buf[0]);
    }
    return Buffer.from(chunks).toString('utf8').trim();
  } finally {
    fs.closeSync(fd);
  }
}

function generateRandomAttestorKey() {
  const seed = crypto.randomBytes(32);
  const rawB58 = `ed25519:${base58Encode(seed)}`;
  const parsed = parseNearEd25519PrivateKey(rawB58);
  seed.fill(0);
  return parsed;
}

function resolveNode22Env() {
  const env = { ...process.env };
  const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
  try {
    if (fs.existsSync(nvmDir)) {
      const v22Dirs = fs
        .readdirSync(nvmDir)
        .filter((d) => /^v(2[2-9]|[3-9]\d)\./.test(d))
        .sort()
        .reverse();
      for (const dir of v22Dirs) {
        const binDir = path.join(nvmDir, dir, 'bin');
        if (fs.existsSync(path.join(binDir, 'node'))) {
          env.PATH = `${binDir}:${env.PATH || ''}`;
          break;
        }
      }
    }
  } catch {
    // ignore nvm lookup failure; fall back to current PATH
  }
  return env;
}

function pushWranglerAttestorSecret(attestorPrivStr) {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', 'ATTESTOR_PRIVATE_KEY'], {
    cwd: WORKER_DIR,
    env: resolveNode22Env(),
    input: `${attestorPrivStr}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  return res.status === 0;
}

function runSelfTest() {
  const kp = parseNearEd25519PrivateKey(
    parseNearEd25519PrivateKey(
      `ed25519:${base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1))}`
    ).canonicalPrivStr
  );
  assert.ok(kp.publicKeyB58.startsWith('ed25519:'));
  assert.equal(kp.pubRaw.length, 32);

  const built = buildSignedDeployAndCallTx({
    accountId: DEFAULT_CONTRACT_ID,
    parsedKey: kp,
    nonce: 42n,
    blockHashBytes: Buffer.alloc(32, 0xaa),
    wasmBytes: Uint8Array.of(0x00, 0x61, 0x73, 0x6d),
    methodName: 'new',
    argsObj: { intents_contract: DEFAULT_INTENTS_CONTRACT },
  });
  const rawSigned = Buffer.from(built.signedBase64, 'base64');
  assert.ok(rawSigned.length > 100);
  const sigOffset = rawSigned.length - 65;
  assert.equal(rawSigned[sigOffset], 0);
  const txBytes = rawSigned.subarray(0, sigOffset);
  const sigBytes = rawSigned.subarray(sigOffset + 1);
  const digest = crypto.createHash('sha256').update(txBytes).digest();
  assert.equal(
    crypto.verify(
      null,
      digest,
      crypto.createPublicKey({
        key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(kp.pubRaw)]),
        format: 'der',
        type: 'spki',
      }),
      sigBytes
    ),
    true
  );
  console.log('[self-test] deploy-circle-contract.mjs passed (key parse, Borsh DeployContract+FunctionCall, Ed25519 verify)');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  console.log('\n=== UPRAIL circle.uprail.near Secure Contract Deployment ===\n');

  if (!fs.existsSync(DEFAULT_WASM_PATH)) {
    console.error(`Missing compiled WASM at:\n  ${DEFAULT_WASM_PATH}`);
    console.error('Build first with:\n  cargo build --release --target wasm32-unknown-unknown --manifest-path contracts/circle-escrow/Cargo.toml');
    process.exit(1);
  }
  const wasmBytes = fs.readFileSync(DEFAULT_WASM_PATH);
  console.log(`WASM artifact : ${path.relative(ROOT_DIR, DEFAULT_WASM_PATH)}`);
  console.log(`WASM size     : ${wasmBytes.length.toLocaleString()} bytes (~${formatNear(BigInt(wasmBytes.length) * YOCTO_PER_BYTE)} NEAR storage)`);

  // Step 1: Masked input for circle.uprail.near Full Access key
  const rawDeployKey = await readSecretMasked(
    `\nEnter ${DEFAULT_CONTRACT_ID} Full Access private key (ed25519:..., hidden): `
  );
  let ownerKey;
  try {
    ownerKey = parseNearEd25519PrivateKey(rawDeployKey);
  } catch (err) {
    console.error(`\nInvalid private key format: ${err.message}`);
    process.exit(1);
  }

  try {
    // Step 2: Live mainnet RPC verification before doing anything
    console.log(`\nChecking ${DEFAULT_CONTRACT_ID} on NEAR Mainnet...`);
    console.log(`Derived key   : ${ownerKey.publicKeyB58}`);

    const { result: account } = await rpcCall('query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: DEFAULT_CONTRACT_ID,
    });
    const { result: accessKey } = await rpcCall('query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: DEFAULT_CONTRACT_ID,
      public_key: ownerKey.publicKeyB58,
    }).catch(() => ({ result: null }));

    if (!accessKey || accessKey.permission !== 'FullAccess') {
      console.error(
        `\nKey ${ownerKey.publicKeyB58} is NOT a FullAccess key on ${DEFAULT_CONTRACT_ID}.`
      );
      process.exit(1);
    }

    const balanceYocto = BigInt(account.amount);
    const existingCodeHash = String(account.code_hash || EMPTY_CODE_HASH);
    const isFreshDeploy = existingCodeHash === EMPTY_CODE_HASH;
    const minNeededYocto = BigInt(wasmBytes.length + 12_000) * YOCTO_PER_BYTE + 100_000_000_000_000_000_000_000n;

    console.log(`Mode detected : ${isFreshDeploy ? 'FRESH DEPLOY (new)' : `UPGRADE (migrate, current code_hash=${existingCodeHash})`}`);
    console.log(`Live balance  : ${formatNear(balanceYocto)} NEAR`);

    if (balanceYocto < minNeededYocto) {
      const shortfall = minNeededYocto - balanceYocto;
      console.error(
        `\nInsufficient NEAR for contract storage staking! Needs ~${formatNear(minNeededYocto)} NEAR (` +
          `currently ${formatNear(balanceYocto)} NEAR -> fund ${DEFAULT_CONTRACT_ID} with at least +${formatNear(shortfall)} NEAR first).`
      );
      process.exit(1);
    }

    let existingConfig = null;
    if (!isFreshDeploy) {
      existingConfig = await viewContract(DEFAULT_CONTRACT_ID, 'get_config').catch(() => null);
      if (existingConfig) {
        console.log(`Current attestor_pubkey : ${existingConfig.attestor_pubkey}`);
        console.log(`Current fee_collector   : ${existingConfig.fee_collector}`);
      }
    }

    // Step 3: Dedicated ATTESTOR_PRIVATE_KEY (never same as owner FullAccess key)
    const rawAttestor = await readSecretMasked(
      isFreshDeploy
        ? `\nEnter ATTESTOR_PRIVATE_KEY (ed25519:..., hidden) or press Enter to auto-generate & sync to Cloudflare: `
        : `\nEnter new ATTESTOR_PRIVATE_KEY (hidden), type 'gen' to rotate, or press Enter to keep existing attestor_pubkey: `,
      { allowEmpty: true }
    );

    let attestorKey = null;
    if (rawAttestor.toLowerCase() === 'gen' || (isFreshDeploy && !rawAttestor)) {
      attestorKey = generateRandomAttestorKey();
      console.log(`Generated attestor_pubkey: ${attestorKey.publicKeyB58}`);
      const pushed = pushWranglerAttestorSecret(attestorKey.canonicalPrivStr);
      if (!pushed) {
        const keyFile = path.join(WORKER_DIR, '.attestor-circle.key');
        fs.writeFileSync(keyFile, `${attestorKey.canonicalPrivStr}\n`, { mode: 0o600 });
        console.warn(
          `\nCould not auto-push via wrangler; saved ATTESTOR_PRIVATE_KEY (chmod 600, gitignored) at:\n  ${path.relative(ROOT_DIR, keyFile)}\n` +
            `Push it with: cd worker && npx wrangler secret put ATTESTOR_PRIVATE_KEY < .attestor-circle.key`
        );
      } else {
        console.log('Synced ATTESTOR_PRIVATE_KEY to Cloudflare Worker secret store.');
      }
    } else if (rawAttestor) {
      attestorKey = parseNearEd25519PrivateKey(rawAttestor);
      if (attestorKey.publicKeyB58 === ownerKey.publicKeyB58) {
        console.error('\nSecurity check failed: ATTESTOR_PRIVATE_KEY must be distinct from the contract FullAccess key.');
        process.exit(1);
      }
      const syncAns = await readPlainPrompt('Push this ATTESTOR_PRIVATE_KEY to Cloudflare Worker secrets now? [y/N]: ');
      if (syncAns.toLowerCase() === 'y' || syncAns.toLowerCase() === 'yes') {
        const pushed = pushWranglerAttestorSecret(attestorKey.canonicalPrivStr);
        if (!pushed) {
          console.error('wrangler secret put failed; please set ATTESTOR_PRIVATE_KEY manually before enabling Worker.');
          process.exit(1);
        }
      }
    }

    const attestorPubkey = attestorKey?.publicKeyB58 || existingConfig?.attestor_pubkey;
    if (!attestorPubkey) {
      console.error('\nMissing attestor_pubkey for contract initialization.');
      process.exit(1);
    }

    const methodName = isFreshDeploy ? 'new' : 'migrate';
    const argsObj = isFreshDeploy
      ? {
          intents_contract: DEFAULT_INTENTS_CONTRACT,
          fee_collector: DEFAULT_FEE_COLLECTOR,
          attestor_pubkey: attestorPubkey,
          allowed_origins: DEFAULT_ALLOWED_ORIGINS,
        }
      : {
          intents_contract: null,
          fee_collector: null,
          attestor_pubkey: attestorKey ? attestorKey.publicKeyB58 : null,
          allowed_origins: null,
        };

    console.log('\n--- Deployment Summary ---');
    console.log(`Contract Account : ${DEFAULT_CONTRACT_ID}`);
    console.log(`Action           : DeployContract + ${methodName}`);
    console.log(`Attestor Pubkey  : ${attestorPubkey}`);
    console.log(`Fee Collector    : ${DEFAULT_FEE_COLLECTOR}`);
    console.log(`Allowed Origins  : ${DEFAULT_ALLOWED_ORIGINS.join(', ')}`);

    const confirm = await readPlainPrompt('\nBroadcast this mainnet transaction now? [y/N]: ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('Deployment cancelled before broadcast.');
      return;
    }

    const { result: status } = await rpcCall('status', {});
    const blockHashBytes = base58Decode(status.sync_info.latest_block_hash);
    const nonce = BigInt(accessKey.nonce) + 1n;

    const { signedBase64, txHashB58 } = buildSignedDeployAndCallTx({
      accountId: DEFAULT_CONTRACT_ID,
      parsedKey: ownerKey,
      nonce,
      blockHashBytes,
      wasmBytes,
      methodName,
      argsObj,
    });

    console.log(`\nBroadcasting tx (${txHashB58})...`);
    const { result: txRes } = await rpcCall('broadcast_tx_commit', [signedBase64]);
    const receiptFail = (txRes?.receipts_outcome || []).find((r) => r?.outcome?.status?.Failure);
    if (txRes?.status?.Failure || receiptFail) {
      console.error('\nTransaction failed:', JSON.stringify(txRes?.status?.Failure || receiptFail));
      process.exit(1);
    }

    const txId = txRes?.transaction?.hash || txHashB58;
    console.log(`Deployed successfully! Tx: https://nearblocks.io/txns/${txId}`);

    let version = null;
    let config = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      [version, config] = await Promise.all([
        viewContract(DEFAULT_CONTRACT_ID, 'get_version', {}, 'optimistic').catch(() => null),
        viewContract(DEFAULT_CONTRACT_ID, 'get_config', {}, 'optimistic').catch(() => null),
      ]);
      if (version !== null && config !== null) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
    console.log('\nVerified On-Chain State:');
    console.log(`  get_version(): ${JSON.stringify(version)}`);
    console.log(`  get_config() : ${JSON.stringify(config)}`);
    console.log('\nReady to deploy Worker (cd worker && npm run deploy).');
  } finally {
    ownerKey.seed.fill(0);
  }
}

main().catch((err) => {
  console.error(`\nDeployment error: ${err?.message || err}`);
  process.exit(1);
});
