import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { api } from './api';
import { XUser } from '../types';

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
    const list: StoredPasskeyInfo[] = JSON.parse(
      localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]'
    );
    if (!handle) return list.length > 0;
    const clean = handle.replace(/^@/, '').toLowerCase();
    return list.some((p) => p.handle.toLowerCase() === clean);
  },

  /**
   * Get all registered passkeys on this device.
   */
  getRegisteredPasskeys(): StoredPasskeyInfo[] {
    return JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]');
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

    const existing: StoredPasskeyInfo[] = JSON.parse(
      localStorage.getItem(PASSKEY_STORAGE_KEY) || '[]'
    );
    existing.push(passkeyInfo);
    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(existing));

    return { success: true, credentialId: attResp.id };
  },

  /**
   * Authenticate / Sign with the device passkey (Touch ID, Face ID, PIN)
   * to claim confidential payments.
   */
  async authenticatePasskey(handle: string): Promise<{ success: boolean; credentialId: string; authPayload: unknown }> {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase();
    const isSupported = browserSupportsWebAuthn();
    if (!isSupported) {
      throw new Error('WebAuthn is not supported on this browser.');
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
