import type { Env } from '../types';
import * as nearRpc from './nearRpc';
import {
  buildLaunchpadRegistrationMessage,
  canonicalJson,
  launchpadRegistrationAllowed,
  parentAccountOf,
  proofIssuedAtValid,
  recordLaunchpadRegistration,
  verifyLaunchpadProof,
  type LaunchpadProof,
} from './launchpadAuth';
import {
  clearPendingLaunchpadClaim,
  findLaunchpadTokenBindingByPendingClaim,
  getLaunchpadTokenBinding,
  hasRoutedLaunchpadFees,
  listLaunchpadClaimBindings,
  setPendingLaunchpadClaim,
  touchLaunchpadTokenBinding,
  upsertLaunchpadTokenBinding,
  type LaunchpadTokenBinding,
} from './launchpadBindings';
import {
  contractFromToken,
  creditVerifiedFeeAtomic,
  escrowHoldingAccount,
  normalizeHandle,
  resolveLaunchpadToken,
  trackLaunchpadToken,
  type LaunchpadToken,
} from './launchpadFees';

type ConfigPath = Array<string | number>;

interface TokenConfigVerification {
  kind: 'token_config';
  method: string;
  args: Record<string, unknown>;
  paths: ConfigPath[];
}

interface FactoryVerification {
  kind: 'factory';
  contract: string;
  method: string;
  tokenArg: string;
  launchIdPath: ConfigPath;
  feeMethod: string;
  feeArg: string;
  feePath: ConfigPath;
}

export type LaunchpadVerificationConfig = TokenConfigVerification | FactoryVerification;

export interface LaunchpadClaimConfig {
  kind: 'token_claim';
  owedMethod: string;
  accountArg: string;
  owedTokenPath: ConfigPath;
  owedQuotePath: ConfigPath;
  claimMethod: string;
  claimArgs: Record<string, unknown>;
  quoteContract: string;
}

interface LaunchpadVerification {
  launchId: string | null;
  feeTo: string;
}

export type LaunchpadRegistrationCode =
  | 'INVALID_TOKEN'
  | 'INVALID_HANDLE'
  | 'INVALID_LAUNCHPAD'
  | 'INVALID_CONFIG'
  | 'PROOF_REQUIRED'
  | 'PROOF_EXPIRED'
  | 'INVALID_PROOF'
  | 'WRONG_SIGNER'
  | 'UNKNOWN_TOKEN'
  | 'LAUNCH_NOT_FOUND'
  | 'FEE_RECIPIENT_NOT_ESCROW'
  | 'FEE_RECIPIENT_UNVERIFIABLE'
  | 'TOKEN_BOUND'
  | 'HANDLE_LOCKED'
  | 'REGISTRATION_CAP_REACHED'
  | 'STORE_UNAVAILABLE';

export type LaunchpadRegistrationResult =
  | {
      ok: true;
      token: string;
      handle: string;
      launchpad: string;
      launchpadName: string;
      launchId: string | null;
      verifiedFeeTo: string;
      claimUrl: string;
      created: boolean;
    }
  | {
      ok: false;
      status: 400 | 401 | 409 | 422 | 429 | 503;
      code: LaunchpadRegistrationCode;
      error: string;
    };

const METHOD_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const LAUNCHPAD_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function normalizeAccountId(value: string | undefined | null): string {
  return (value || '').trim().toLowerCase();
}

function launchpadClaimUrl(env: Env): string {
  const origin = (env.WEBAUTHN_ORIGIN || 'https://app.uprail.world').replace(/\/+$/, '');
  return `${origin}/claim?view=fees`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validMethod(value: unknown): string | null {
  return typeof value === 'string' && METHOD_RE.test(value) ? value : null;
}

function validAccount(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const account = value.trim().toLowerCase();
  return account.length <= 64 && ACCOUNT_RE.test(account) ? account : null;
}

function parsePath(value: unknown): ConfigPath | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const path: ConfigPath = [];
  for (const segment of value) {
    if (typeof segment === 'string' && segment.length > 0 && segment.length <= 64) {
      path.push(segment);
    } else if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      path.push(segment);
    } else {
      return null;
    }
  }
  return path;
}

