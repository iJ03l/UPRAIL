import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { api } from './api';
import { detectInAppBrowser, inAppBrowserLabel } from './inAppBrowser';
import { XUser } from '../types';

/**
 * Maps a WebAuthn ceremony failure to a short, actionable explanation.
 *
 * The raw DOMException text is meaningless to users — e.g. Android Chrome's
 * Credential Manager throws `UnknownError: An unknown error occurred while
 * talking to your credential manager` for a device/provider hiccup, and
 * `NotAllowedError` is shared by both a real cancellation and an embedded
 * webview refusing WebAuthn. Neither tells the user what to do next.
 */
const WEBAUTHN_ERROR_NAMES = new Set([
  'NotAllowedError',
  'InvalidStateError',
  'UnknownError',
  'NotSupportedError',
  'SecurityError',
  'AbortError',
  'ConstraintError',
  'TimeoutError',
]);

export function describePasskeyError(err: any): string {
  const name = err?.name || '';
  const msg = String(err?.message || '').toLowerCase();

  // Only reinterpret genuine WebAuthn failures. Non-ceremony errors (e.g. an
  // API 4xx surfaced through the same catch) must pass through untouched.
  const isWebAuthnError =
    WEBAUTHN_ERROR_NAMES.has(name) ||
    msg.includes('credential manager') ||
    msg.includes('unknown error') ||
    msg.includes('unknown transient') ||
    msg.includes('not supported') ||
    msg.includes('no create options') ||
    msg.includes('rp id') ||
    msg.includes('cannot be validated') ||
    msg.includes('timed out') ||
    msg.includes('not allowed');
  if (!isWebAuthnError) {
    return err?.message || 'Something went wrong. Please try again.';
  }

  const inApp = detectInAppBrowser();
  if (inApp.isInApp) {
    return `Passkeys can't be used inside ${inAppBrowserLabel(inApp)} — open this page in Safari or Chrome, then try again.`;
  }
  if (name === 'InvalidStateError' || msg.includes('already registered')) {
    return 'A passkey for this account already exists on this device — sign in with your passkey instead.';
  }
  if (name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed')) {
    return 'The passkey prompt was cancelled or timed out. Tap again and complete Face ID, fingerprint, or your screen lock.';
  }
  if (
    name === 'UnknownError' ||
    msg.includes('credential manager') ||
    msg.includes('unknown error') ||
    msg.includes('unknown transient')
  ) {
    return "Your device's passkey manager didn't respond. Update Google Play Services and your password manager, make sure a screen lock is set, then try again — or use another browser or device.";
  }
  if (
    name === 'NotSupportedError' ||
    msg.includes('not supported') ||
    msg.includes('no create options')
  ) {
    return 'This browser or device can’t create a passkey. Try Safari or Chrome on a device with Face ID, fingerprint, or Windows Hello.';
  }
  if (name === 'SecurityError' || msg.includes('rp id') || msg.includes('cannot be validated')) {
    return 'Passkeys are blocked on this address. Open uprail.world directly in your browser and try again.';
  }
  if (name === 'AbortError') {
    return 'The passkey prompt was interrupted (a call, rotation, or app switch). Please try again.';
  }
  return err?.message || 'Could not create a passkey on this device. Please try again.';
}

export interface WebAuthnSupportStatus {
  supported: boolean;
  platformAuthenticator: boolean;
}

export interface StoredPasskeyInfo {
  credentialId: string;
  handle: string;
  createdAt: string;
  algorithm: string;
  deviceLabel: string;
}

const PASSKEY_STORAGE_KEY = 'uprail_registered_passkeys';

