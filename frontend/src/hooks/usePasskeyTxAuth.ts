/**
 * usePasskeyTxAuth — React hook for passkey-authorized fund movements
 *
 * Usage:
 *   const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
 *   ...
 *   const assertion = await authorizeWithPasskey('Send 10 USDC to @alice?');
 *   // Then include assertion in the API call body as `passkeyAssertion`
 *
 * Flow:
 *   1. Request a fresh challenge options object from /api/auth-challenge
 *   2. Prompt the user's device for a WebAuthn assertion via @simplewebauthn/browser
 *   3. Return the standard base64url-encoded assertion to be included in the fund-moving API call
 *
 * Security:
 *   - Challenges are single-use and expire in 5 minutes
 *   - The server verifies the signature cryptographically before processing
 *   - Without a valid passkey assertion, send/claim are rejected with 403
 */

import { useState, useCallback } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { api } from '../lib/api';

export type PasskeyAssertion = AuthenticationResponseJSON;

export function usePasskeyTxAuth() {
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Prompts the user for a passkey assertion to authorize a fund-moving transaction.
   * Returns the assertion object to be included in the API request body.
   *
   * @param _actionDescription - Human-readable description shown in browser passkey prompt
   * @returns PasskeyAssertion to include as `passkeyAssertion` in the API body
   */
  const authorizeWithPasskey = useCallback(async (
    _actionDescription?: string
  ): Promise<PasskeyAssertion> => {
    setIsAuthorizing(true);
    setError(null);

    try {
      // Step 1: Get a fresh server-issued single-use tx_auth challenge options object.
      // The server provides challenge, rpId, timeout, and allowed parameters.
      const options = await api.getTxAuthOptions();

      // Step 2: Use startAuthentication from @simplewebauthn/browser
      // This ceremony ensures 100% compliant base64url encoding across all fields
      // and guarantees id === rawId matching required by SimpleWebAuthn.
      const assertion = await startAuthentication(options as any);

      return assertion;
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Passkey authorization was cancelled or timed out'
        : err?.message || 'Passkey authorization failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsAuthorizing(false);
    }
  }, []);

  return {
    authorizeWithPasskey,
    isAuthorizing,
    error,
    clearError: () => setError(null),
  };
}