function parsePaths(value: unknown): ConfigPath[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return null;
  const paths: ConfigPath[] = [];
  for (const entry of value) {
    const path = parsePath(entry);
    if (!path) return null;
    paths.push(path);
  }
  return paths;
}

function readPath(value: unknown, path: ConfigPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

export function parseLaunchpadVerificationConfig(
  raw: unknown
): { ok: true; config: LaunchpadVerificationConfig } | { ok: false; error: string } {
  const obj = asObject(raw);
  if (!obj) return { ok: false, error: 'verification must be an object.' };
  if (obj.kind === 'token_config') {
    const method = validMethod(obj.method);
    if (!method) return { ok: false, error: 'verification.method is invalid.' };
    const paths = parsePaths(obj.paths);
    if (!paths) return { ok: false, error: 'verification.paths must be 1-8 paths.' };
    const args = obj.args === undefined ? {} : asObject(obj.args);
    if (!args) return { ok: false, error: 'verification.args must be an object.' };
    return { ok: true, config: { kind: 'token_config', method, args, paths } };
  }
  if (obj.kind === 'factory') {
    const contract = validAccount(obj.contract);
    const method = validMethod(obj.method);
    const feeMethod = validMethod(obj.feeMethod);
    const launchIdPath = parsePath(obj.launchIdPath);
    const feePath = parsePath(obj.feePath);
    if (!contract || !method || !feeMethod || !launchIdPath || !feePath) {
      return { ok: false, error: 'verification factory fields are invalid.' };
    }
    const tokenArg = typeof obj.tokenArg === 'string' && METHOD_RE.test(obj.tokenArg)
      ? obj.tokenArg
      : 'token';
    const feeArg = typeof obj.feeArg === 'string' && METHOD_RE.test(obj.feeArg)
      ? obj.feeArg
      : 'launch_id';
    return {
      ok: true,
      config: {
        kind: 'factory',
        contract,
        method,
        tokenArg,
        launchIdPath,
        feeMethod,
        feeArg,
        feePath,
      },
    };
  }
  return { ok: false, error: 'verification.kind must be token_config or factory.' };
}

export function parseLaunchpadClaimConfig(
  raw: unknown
): { ok: true; config: LaunchpadClaimConfig } | { ok: false; error: string } {
  const obj = asObject(raw);
  if (!obj || obj.kind !== 'token_claim') {
    return { ok: false, error: 'claim.kind must be token_claim.' };
  }
  const owedMethod = validMethod(obj.owedMethod);
  const claimMethod = validMethod(obj.claimMethod);
  const quoteContract = validAccount(obj.quoteContract);
  const owedTokenPath = parsePath(obj.owedTokenPath);
  const owedQuotePath = parsePath(obj.owedQuotePath);
  if (!owedMethod || !claimMethod || !quoteContract || !owedTokenPath || !owedQuotePath) {
    return { ok: false, error: 'claim fields are invalid.' };
  }
  const claimArgs = obj.claimArgs === undefined ? {} : asObject(obj.claimArgs);
  if (!claimArgs) return { ok: false, error: 'claim.claimArgs must be an object.' };
  const accountArg = typeof obj.accountArg === 'string' && METHOD_RE.test(obj.accountArg)
    ? obj.accountArg
    : 'account_id';
  return {
    ok: true,
    config: {
      kind: 'token_claim',
      owedMethod,
      accountArg,
      owedTokenPath,
      owedQuotePath,
      claimMethod,
      claimArgs,
      quoteContract,
    },
  };
}

async function verifyFeeConfig(
  env: Env,
  token: string,
  config: LaunchpadVerificationConfig
): Promise<LaunchpadVerification | null> {
  if (config.kind === 'token_config') {
    const result = await nearRpc.viewContractMethod(env, token, config.method, config.args);
    for (const path of config.paths) {
      const value = readPath(result, path);
      if (typeof value === 'string' && value.trim()) {
        return { launchId: null, feeTo: value.trim().toLowerCase() };
      }
    }
    return { launchId: null, feeTo: '' };
  }

  const record = await nearRpc.viewContractMethod(env, config.contract, config.method, {
    [config.tokenArg]: token,
  });
  const launchId = readPath(record, config.launchIdPath);
  if (launchId === null || launchId === undefined) return null;
  const fee = await nearRpc.viewContractMethod(env, config.contract, config.feeMethod, {
    [config.feeArg]: String(launchId),
  });
  const feeTo = readPath(fee, config.feePath);
  return {
    launchId: String(launchId),
    feeTo: typeof feeTo === 'string' ? feeTo.trim().toLowerCase() : '',
  };
}

function verifyFeeRecipient(feeTo: string | null, escrow: string): boolean {
  return !!feeTo && normalizeAccountId(feeTo) === normalizeAccountId(escrow);
}

export async function registerLaunchpadToken(
  env: Env,
  input: Record<string, unknown>
): Promise<LaunchpadRegistrationResult> {
  const token = contractFromToken(input.token);
  if (!token) {
    return { ok: false, status: 400, code: 'INVALID_TOKEN', error: 'A valid NEP-141 token contract is required.' };
  }
  const handle = normalizeHandle(input.handle);
  if (!handle) {
    return { ok: false, status: 400, code: 'INVALID_HANDLE', error: 'A valid X handle is required.' };
  }
  const launchpadObj = asObject(input.launchpad);
  const launchpadId = typeof launchpadObj?.id === 'string' ? launchpadObj.id.trim().toLowerCase() : '';
  if (!LAUNCHPAD_ID_RE.test(launchpadId)) {
    return { ok: false, status: 400, code: 'INVALID_LAUNCHPAD', error: 'launchpad.id is required.' };
  }
  const launchpadName =
    typeof launchpadObj?.name === 'string' && launchpadObj.name.trim()
      ? launchpadObj.name.trim().slice(0, 64)
      : launchpadId;

  const verificationParsed = parseLaunchpadVerificationConfig(input.verification);
  if (!verificationParsed.ok) {
    return { ok: false, status: 400, code: 'INVALID_CONFIG', error: verificationParsed.error };
  }
  const claimParsed =
    input.claim === undefined || input.claim === null
      ? { ok: true as const, config: null }
      : parseLaunchpadClaimConfig(input.claim);
  if (!claimParsed.ok) {
    return { ok: false, status: 400, code: 'INVALID_CONFIG', error: claimParsed.error };
  }

  const proof = asObject(input.proof);
  if (!proof) {
    return { ok: false, status: 401, code: 'PROOF_REQUIRED', error: 'A signed launchpad proof is required.' };
  }
  if (!proofIssuedAtValid(input.issuedAt)) {
    return { ok: false, status: 401, code: 'PROOF_EXPIRED', error: 'The proof is missing or expired.' };
  }
  const parent = parentAccountOf(token);
  const signerId = normalizeAccountId(proof.signerId as string);
  if (!parent) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_TOKEN',
      error: 'Token must be a subaccount of the launchpad account.',
    };
  }
  if (signerId !== parent) {
    return {
      ok: false,
      status: 401,
      code: 'WRONG_SIGNER',
      error: `Token ${token} must be signed by its parent account ${parent}.`,
    };
  }

  const message = await buildLaunchpadRegistrationMessage({
    token,
    handle,
    launchpad: input.launchpad,
    verification: input.verification,
    claim: input.claim ?? null,
    issuedAt: input.issuedAt as number,
  });
  const verified = await verifyLaunchpadProof(env, proof as unknown as LaunchpadProof, message);
  if (!verified.ok || verified.signerId !== signerId) {
    return {
      ok: false,
      status: 401,
      code: 'INVALID_PROOF',
      error: verified.error || 'Invalid launchpad proof.',
    };
  }

  if (!(await launchpadRegistrationAllowed(env, signerId))) {
    return {
      ok: false,
      status: 429,
      code: 'REGISTRATION_CAP_REACHED',
      error: 'Daily registration cap reached for this launchpad.',
    };
  }

  if (!env.DB) {
    return { ok: false, status: 503, code: 'STORE_UNAVAILABLE', error: 'Token bindings are unavailable.' };
  }

  const tokenInfo = await resolveLaunchpadToken(env, token);
  if (!tokenInfo) {
    return { ok: false, status: 422, code: 'UNKNOWN_TOKEN', error: 'Unknown or non-NEP-141 token contract.' };
  }

  let verification: LaunchpadVerification | null = null;
  try {
    verification = await verifyFeeConfig(env, token, verificationParsed.config);
  } catch {
    return {
      ok: false,
      status: 422,
      code: 'LAUNCH_NOT_FOUND',
      error: 'Could not verify this launch on-chain.',
    };
  }
  if (!verification) {
    return {
      ok: false,
      status: 422,
      code: 'LAUNCH_NOT_FOUND',
      error: 'No matching launch was found on-chain.',
    };
  }
  if (!verification.feeTo) {
    return {
      ok: false,
      status: 422,
      code: 'FEE_RECIPIENT_UNVERIFIABLE',
      error: 'The launch does not expose a verifiable creator-fee recipient.',
    };
  }
  const escrow = escrowHoldingAccount(env);
  if (!verifyFeeRecipient(verification.feeTo, escrow)) {
    return {
      ok: false,
      status: 409,
      code: 'FEE_RECIPIENT_NOT_ESCROW',
      error: `Creator fees are not routed to ${escrow}.`,
    };
  }

  const existing = await getLaunchpadTokenBinding(env, token);
  if (existing) {
    if (existing.launchpad !== launchpadId) {
      return {
        ok: false,
        status: 409,
        code: 'TOKEN_BOUND',
        error: 'This token is already bound to a different launchpad.',
      };
    }
    if (existing.handle !== handle && (await hasRoutedLaunchpadFees(env, token))) {
      return {
        ok: false,
        status: 409,
        code: 'HANDLE_LOCKED',
        error: 'This token has already routed fees and its handle cannot be changed.',
      };
    }
  }

  const binding = await upsertLaunchpadTokenBinding(env, {
    token,
    launchpad: launchpadId,
    launchpadName,
    handle,
    authority: signerId,
    verificationJson: JSON.stringify(verificationParsed.config),
    claimJson: claimParsed.config ? JSON.stringify(claimParsed.config) : null,
    launchId: verification.launchId,
    verifiedFeeTo: normalizeAccountId(verification.feeTo),
    createdAt: existing?.createdAt,
  });
  if (!binding) {
    return { ok: false, status: 503, code: 'STORE_UNAVAILABLE', error: 'Could not save this binding.' };
  }

  await trackLaunchpadToken(env, { contractId: token, handle, launchpad: launchpadId });
  await recordLaunchpadRegistration(env, signerId);

  return {
    ok: true,
    token,
    handle,
    launchpad: launchpadId,
    launchpadName,
    launchId: verification.launchId,
    verifiedFeeTo: binding.verifiedFeeTo,
    claimUrl: launchpadClaimUrl(env),
    created: !existing,
  };
}

