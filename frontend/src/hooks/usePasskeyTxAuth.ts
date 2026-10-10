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
 *   1. Request a fresh challenge from /api/auth-challenge
 *   2. Prompt the user's device for a WebAuthn assertion using that challenge
 *   3. Return the assertion to be included in the fund-moving API call
 *
 * Security:
 *   - Challenges are single-use and expire in 5 minutes
 *   - The server verifies the signature cryptographically before processing
 *   - Without a valid passkey assertion, send/claim are rejected with 403
 */

import { useState, useCallback } from 'react';
import { api } from '../lib/api';

/**
 * Decodes a base64url string (as issued by the server) into raw bytes.
 * Equivalent to @simplewebauthn/browser's base64URLStringToBuffer().
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface PasskeyAssertion {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string;
  };
}

export function usePasskeyTxAuth() {
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Prompts the user for a passkey assertion to authorize a fund-moving transaction.
   * Returns the assertion object to be included in the API request body.
   *
   * @param actionDescription - Human-readable description shown in browser passkey prompt
   * @returns PasskeyAssertion to include as `passkeyAssertion` in the API body
   */
  const authorizeWithPasskey = useCallback(async (
    _actionDescription?: string
  ): Promise<PasskeyAssertion> => {
    setIsAuthorizing(true);
    setError(null);

    try {
      // Step 1: Get a fresh server-issued single-use tx_auth challenge.
      // The server also tells us the rpId it registered the passkey under —
      // guessing it from window.location.hostname breaks on any host that
      // isn't exactly the registration origin.
      const { challenge, rpId } = await api.getTxAuthOptions();

      // Step 2: The server's challenge is a base64url string; the authenticator
      // must sign its raw bytes so clientDataJSON.challenge round-trips back
      // to the exact string the server stored.
      const challengeBytes = base64UrlToBytes(challenge);

      // Step 3: Prompt device for passkey assertion
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn is not supported in this browser');
      }

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBytes,
          ...(rpId ? { rpId } : {}),
          userVerification: 'required', // Required for fund movements
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('No passkey credential returned');
      }

      const assertionResponse = credential.response as AuthenticatorAssertionResponse;

      // Step 4: Encode assertion for transport to server
      const assertion: PasskeyAssertion = {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        type: 'public-key',
        response: {
          authenticatorData: btoa(
            String.fromCharCode(...new Uint8Array(assertionResponse.authenticatorData))
          ),
          clientDataJSON: btoa(
            String.fromCharCode(...new Uint8Array(assertionResponse.clientDataJSON))
          ),
          signature: btoa(
            String.fromCharCode(...new Uint8Array(assertionResponse.signature))
          ),
          userHandle: assertionResponse.userHandle
            ? btoa(String.fromCharCode(...new Uint8Array(assertionResponse.userHandle)))
            : undefined,
        },
      };

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
