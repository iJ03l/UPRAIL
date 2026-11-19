/**
 * useClaimFlow — Automated pending payment discovery & passkey claim
 *
 * When someone sends funds to a user, the payment is addressed to their X handle.
 * When the user opens the Claim page:
 *   - All payments addressed to them are AUTOMATICALLY loaded from the backend
 *   - NO code or link input is required!
 *   - The user claims with 1 tap of their hardware Passkey (Touch ID, Face ID, PIN)
 *   - Multiple payments can be claimed simultaneously ("Claim All")
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { PaymentIntent, ClaimPaymentResult, ShieldedBalance } from '../types';
import { api } from '../lib/api';
import { webauthn, describePasskeyError } from '../lib/webauthn';
import { useXAuth } from './useXAuth';

const PENDING_CACHE_KEY = 'uprail_pending_payments_cache';

/**
 * Pending payments are PII (recipient handle, amount, memo). The cache is
 * scoped to the account that wrote it: without that, a session that expired
 * without an explicit logout left the previous account's payments visible to
 * whoever signed in next on the same browser.
 */
type PendingCache = { owner: string | null; items: PaymentIntent[] };

function getCachedPending(owner: string | null): PaymentIntent[] {
  if (typeof window === 'undefined') return [];
  if (!owner) return [];
  try {
    const raw = localStorage.getItem(PENDING_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCache;
    if (!parsed || parsed.owner !== owner) {
      localStorage.removeItem(PENDING_CACHE_KEY);
      return [];
    }
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

let inFlightPendingPromise: Promise<PaymentIntent[]> | null = null;

export function useClaimFlow(initialCode?: string) {
  const { user } = useXAuth();

  const ownerId = user?.id || null;
  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>(() => getCachedPending(ownerId));
  const [selectedPayment, setSelectedPayment] = useState<PaymentIntent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimStepMsg, setClaimStepMsg] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [shieldedBalances, setShieldedBalances] = useState<ShieldedBalance[]>([]);
  const claimingRef = useRef(false);

  // ── Load all pending payments for the logged-in user ──────────────────────
  const loadPendingPayments = useCallback(async () => {
    // If not authenticated, do not spam API
    if (!user) {
      setPendingPayments([]);
      return;
    }

    try {
      if (pendingPayments.length === 0) setIsLoading(true);
      setError(null);

      // Deduplicate in-flight pending fetch
      if (!inFlightPendingPromise) {
        inFlightPendingPromise = api.getPendingPayments().finally(() => {
          inFlightPendingPromise = null;
        });
      }

      const payments = await inFlightPendingPromise;
      setPendingPayments(payments);
      try {
        localStorage.setItem(
          PENDING_CACHE_KEY,
          JSON.stringify({ owner: user?.id || null, items: payments })
        );
      } catch {}

      // 2. If there's an initialCode (e.g. from deep-link /claim/:id), find or fetch it
      if (initialCode?.trim()) {
        const found = payments.find((p) => p.id === initialCode.trim() || p.claimCode === initialCode.trim());
        if (found) {
          setSelectedPayment(found);
        } else {
          const direct = await api.getPaymentByCode(initialCode.trim());
          if (direct) {
            setSelectedPayment(direct);
            const userHandle = user?.handle?.replace(/^@/, '').toLowerCase();
            const recipientHandle = direct.recipientHandle?.replace(/^@/, '').toLowerCase();
            const senderHandle = direct.senderHandle?.replace(/^@/, '').toLowerCase();
            const isSender = Boolean(userHandle && senderHandle && userHandle === senderHandle);
            const isRecipient = !isSender && (!userHandle || userHandle === recipientHandle);
            const isPending = !direct.isDirect && direct.status !== 'claimed' && direct.status !== 'cancelled' && direct.status !== 'refunded';

            if (isRecipient && isPending && !payments.some((p) => p.id === direct.id)) {
              setPendingPayments([direct, ...payments]);
            }
          }
        }
      } else if (payments.length > 0) {
        setSelectedPayment(payments[0]);
      }

      // Check passkey status
      if (user?.handle) {
        const registered = webauthn.hasLocalPasskey(user.handle);
        setHasPasskey(registered);
      }
    } catch (err: any) {
      console.error('Error loading pending payments:', err);
      // Don't show disruptive error if we have cached payments
      if (pendingPayments.length === 0) {
        setError('Could not load incoming payments.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [initialCode, user?.handle]);

  // Load balances
  const loadShieldedBalances = useCallback(async () => {
    if (!user) return;
    try {
      const b = await api.getShieldedBalances();
      setShieldedBalances(b || []);
    } catch {
      // Ignore
    }
  }, [user]);

  useEffect(() => {
    loadPendingPayments();
  }, [loadPendingPayments]);

  // ── Claim a single payment with Passkey ──────────────────────────────────
  const claimPaymentWithPasskey = async (paymentId: string) => {
    if (claimingRef.current) return;
    const payment = pendingPayments.find((p) => p.id === paymentId) || selectedPayment;
    if (!payment) {
      setError('Payment not found');
      return;
    }

    const recipientHandle = payment.recipientHandle || user?.handle || '';
    const cleanHandle = recipientHandle.replace(/^@/, '').trim().toLowerCase();

    claimingRef.current = true;
    try {
      setIsClaiming(true);
      setError(null);

      // Step 1: Ensure passkey is registered
      const alreadyHasPasskey = webauthn.hasLocalPasskey(cleanHandle);
      if (!alreadyHasPasskey) {
        setClaimStepMsg('Step 1 of 3: Creating passkey on this device…');
        await webauthn.registerPasskey(cleanHandle);
        setHasPasskey(true);
      }

      // Step 2: Sign with device passkey (Touch ID / Face ID)
      setClaimStepMsg(
        alreadyHasPasskey
          ? 'Step 1 of 2: Confirm with your passkey…'
          : 'Step 2 of 3: Confirm with your passkey…'
      );
      const assertion = await webauthn.authenticatePasskey(cleanHandle, {
        hasServerPasskey: user?.hasPasskey,
      });

      // Step 3: Complete confidential claim on NEAR intent
      setClaimStepMsg(
        alreadyHasPasskey
          ? 'Step 2 of 2: Settling payment into your vault…'
          : 'Step 3 of 3: Settling payment into your vault…'
      );
      const result = await api.claimPayment(
        payment.claimCode || payment.id,
        cleanHandle,
        assertion.authPayload
      );

      setClaimResult(result);
      setClaimSuccess(true);

      // Remove claimed payment from pending list
      setPendingPayments((prev) => prev.filter((p) => p.id !== payment.id));
      if (selectedPayment?.id === payment.id) {
        setSelectedPayment(null);
      }

      // Refresh shielded balances
      setClaimStepMsg('Refreshing balances…');
      await loadShieldedBalances();

      return result;
    } catch (err: any) {
      const msg = describePasskeyError(err);
      setError(msg);
      throw err;
    } finally {
      claimingRef.current = false;
      setIsClaiming(false);
      setClaimStepMsg(null);
    }
  };

  // ── Claim ALL pending payments in one touch ──────────────────────────────
  const claimAllWithPasskey = async (paymentsToClaim: PaymentIntent[] = pendingPayments) => {
    if (claimingRef.current) return;
    if (paymentsToClaim.length === 0) {
      setError('No pending payments to claim.');
      return;
    }

    const recipientHandle = user?.handle || paymentsToClaim[0].recipientHandle;
    const cleanHandle = recipientHandle.replace(/^@/, '').trim().toLowerCase();
    const ids = paymentsToClaim.map((p) => p.claimCode || p.id);

    claimingRef.current = true;
    try {
      setIsClaiming(true);
      setError(null);

      // Step 1: Ensure passkey
      const alreadyHasPasskey = webauthn.hasLocalPasskey(cleanHandle);
      if (!alreadyHasPasskey) {
        setClaimStepMsg('Step 1 of 3: Creating passkey on this device…');
        await webauthn.registerPasskey(cleanHandle);
        setHasPasskey(true);
      }

      // Step 2: Single passkey touch to authorize all claims
      setClaimStepMsg(
        alreadyHasPasskey
          ? 'Step 1 of 2: Confirm with your passkey…'
          : 'Step 2 of 3: Confirm with your passkey…'
      );
      const assertion = await webauthn.authenticatePasskey(cleanHandle, {
        hasServerPasskey: user?.hasPasskey,
      });

      // Step 3: Execute batch claim
      setClaimStepMsg(
        alreadyHasPasskey
          ? `Step 2 of 2: Settling ${ids.length} payments into your vault…`
          : `Step 3 of 3: Settling ${ids.length} payments into your vault…`
      );
      const result = await api.claimAllPayments(
        ids,
        cleanHandle,
        assertion.authPayload
      );

      setClaimResult(result);
      setClaimSuccess(true);
      const claimed = new Set(ids);
      setPendingPayments((prev) => prev.filter((p) => !claimed.has(p.claimCode || p.id)));
      setSelectedPayment(null);

      // Refresh balances
      setClaimStepMsg('Refreshing balances…');
      await loadShieldedBalances();

      return result;
    } catch (err: any) {
      const msg = describePasskeyError(err);
      setError(msg);
      throw err;
    } finally {
      claimingRef.current = false;
      setIsClaiming(false);
      setClaimStepMsg(null);
    }
  };

  return {
    pendingPayments,
    selectedPayment,
    setSelectedPayment,
    isLoading,
    isClaiming,
    claimStepMsg,
    claimSuccess,
    claimResult,
    error,
    hasPasskey,
    shieldedBalances,
    loadShieldedBalances,
    loadPendingPayments,
    claimPaymentWithPasskey,
    claimAllWithPasskey,
    clearError: () => setError(null),
    resetSuccess: () => setClaimSuccess(false),
  };
}