function isPositiveAtomic(value: string | null | undefined): boolean {
  try {
    return BigInt(value || '0') > 0n;
  } catch {
    return false;
  }
}

function eventAmountTo(
  events: Array<{ contract: string; to: string | null; amountAtomic: string }>,
  contract: string,
  account: string
): bigint {
  const wantedContract = contract.toLowerCase();
  const wantedAccount = account.toLowerCase();
  let total = 0n;
  for (const event of events) {
    if (event.contract.toLowerCase() !== wantedContract) continue;
    if (normalizeAccountId(event.to) !== wantedAccount) continue;
    try {
      total += BigInt(event.amountAtomic);
    } catch {}
  }
  return total;
}

function claimIntentHash(bindingToken: string, assetContract: string, txHash: string): string {
  return assetContract.toLowerCase() === bindingToken.toLowerCase()
    ? `claim:${txHash}:${bindingToken}`
    : `claim:${txHash}:${bindingToken}:${assetContract}`;
}

async function recordClaimAmount(
  env: Env,
  binding: LaunchpadTokenBinding,
  token: LaunchpadToken,
  amountAtomic: string,
  txHash: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isPositiveAtomic(amountAtomic)) return { ok: true };
  const intentHash = claimIntentHash(binding.token, token.contractId, txHash);
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM payments WHERE intent_hash = ? LIMIT 1'
    )
      .bind(intentHash)
      .first<{ id: string }>();
    if (existing) return { ok: true };
  } catch {}
  const res = await creditVerifiedFeeAtomic(env, {
    launchpad: binding.launchpad,
    handle: binding.handle,
    token,
    grossAtomic: BigInt(amountAtomic),
    intentHash,
    memo: `${binding.launchpadName} creator fees`,
  });
  return { ok: res.ok, error: res.error };
}

