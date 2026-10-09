/**
 * WebCrypto HMAC-SHA256 utilities for stateless signed cookies in Cloudflare Workers.
 * Zero KV writes, zero database hits, tamper-proof edge cryptography.
 */

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Signs a payload string with HMAC-SHA256.
 * Returns `${base64url(payload)}.${base64url(signature)}`
 */
export async function signPayload(payloadStr: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payloadStr);
  const key = await getHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, payloadBytes);

  const payloadB64 = base64UrlEncode(payloadBytes);
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuffer));

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies HMAC-SHA256 signature and returns the unpacked payload string, or null if invalid/tampered.
 */
export async function verifyAndUnpack(token: string, secret: string): Promise<string | null> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const sigB64 = token.slice(dotIndex + 1);

  try {
    const payloadBytes = base64UrlDecode(payloadB64);
    const sigBytes = base64UrlDecode(sigB64);
    const key = await getHmacKey(secret);

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!isValid) return null;

    const decoder = new TextDecoder();
    return decoder.decode(payloadBytes);
  } catch {
    return null;
  }
}
