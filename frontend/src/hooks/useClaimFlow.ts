import { useState, useEffect, useCallback } from 'react';
import { PaymentIntent, ClaimPaymentResult, ShieldedBalance } from '../types';
import { api } from '../lib/api';
import { webauthn } from '../lib/webauthn';

export function useClaimFlow(initialCode?: string) {
  const [claimCode, setClaimCode] = useState<string>(initialCode || '');
  const [payment, setPayment] = useState<PaymentIntent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [shieldedBalances, setShieldedBalances] = useState<ShieldedBalance[]>([]);

  // Load payment details by claim code
  const fetchPayment = useCallback(async (code: string) => {
    if (!code.trim()) {
      setPayment(null);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.getPaymentByCode(code.trim());
      if (!data) {
        setError('Payment intent not found. Please check your link or code.');
        setPayment(null);
      } else {
        setPayment(data);
        const registered = webauthn.hasLocalPasskey(data.recipientHandle);
        setHasPasskey(registered);
        if (data.status === 'claimed') {
          setClaimSuccess(true);
        }
      }
    } catch (err) {
      console.error('Error fetching payment:', err);
      setError('Failed to retrieve payment details');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialCode) {
      setClaimCode(initialCode);
      fetchPayment(initialCode);
    }
    // Load balances
    api.getShieldedBalances().then(setShieldedBalances);
  }, [initialCode, fetchPayment]);

  // Execute Passkey Claim
  const claimWithPasskey = async (recipientHandle?: string) => {
    if (!payment) {
      setError('No active payment to claim.');
      return;
    }

    const targetHandle = recipientHandle || payment.recipientHandle;
    const cleanHandle = targetHandle.replace(/^@/, '').trim().toLowerCase();

    try {
      setIsClaiming(true);
      setError(null);

      // Step 1: Check or Register Passkey if needed
      const alreadyHasPasskey = webauthn.hasLocalPasskey(cleanHandle);
      if (!alreadyHasPasskey) {
        // Create NIST P-256 Passkey on device
        await webauthn.registerPasskey(cleanHandle);
        setHasPasskey(true);
      }

      // Step 2: Sign claim with biometric / device passkey
      const assertion = await webauthn.authenticatePasskey(cleanHandle);

      // Step 3: Verify and complete confidential claim on NEAR intent
      const result = await api.claimPayment(
        payment.claimCode,
        cleanHandle,
        assertion.authPayload
      );

      if (result.payment) {
        setPayment(result.payment);
      }
      setClaimResult(result);
      setClaimSuccess(true);

      // Refresh shielded balances
      const updatedBalances = await api.getShieldedBalances();
      setShieldedBalances(updatedBalances);

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Claim failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setIsClaiming(false);
    }
  };

  return {
    claimCode,
    setClaimCode,
    payment,
    isLoading,
    isClaiming,
    claimSuccess,
    claimResult,
    error,
    hasPasskey,
    shieldedBalances,
    fetchPayment,
    claimWithPasskey,
    clearError: () => setError(null),
  };
}
