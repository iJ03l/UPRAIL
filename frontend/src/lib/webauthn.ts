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
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isGoogleAppIos = inApp.ios && /GSA\//i.test(ua);
  if (name === 'InvalidStateError' || msg.includes('already registered')) {
    return 'A passkey for this account already exists on this device — sign in with your passkey instead.';
  }
  if (name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed')) {
    if (isGoogleAppIos) {
      return 'The Google app blocked the passkey prompt or it was cancelled. Open this page in Safari or Chrome on your iPhone, then try again.';
    }
    return 'The passkey prompt was cancelled or timed out. Tap again and complete Face ID, fingerprint, or your screen lock.';
  }
  if (
    name === 'UnknownError' ||
    msg.includes('credential manager') ||
    msg.includes('unknown error') ||
    msg.includes('unknown transient')
  ) {
    if (inApp.ios) {
      return 'Your iPhone passkey provider did not respond. Make sure Passwords / iCloud Keychain (or Chrome) is enabled under Settings → General → AutoFill & Passwords, or open this page in Safari and try again.';
    }
    return "Your device's passkey manager didn't respond. Make sure a screen lock (PIN, pattern, or biometric) is set and that Google Password Manager is your passkey provider, then update Google Play Services and try again — or use a security key or another device.";
  }
  if (
    name === 'NotSupportedError' ||
    msg.includes('not supported') ||
    msg.includes('no create options')
  ) {
    if (inApp.ios) {
      return 'Passkeys could not be created in this browser window. Make sure Face ID / Touch ID & Passcode and AutoFill & Passwords are enabled in iOS Settings, or open this page in Safari.';
    }
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

const PREFETCH_TTL_MS = 240_000; // 4 minutes (server challenge TTL is 5 minutes)
let cachedPlatformAvailable: boolean | null = null;
let prefetchedReg: { handle: string; options: any; at: number } | null = null;
let prefetchedTxAuth: { options: any; at: number } | null = null;
let prefetchedLogin: { handle: string; options: any; at: number } | null = null;

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
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
        cachedPlatformAvailable = platformAuthenticator;
      } catch {
        platformAuthenticator = false;
        cachedPlatformAvailable = false;
      }
    }
    return { supported, platformAuthenticator };
  },

  /**
   * Pre-fetches registration options so `startRegistration` can be invoked
   * synchronously inside the user's tap gesture on iOS WebKit (Safari / Chrome / Google app).
   */
  async prefetchRegisterOptions(handle: string): Promise<void> {
    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase();
    if (!cleanHandle || !browserSupportsWebAuthn()) return;
    if (
      prefetchedReg &&
      prefetchedReg.handle === cleanHandle &&
      Date.now() - prefetchedReg.at < PREFETCH_TTL_MS
    ) {
      return;
    }
    try {
      const options = await api.getPasskeyRegisterOptions(cleanHandle);
      prefetchedReg = { handle: cleanHandle, options, at: Date.now() };
    } catch {
      // Ignore background prefetch errors; click handler will fetch on demand if needed
    }
  },

  /**
   * Pre-fetches tx_auth options so `confirmSessionPasskey` runs synchronously on tap.
   */
  async prefetchTxAuthOptions(): Promise<void> {
    if (!browserSupportsWebAuthn()) return;
    if (prefetchedTxAuth && Date.now() - prefetchedTxAuth.at < PREFETCH_TTL_MS) {
      return;
    }
    try {
      const options = await api.getTxAuthOptions();
      prefetchedTxAuth = { options, at: Date.now() };
    } catch {
      // Ignore background prefetch errors
    }
  },

  /**
   * Pre-fetches login options so `loginWithPasskey` runs synchronously on tap.
   */
  async prefetchLoginOptions(handle?: string): Promise<void> {
    if (!browserSupportsWebAuthn()) return;
    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase();
    if (
      prefetchedLogin &&
      prefetchedLogin.handle === cleanHandle &&
      Date.now() - prefetchedLogin.at < PREFETCH_TTL_MS
    ) {
      return;
    }
    try {
      const options = await api.getPasskeyLoginOptions(cleanHandle || undefined);
      prefetchedLogin = { handle: cleanHandle, options, at: Date.now() };
    } catch {
      // Ignore background prefetch errors
    }
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

    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase();
    let rawOptions: any;
    if (
      prefetchedLogin &&
      prefetchedLogin.handle === cleanHandle &&
      Date.now() - prefetchedLogin.at < PREFETCH_TTL_MS
    ) {
      rawOptions = prefetchedLogin.options;
      prefetchedLogin = null;
    } else {
      rawOptions = await api.getPasskeyLoginOptions(handle);
    }

    const options: any = {
      ...rawOptions,
      userVerification: 'preferred',
    };
    // Ensure allowCredentials is deleted so modern browsers and iOS Safari present
    // "Sign in to uprail.world with your passkey" with native Face ID/Touch ID & "Other options"
    delete options.allowCredentials;

    // 2. Perform native browser WebAuthn ceremony
    let assertion: any;
    try {
      assertion = await startAuthentication(options);
    } catch (err) {
      void this.prefetchLoginOptions(handle);
      throw err;
    }

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
    let rawOptions: any;
    if (prefetchedTxAuth && Date.now() - prefetchedTxAuth.at < PREFETCH_TTL_MS) {
      rawOptions = prefetchedTxAuth.options;
      prefetchedTxAuth = null;
    } else {
      rawOptions = await api.getTxAuthOptions();
    }
    const options: any = { ...rawOptions, userVerification: 'preferred' };
    delete options.allowCredentials;
    let assertion: any;
    try {
      assertion = await startAuthentication(options);
    } catch (err) {
      void this.prefetchTxAuthOptions();
      throw err;
    }
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
    nearAccount?: string;
    recoveryKey?: string;
    backupPubkey?: string;
    backupNearPrivateKey?: string;
  }> {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase();
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn is not supported on this browser.');
    }

    const isIos = isIosDevice();

    // Use pre-fetched registration options when available so `startRegistration`
    // runs synchronously inside the user's tap gesture (critical on iOS WebKit /
    // Chrome iOS / Google app where awaiting a network fetch expires transient
    // user activation and causes WebKit to throw NotAllowedError).
    let rawOptions: any;
    if (
      prefetchedReg &&
      prefetchedReg.handle === cleanHandle &&
      Date.now() - prefetchedReg.at < PREFETCH_TTL_MS
    ) {
      rawOptions = prefetchedReg.options;
      prefetchedReg = null;
    } else {
      rawOptions = (await api.getPasskeyRegisterOptions(cleanHandle)) as any;
    }

    let platformAvailable = cachedPlatformAvailable ?? false;
    if (!isIos && cachedPlatformAvailable === null) {
      try {
        platformAvailable = await platformAuthenticatorIsAvailable();
        cachedPlatformAvailable = platformAvailable;
      } catch {
        platformAvailable = false;
      }
    }

    const options: any = {
      ...rawOptions,
      ...(platformAvailable && !isIos ? { hints: ['client-device', 'hybrid'] } : {}),
      authenticatorSelection: {
        ...(rawOptions.authenticatorSelection || {}),
        residentKey: isIos
          ? 'preferred'
          : rawOptions.authenticatorSelection?.residentKey || 'required',
        requireResidentKey: isIos
          ? false
          : Boolean(rawOptions.authenticatorSelection?.requireResidentKey ?? true),
        userVerification: 'preferred',
        ...(platformAvailable && !isIos ? { authenticatorAttachment: 'platform' } : {}),
      },
    };
    if (isIos && options.authenticatorSelection) {
      delete options.authenticatorSelection.authenticatorAttachment;
      delete options.hints;
    }

    let attResp: any;
    try {
      attResp = await startRegistration(
        // DOM lib and @simplewebauthn/types ship structurally duplicate definitions
        options as unknown as Parameters<typeof startRegistration>[0]
      );
    } catch (err: any) {
      if (!isCredentialManagerError(err)) {
        void this.prefetchRegisterOptions(cleanHandle);
        throw err;
      }
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
      try {
        attResp = await startRegistration(
          relaxed as unknown as Parameters<typeof startRegistration>[0]
        );
      } catch (retryErr) {
        void this.prefetchRegisterOptions(cleanHandle);
        throw retryErr;
      }
    }

    const nearAccount = typeof rawOptions?.nearAccount === 'string' ? rawOptions.nearAccount : '';
    const isInitialPasskey =
      !Array.isArray(rawOptions?.excludeCredentials) || rawOptions.excludeCredentials.length === 0;

    let recoveryKey: string | undefined;
    let backupPubkey: string | undefined;
    let backupNearPrivateKey: string | undefined;
    if (nearAccount && isInitialPasskey) {
      const { generateDeviceRecoveryKey, deriveBackupEd25519Keypair } = await import('./selfCustody');
      recoveryKey = await generateDeviceRecoveryKey();
      const derived = await deriveBackupEd25519Keypair(recoveryKey, nearAccount);
      backupPubkey = derived.nearPublicKey;
      backupNearPrivateKey = derived.nearPrivateKey;
    }

    // Register with backend (provisions & locks non-custodial self-custody on-chain for initial passkey)
    const regRes = await api.registerPasskeyAttestation(attResp, backupPubkey);

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
      nearAccount: regRes?.nearAccount || nearAccount || undefined,
      recoveryKey,
      backupPubkey: regRes?.backupPubkey || backupPubkey,
      backupNearPrivateKey,
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