function parseStoredClaim(binding: LaunchpadTokenBinding): LaunchpadClaimConfig | null {
  if (!binding.claimJson) return null;
  try {
    const parsed = parseLaunchpadClaimConfig(JSON.parse(binding.claimJson));
    return parsed.ok ? parsed.config : null;
  } catch {
    return null;
  }
}

export async function syncPendingLaunchpadClaim(
  env: Env,
  txHash: string
): Promise<{ ok: boolean; routed: boolean; pending?: boolean; error?: string }> {
  const binding = await findLaunchpadTokenBindingByPendingClaim(env, txHash);
  if (!binding) {
    return { ok: false, routed: false, error: 'No pending claim for that transaction.' };
  }
  const claim = parseStoredClaim(binding);
  if (!claim) {
    return { ok: false, routed: false, error: 'Bound token has no valid claim configuration.' };
  }
  const probe = await nearRpc.probeNearTransaction(env, txHash);
  if (!probe.found) {
    return { ok: true, routed: false, pending: true };
  }
  if (!probe.success) {
    await clearPendingLaunchpadClaim(env, binding.token, txHash);
    return { ok: false, routed: false, error: 'Claim transaction failed on-chain.' };
  }
  const escrow = normalizeAccountId(escrowHoldingAccount(env));
  if (
    normalizeAccountId(probe.signer) !== escrow ||
    normalizeAccountId(probe.executor) !== normalizeAccountId(binding.token)
  ) {
    await clearPendingLaunchpadClaim(env, binding.token, txHash);
    return { ok: false, routed: false, error: 'Claim transaction was not sent by escrow to the bound token.' };
  }

  const token = await resolveLaunchpadToken(env, binding.token);
  if (!token) {
    return { ok: false, routed: false, error: 'Unknown bound token contract.' };
  }
  const exactToken = eventAmountTo(probe.events, binding.token, escrow);
  const exactQuote = eventAmountTo(probe.events, claim.quoteContract, escrow);
  const expectedToken = binding.pendingClaimTokenAtomic || '0';
  const expectedQuote = binding.pendingClaimQuoteAtomic || '0';
  if (isPositiveAtomic(expectedToken) && exactToken <= 0n) {
    await clearPendingLaunchpadClaim(env, binding.token, txHash);
    return {
      ok: false,
      routed: false,
      error: 'Claim transaction did not transfer the token fees to escrow.',
    };
  }
  if (isPositiveAtomic(expectedQuote) && exactQuote <= 0n) {
    await clearPendingLaunchpadClaim(env, binding.token, txHash);
    return {
      ok: false,
      routed: false,
      error: 'Claim transaction did not transfer the quote fees to escrow.',
    };
  }

  const tokenRes = await recordClaimAmount(env, binding, token, exactToken.toString(), txHash);
  if (!tokenRes.ok) return { ok: false, routed: false, error: tokenRes.error };

  if (exactQuote > 0n) {
    const quote = await resolveLaunchpadToken(env, claim.quoteContract);
    if (!quote) {
      return { ok: false, routed: false, error: 'Unknown claim quote token contract.' };
    }
    const quoteRes = await recordClaimAmount(env, binding, quote, exactQuote.toString(), txHash);
    if (!quoteRes.ok) return { ok: false, routed: false, error: quoteRes.error };
  }

  await clearPendingLaunchpadClaim(env, binding.token, txHash);
  return { ok: true, routed: true };
}

