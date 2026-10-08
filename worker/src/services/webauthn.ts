/**
 * WebAuthn service wrapping @simplewebauthn/server
 * Configured for P-256 (ES256, alg -7) for NEAR confidential accounts
 */

import {
  generateRegistrationOptions as simpleGenerateRegOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions as simpleGenerateAuthOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Convert Uint8Array to hex string
 */
export function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBuffer(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate WebAuthn registration options with P-256 (-7) enforcement
 */
export async function generateRegistrationOptions(params: {
  userId: string;
  userName: string;
  rpId: string;
  rpName: string;
}) {
  const encoder = new TextEncoder();
  const userIdBytes = encoder.encode(params.userId);

  return await simpleGenerateRegOptions({
    rpName: params.rpName || 'UPRAIL',
    rpID: params.rpId || 'uprail.app',
    userID: new Uint8Array(userIdBytes),
    userName: params.userName,
    userDisplayName: `@${params.userName}`,
    attestationType: 'none',
    // Alg -7: ES256 (ECDSA w/ SHA-256 on secp256r1 / P-256 curve for NEAR)
    supportedAlgorithmIDs: [-7],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
}

/**
 * Verify WebAuthn registration attestation and extract P-256 public key
 */
export async function verifyRegistration(params: {
  attestation: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
}) {
  const verification = await verifyRegistrationResponse({
    response: params.attestation,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.expectedOrigin,
    expectedRPID: params.expectedRPID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed');
  }

  const regInfo = verification.registrationInfo as any;
  const credential = regInfo.credential || {};
  const pubKey = credential.publicKey || regInfo.credentialPublicKey;
  const credId = credential.id || regInfo.credentialID;
  const counter = credential.counter ?? regInfo.counter ?? 0;

  return {
    verified: true,
    credentialId: typeof credId === 'string' ? credId : bufferToHex(credId),
    publicKeyHex: bufferToHex(pubKey),
    counter,
  };
}

/**
 * Generate WebAuthn authentication assertion options
 */
export async function generateAuthenticationOptions(params: {
  credentialIds?: string[];
  rpId: string;
}) {
  return await simpleGenerateAuthOptions({
    rpID: params.rpId || 'uprail.app',
    allowCredentials:
      params.credentialIds && params.credentialIds.length > 0
        ? params.credentialIds.map((id) => ({
            id,
            type: 'public-key' as const,
          }))
        : undefined,
    userVerification: 'preferred',
  });
}

/**
 * Verify WebAuthn authentication assertion
 */
export async function verifyAuthentication(params: {
  assertion: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credential: {
    id: string;
    publicKey: string | Uint8Array;
    counter: number;
  };
}) {
  const pubKeyBytes =
    typeof params.credential.publicKey === 'string'
      ? hexToBuffer(params.credential.publicKey)
      : params.credential.publicKey;

  const verification = await verifyAuthenticationResponse({
    response: params.assertion,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.expectedOrigin,
    expectedRPID: params.expectedRPID,
    credential: {
      id: params.credential.id,
      publicKey: pubKeyBytes as any,
      counter: params.credential.counter,
    },
    requireUserVerification: false,
  });

  return verification;
}
