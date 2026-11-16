/**
 * Scoped runtime authorization grants for NEAR L1 account operations (`u_*.escrow.uprail.near`).
 *
 * Security invariant:
 *   - For `custody_mode = 'self'`, `intents.near` is controlled exclusively by the
 *     user's on-chain P-256 passkey (`add_public_key` + `set_auth_by_predecessor_id(false)`).
 *   - NEAR L1 transactions (`wrap.near.near_deposit`, L1 `ft_transfer`, L1 `ft_transfer_call`)
 *     cannot be authorized by `intents.near` WebAuthn signatures and require the user's
 *     L1 sub-account Ed25519 key (`u_*`).
 *   - For `'self'` users, `nearRpc` MUST NEVER derive or use that L1 key unless the
 *     caller holds an active, unforgeable `NativeL1KeyGrant` minted exclusively after
 *     verifying a fresh, single-use WebAuthn passkey assertion bound to that exact L1 action.
 */

export type NativeL1Operation =
  | 'sweep_to_intents'
  | 'native_send'
  | 'native_escrow_lock'
  | 'native_withdraw'
  | 'native_rhea_stabilize';

export interface NativeL1GrantSpec {
  xId: string;
  operation: NativeL1Operation;
  asset: string;
  target: string;
  feeTarget?: string;
  maxAmount?: string;
  expiresAt: number;
}

const VALID_GRANTS = new WeakMap<NativeL1KeyGrant, NativeL1GrantSpec>();

export class NativeL1KeyGrant {
  readonly summary: string;

  constructor(summary: string) {
    this.summary = summary;
  }
}

/**
 * Mints a scoped, short-lived L1 key authorization handle.
 * Intended to be called ONLY after cryptographic WebAuthn passkey verification.
 */
export function issueNativeL1Grant(spec: Omit<NativeL1GrantSpec, 'expiresAt'> & { ttlMs?: number }): NativeL1KeyGrant {
  const grant = new NativeL1KeyGrant(`${spec.operation}:${spec.asset}:${spec.target}`);
  VALID_GRANTS.set(grant, {
    xId: spec.xId,
    operation: spec.operation,
    asset: spec.asset,
    target: spec.target,
    feeTarget: spec.feeTarget,
    maxAmount: spec.maxAmount,
    expiresAt: Date.now() + Math.min(spec.ttlMs ?? 120_000, 120_000),
  });
  return grant;
}

export function revokeNativeL1Grant(grant: NativeL1KeyGrant | undefined): void {
  if (grant) VALID_GRANTS.delete(grant);
}

/**
 * Verifies that `grant` was genuinely issued in-process, has not expired or been revoked,
 * belongs to `xId`, matches one of `allowedOperations`, and targets an authorized account.
 */
export function verifyNativeL1Grant(
  grant: NativeL1KeyGrant | undefined,
  expected: {
    xId: string;
    allowedOperations: NativeL1Operation[];
    target: string;
    asset?: string;
  }
): boolean {
  if (!grant) return false;
  const spec = VALID_GRANTS.get(grant);
  if (!spec) return false;
  if (Date.now() > spec.expiresAt) {
    VALID_GRANTS.delete(grant);
    return false;
  }
  if (spec.xId !== expected.xId) return false;
  if (!expected.allowedOperations.includes(spec.operation)) return false;

  const targetLower = expected.target.trim().toLowerCase();
  const allowedTargets = [spec.target, spec.feeTarget]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());
  if (!allowedTargets.includes(targetLower)) return false;

  if (spec.asset !== '*' && expected.asset) {
    if (spec.asset.trim().toLowerCase() !== expected.asset.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}
