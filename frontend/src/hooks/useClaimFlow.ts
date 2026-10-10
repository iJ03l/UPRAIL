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

import { useState, useEffect, useCallback } from 'react';
import { PaymentIntent, ClaimPaymentResult, ShieldedBalance } from '../types';
import { api } from '../lib/api';
import { webauthn } from '../lib/webauthn';
import { useXAuth } from './useXAuth';

const PENDING_CACHE_KEY = 'uprail_pending_payments_cache';

function getCachedPending(): PaymentIntent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PENDING_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

let inFlightPendingPromise: Promise<PaymentIntent[]> | null = null;

export function useClaimFlow(initialCode?: string) {
  const { user } = useXAuth();

  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>(getCachedPending);
  const [selectedPayment, setSelectedPayment] = useState<PaymentIntent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [shieldedBalances, setShieldedBalances] = useState<ShieldedBalance[]>([]);

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
        localStorage.setItem(PENDING_CACHE_KEY, JSON.stringify(payments));
      } catch {}

      // 2. If there's an initialCode (e.g. from deep-link /claim/:id), find or fetch it
      if (initialCode?.trim()) {
        const found = payments.find((p) => p.id === initialCode.trim() || p.claimCode === initialCode.trim());
        if (found) {
          setSelectedPayment(found);
        } else {
          // Fetch directly
          const direct = await api.getPaymentByCode(initialCode.trim());
          if (direct) {
            setSelectedPayment(direct);
            if (!payments.some((p) => p.id === direct.id)) {
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
    const payment = pendingPayments.find((p) => p.id === paymentId) || selectedPayment;
    if (!payment) {
      setError('Payment not found');
      return;
    }

    const recipientHandle = payment.recipientHandle || user?.handle || '';
    const cleanHandle = recipientHandle.replace(/^@/, '').trim().toLowerCase();

    try {
      setIsClaiming(true);
      setError(null);

      // Step 1: Ensure passkey is registered
      const alreadyHasPasskey = webauthn.hasLocalPasskey(cleanHandle);
      if (!alreadyHasPasskey) {
        await webauthn.registerPasskey(cleanHandle);
        setHasPasskey(true);
      }

      // Step 2: Sign with device passkey (Touch ID / Face ID)
      const assertion = await webauthn.authenticatePasskey(cleanHandle);

      // Step 3: Complete confidential claim on NEAR intent
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
      await loadShieldedBalances();

      return result;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Claim failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setIsClaiming(false);
    }
  };

  // ── Withdraw shielded balance to an external address with Passkey ───────
  // Sends a WebAuthn assertion (same tx_auth flow as claim) with the call to
  // POST /api/claim/withdraw, which is gated by requirePasskeyAuth().
  const withdrawShieldedWithPasskey = async (
    balanceIndex: number,
    destinationAddress: string,
    amount?: string
  ): Promise<{ success: boolean; txHash: string } | undefined> => {
    const balance = shieldedBalances[balanceIndex];
    const destination = destinationAddress.trim();
    if (!balance || !destination) {
      setError('Select a balance with funds and enter a destination address');
      return;
    }

    try {
      setIsClaiming(true);
      setError(null);

      // Passkey authorization (identical to claim: tx_auth challenge + assertion)
      const handle = user?.handle || 'wallet';
      const assertion = await webauthn.authenticatePasskey(handle);

      const result = await api.withdraw({
        destinationAddress: destination,
        asset: balance.token.id,
        amount: amount || 'all',
        passkeyAssertion: assertion.authPayload,
      });

      // Refresh balances so the UI reflects the settled withdrawal
      await loadShieldedBalances();
      return { success: result.success, txHash: result.txHash };
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Withdrawal failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setIsClaiming(false);
    }
  };

  // ── Claim ALL pending payments in one touch ──────────────────────────────
  const claimAllWithPasskey = async () => {
    if (pendingPayments.length === 0) {
      setError('No pending payments to claim.');
      return;
    }

    const recipientHandle = user?.handle || pendingPayments[0].recipientHandle;
    const cleanHandle = recipientHandle.replace(/^@/, '').trim().toLowerCase();
    const ids = pendingPayments.map((p) => p.claimCode || p.id);

    try {
      setIsClaiming(true);
      setError(null);

      // Step 1: Ensure passkey
      const alreadyHasPasskey = webauthn.hasLocalPasskey(cleanHandle);
      if (!alreadyHasPasskey) {
        await webauthn.registerPasskey(cleanHandle);
        setHasPasskey(true);
      }

      // Step 2: Single passkey touch to authorize all claims
      const assertion = await webauthn.authenticatePasskey(cleanHandle);

      // Step 3: Execute batch claim
      const result = await api.claimAllPayments(
        ids,
        cleanHandle,
        assertion.authPayload
      );

      setClaimResult(result);
      setClaimSuccess(true);
      setPendingPayments([]);
      setSelectedPayment(null);

      // Refresh balances
      await loadShieldedBalances();

      return result;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Claim failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setIsClaiming(false);
    }
  };

  return {
    pendingPayments,
    selectedPayment,
    setSelectedPayment,
    isLoading,
    isClaiming,
    claimSuccess,
    claimResult,
    error,
    hasPasskey,
    shieldedBalances,
    loadShieldedBalances,
    loadPendingPayments,
    claimPaymentWithPasskey,
    claimAllWithPasskey,
    withdrawShieldedWithPasskey,
    clearError: () => setError(null),
    resetSuccess: () => setClaimSuccess(false),
  };
}
