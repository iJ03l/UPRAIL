import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { api } from './api';
import { detectInAppBrowser, inAppBrowserLabel } from './inAppBrowser';
import { XUser } from '../types';
import {
  saveStoredPasskey,
  getRegisteredPasskeys as readRegisteredPasskeys,
  hasLocalPasskey as storedPasskeyExists,
  type StoredPasskeyInfo,
} from './passkeyStorage';

export type { StoredPasskeyInfo } from './passkeyStorage';

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
    return "Your device's passkey manager didn't respond. Make sure a screen lock (PIN, pattern, or biometric) is set and that Google Password Manager is your passkey provider, then update Google Play Services and try again — or use a security key or another device.";
  }
  if (
    name === 'NotSupportedError' ||
    msg.includes('not supported') ||
    msg.includes('no create options')
  ) {
    return 'This device can’t create an on-device passkey. Set a screen lock (PIN, pattern, or biometric) in your device settings, or use a security key or another device.';
  }
  if (name === 'SecurityError' || msg.includes('rp id') || msg.includes('cannot be validated')) {
    return 'Passkeys are blocked on this address. Open uprail.world directly in your browser and try again.';
  }
  if (name === 'AbortError') {
    return 'The passkey prompt was interrupted (a call, rotation, or app switch). Please try again.';
  }
  return err?.message || 'Could not create a passkey on this device. Please try again.';
}

/**
 * True when a WebAuthn failure came from the credential provider itself
 * (Android's Credential Manager and equivalents) rather than a genuine user
 * cancel. These are the failures worth retrying once with relaxed options —
 * e.g. Android Chrome throws `UnknownError` on creation when a resident key is
 * required but the active provider cannot mint one.
 *
 * `NotAllowedError` is deliberately excluded: it is the user cancelling the
 * prompt, and retrying would re-prompt them.
 */
export function isCredentialManagerError(err: any): boolean {
  const name = err?.name || '';
  const msg = String(err?.message || '').toLowerCase();
  return (
    name === 'UnknownError' ||
    name === 'NotSupportedError' ||
    name === 'ConstraintError' ||
    msg.includes('credential manager') ||
    msg.includes('unknown error') ||
    msg.includes('unknown transient')
  );
}

export interface WebAuthnSupportStatus {
  supported: boolean;
  platformAuthenticator: boolean;
}

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
    return storedPasskeyExists(handle);
  },

  /**
   * Get all registered passkeys on this device.
   */
  getRegisteredPasskeys(): StoredPasskeyInfo[] {
    return readRegisteredPasskeys();
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
    if (res?.user?.handle) {
      saveStoredPasskey({
        credentialId: assertion.id,
        handle: res.user.handle,
        createdAt: new Date().toISOString(),
        algorithm: 'ES256 (NIST P-256)',
        deviceLabel: navigator.platform || 'Device Biometric Key',
      });
    }
    return res;
  },

  /**
   * Answers the mandatory second factor after X OAuth. This proves the
   * credential belongs to the signed-in account and keeps the same session.
   */
  async confirmSessionPasskey(handle?: string): Promise<{
    success: boolean;
    passkeyVerified: boolean;
    hasRecoveryCodes?: boolean;
    recoveryCodesRemaining?: number;
  }> {
    const rawOptions = await api.getTxAuthOptions();
    const options: any = { ...rawOptions, userVerification: 'preferred' };
    delete options.allowCredentials;
    const assertion = await startAuthentication(options);
    const result = await api.confirmPasskey(assertion);
    if (handle) {
      saveStoredPasskey({
        credentialId: assertion.id,
        handle,
        createdAt: new Date().toISOString(),
        algorithm: 'ES256 (NIST P-256)',
        deviceLabel: navigator.platform || 'Device Biometric Key',
      });
    }
    return result;
  },

  /**
   * Rotates recovery codes. Requires a fresh passkey assertion server-side.
   */
  async regenerateRecoveryCodes(): Promise<{ recoveryCodes: string[]; remaining: number }> {
    const rawOptions = await api.getTxAuthOptions();
    const options: any = { ...rawOptions, userVerification: 'preferred' };
    delete options.allowCredentials;
    const assertion = await startAuthentication(options);
    return api.regenerateRecoveryCodes(assertion);
  },

  /**
   * Reveals unused recovery codes after a fresh passkey assertion.
   */
  async viewRecoveryCodes(): Promise<{ codes: string[]; remaining: number; legacy: number }> {
    const rawOptions = await api.getTxAuthOptions();
    const options: any = { ...rawOptions, userVerification: 'preferred' };
    delete options.allowCredentials;
    const assertion = await startAuthentication(options);
    return api.getRecoveryCodes(assertion);
  },

  /**
   * Register a new hardware passkey (Touch ID, Face ID, Windows Hello, YubiKey)
   * using NIST P-256 (ES256) signature algorithm.
   */
  async registerPasskey(handle: string): Promise<{
    success: boolean;
    credentialId: string;
  }> {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase();
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn is not supported on this browser.');
    }

    const rawOptions = await api.getPasskeyRegisterOptions(cleanHandle);

    // Prefer the device's built-in authenticator (fingerprint / face / screen
    // lock). When one is available we constrain to 'platform' so Chrome skips
    // the "choose a device" sheet — which on Android only lists security
    // key / NFC / other device when no on-device passkey provider is set up —
    // and prompts for the device lock directly. When it is NOT available we
    // leave it unconstrained so a security key or another device still works,
    // and the error path explains how to enable the on-device option.
    let platformAvailable = false;
    try {
      platformAvailable = await platformAuthenticatorIsAvailable();
    } catch {
      platformAvailable = false;
    }

    const options: any = {
      ...rawOptions,
      // WebAuthn client hints (Chrome 128+, ignored by other browsers) steer
      // the authenticator chooser and are kept aligned with the attachment
      // below: prefer the device passkey, fall back to cross-device.
      hints: platformAvailable ? ['client-device', 'hybrid'] : ['security-key', 'hybrid'],
      authenticatorSelection: {
        ...(rawOptions.authenticatorSelection || {}),
        userVerification: 'preferred',
        ...(platformAvailable ? { authenticatorAttachment: 'platform' } : {}),
      },
    };

    let attResp: any;
    try {
      attResp = await startRegistration(
        // DOM lib and @simplewebauthn/types ship structurally duplicate definitions
        options as unknown as Parameters<typeof startRegistration>[0]
      );
    } catch (err: any) {
      // A provider hiccup (e.g. Android Credential Manager `UnknownError`) is
      // sometimes resolved by retrying once with resident keys relaxed to
      // 'preferred', which a provider that cannot mint a required resident key
      // will accept. The same server challenge is reused; it is only consumed
      // by the POST below.
      if (!isCredentialManagerError(err)) throw err;
      console.warn('[webauthn] create failed, retrying with relaxed selection:', err?.name);

      const relaxed: any = {
        ...options,
        authenticatorSelection: {
          ...options.authenticatorSelection,
          residentKey: 'preferred',
          requireResidentKey: false,
        },
      };
      delete relaxed.authenticatorSelection.authenticatorAttachment;
      delete relaxed.hints;
      attResp = await startRegistration(
        relaxed as unknown as Parameters<typeof startRegistration>[0]
      );
    }

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

    saveStoredPasskey(passkeyInfo);

    return {
      success: true,
      credentialId: attResp.id,
    };
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