export const webauthn = {
  /**
   * Checks if the current browser and platform support WebAuthn Passkeys.
   */
  async checkSupport(): Promise<WebAuthnSupportStatus> {
    const supported = browserSupportsWebAuthn();
    let platformAuthenticator = false;
    if (supported) {
      try {
        platformAuthenticator = await platformAuthenticatorIsAvailable();
      } catch {
        platformAuthenticator = false;
      }
    }
    return { supported, platformAuthenticator };
  },

  /**
   * Check if a passkey has been saved locally for this handle.
   */
  hasLocalPasskey(handle?: string): boolean {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
    try {
      const list: StoredPasskeyInfo[] = JSON.parse(
        localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]'
      );
      if (!handle) return list.length > 0;
      const clean = handle.replace(/^@/, '').toLowerCase();
      return list.some((p) => p.handle.toLowerCase() === clean);
    } catch {
      return false;
    }
  },

  /**
   * Get all registered passkeys on this device.
   */
  getRegisteredPasskeys(): StoredPasskeyInfo[] {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  /**
   * 1-Click Sign In with hardware WebAuthn Passkey (Touch ID, Face ID, Windows Hello, YubiKey)
   */
  async loginWithPasskey(handle?: string): Promise<{ success: boolean; user: XUser }> {
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn Passkeys are not supported on this browser or platform.');
    }

    // 1. Fetch challenge and options from backend (optionally scoped to known handle)
    const rawOptions = await api.getPasskeyLoginOptions(handle);
    const options: any = {
      ...rawOptions,
      userVerification: 'preferred',
    };
    // Ensure allowCredentials is deleted so modern browsers and iOS Safari present
    // "Sign in to uprail.world with your passkey" with native Face ID/Touch ID & "Other options"
    delete options.allowCredentials;

    // 2. Perform native browser WebAuthn ceremony
    const assertion = await startAuthentication(options);

    // 3. Verify assertion signature on backend and receive session
    const res = await api.verifyPasskeyLogin(assertion);
    return res;
  },

  /**
   * Register a new hardware passkey (Touch ID, Face ID, Windows Hello, YubiKey)
   * using NIST P-256 (ES256) signature algorithm.
   */
  async registerPasskey(handle: string): Promise<{ success: boolean; credentialId: string }> {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase();
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn is not supported on this browser.');
    }

    const rawOptions = await api.getPasskeyRegisterOptions(cleanHandle);
    const options: any = {
      ...rawOptions,
      authenticatorSelection: {
        ...(rawOptions.authenticatorSelection || {}),
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
      },
    };
    const attResp = await startRegistration(
      // DOM lib and @simplewebauthn/types ship structurally duplicate definitions
      options as unknown as Parameters<typeof startRegistration>[0]
    );

    // Register with backend
    await api.registerPasskeyAttestation(attResp);

    // Save passkey record locally
    const passkeyInfo: StoredPasskeyInfo = {
      credentialId: attResp.id,
      handle: cleanHandle,
      createdAt: new Date().toISOString(),
      algorithm: 'ES256 (NIST P-256)',
      deviceLabel: navigator.platform || 'Device Biometric Key',
    };

    if (typeof localStorage !== 'undefined') {
      try {
        const existing: StoredPasskeyInfo[] = JSON.parse(
          localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]'
        );
        existing.push(passkeyInfo);
        localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(existing));
      } catch {}
    }

    return { success: true, credentialId: attResp.id };
  },

  /**
   * Authenticate / Sign with the device passkey (Touch ID, Face ID, PIN)
   * to claim confidential payments.
   */
  async authenticatePasskey(
    handle: string,
    opts?: { hasServerPasskey?: boolean }
  ): Promise<{ success: boolean; credentialId: string; authPayload: unknown }> {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase();
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn is not supported on this browser.');
    }

    if (cleanHandle && cleanHandle !== 'passkey_holder' && !this.hasLocalPasskey(cleanHandle)) {
      try {
        await this.registerPasskey(cleanHandle);
      } catch (regErr) {
        // When the server confirms the account has NO passkey, the assertion
        // below can only fail — surface the create failure instead of a
        // confusing "looking for" prompt. When a passkey exists elsewhere the
        // assertion may still be answered by a synced credential, so fall
        // through.
        if (opts?.hasServerPasskey === false) {
          throw new Error(describePasskeyError(regErr));
        }
        /* fall through to assertion */
      }
    }

    // Single-use tx_auth challenge consumed by requirePasskeyAuth()
    const rawOptions = await api.getTxAuthOptions();
    const options: any = {
      ...rawOptions,
      userVerification: 'preferred',
    };
    delete options.allowCredentials;
    const asseResp = await startAuthentication(options);

    return {
      success: true,
      credentialId: asseResp.id,
      authPayload: asseResp,
    };
  },
};