export async function claimLaunchpadFees(
  env: Env,
  token: string
): Promise<{
  ok: boolean;
  claimed: boolean;
  pending?: boolean;
  txHash?: string;
  error?: string;
}> {
  const contractId = contractFromToken(token);
  if (!contractId) return { ok: false, claimed: false, error: 'Invalid token contract.' };
  const binding = await getLaunchpadTokenBinding(env, contractId);
  if (!binding) {
    return { ok: false, claimed: false, error: 'Token is not registered for launchpad fees.' };
  }
  const claim = parseStoredClaim(binding);
  if (!claim) {
    return { ok: false, claimed: false, error: 'Token has no claim configuration.' };
  }
  if (binding.pendingClaimTx) {
    const pending = await syncPendingLaunchpadClaim(env, binding.pendingClaimTx);
    if (pending.ok && pending.routed) {
      return { ok: true, claimed: true, txHash: binding.pendingClaimTx };
    }
    if (pending.pending) {
      return { ok: true, claimed: false, pending: true, txHash: binding.pendingClaimTx };
    }
    return { ok: false, claimed: false, error: pending.error };
  }

  const escrow = escrowHoldingAccount(env);
  let owed: { token: string; quote: string };
  try {
    const raw = await nearRpc.viewContractMethod(env, contractId, claim.owedMethod, {
      [claim.accountArg]: escrow,
    });
    const tokenValue = readPath(raw, claim.owedTokenPath);
    const quoteValue = readPath(raw, claim.owedQuotePath);
    owed = {
      token: tokenValue !== undefined && tokenValue !== null ? String(tokenValue) : '0',
      quote: quoteValue !== undefined && quoteValue !== null ? String(quoteValue) : '0',
    };
  } catch (err: any) {
    return { ok: false, claimed: false, error: err?.message || 'Could not read owed fees.' };
  }
  if (!isPositiveAtomic(owed.token) && !isPositiveAtomic(owed.quote)) {
    return { ok: true, claimed: false };
  }

  const storage = await nearRpc.ensureEscrowStorageRegistered(env, contractId);
  if (!storage.registered) {
    return { ok: false, claimed: false, error: storage.reason || 'Could not register escrow storage.' };
  }
  if (isPositiveAtomic(owed.quote)) {
    const quoteStorage = await nearRpc.ensureEscrowStorageRegistered(env, claim.quoteContract);
    if (!quoteStorage.registered) {
      return {
        ok: false,
        claimed: false,
        error: quoteStorage.reason || `Could not register escrow storage for ${claim.quoteContract}.`,
      };
    }
  }

  const submitted = await nearRpc.executeEscrowContractCall(
    env,
    contractId,
    claim.claimMethod,
    claim.claimArgs
  );
  if (!submitted.success || !submitted.txHash) {
    return { ok: false, claimed: false, error: submitted.error || 'Claim transaction failed.' };
  }

  const stored = await setPendingLaunchpadClaim(env, contractId, {
    txHash: submitted.txHash,
    tokenAtomic: owed.token,
    quoteAtomic: owed.quote,
  });
  if (!stored) {
    return {
      ok: false,
      claimed: true,
      txHash: submitted.txHash,
      error: 'Claimed but could not record attribution.',
    };
  }

  const routed = await syncPendingLaunchpadClaim(env, submitted.txHash);
  if (routed.pending) {
    return { ok: true, claimed: true, pending: true, txHash: submitted.txHash };
  }
  return {
    ok: routed.ok,
    claimed: true,
    txHash: submitted.txHash,
    error: routed.error,
  };
}

export async function syncAllLaunchpadClaims(
  env: Env,
  opts?: { maxTokens?: number }
): Promise<{ checked: number; claimed: number }> {
  const maxTokens = opts?.maxTokens ?? 10;
  const bindings = await listLaunchpadClaimBindings(env, maxTokens);
  let claimed = 0;
  for (const binding of bindings) {
    try {
      if (binding.pendingClaimTx) {
        const res = await syncPendingLaunchpadClaim(env, binding.pendingClaimTx);
        if (res.routed) claimed++;
      } else {
        const res = await claimLaunchpadFees(env, binding.token);
        if (res.claimed) claimed++;
      }
    } catch (err) {
      console.warn(`[launchpadIntegrations] claim sync failed for ${binding.token}:`, err);
    } finally {
      await touchLaunchpadTokenBinding(env, binding.token);
    }
  }
  return { checked: bindings.length, claimed };
}

export { canonicalJson };
