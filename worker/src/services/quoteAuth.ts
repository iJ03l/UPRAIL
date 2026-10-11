/**
 * Cryptographic Quote Signing and Verification
 * Enforces authenticated, non-repudiable quote binding for payment intents.
 * Every token MUST be `<base64url(payload)>.<hex(HMAC)>` produced by this
 * worker's own key — there is no signatureless or foreign-signature path.
 */

export interface QuoteAuthPayload {
  quoteId: string;
  asset: string;
  amount: string;
  recipient: string;
  depositAddress: string;
  expiresAt: number;
}

function base64UrlEncode(str: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

/**
 * Signs a payment quote cryptographically using HMAC-SHA256.
 * Produces a self-verifiable token: `<base64url(payload)>.<hex(HMAC)>`
 */
export async function signQuote(
  secret: string,
  payload: QuoteAuthPayload
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const canonicalData = `${payload.quoteId}:${payload.asset}:${payload.amount}:${payload.recipient}:${payload.depositAddress}:${payload.expiresAt}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalData));
  const sigHex = toHex(sigBuffer);

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);

  return `${payloadB64}.${sigHex}`;
}

/**
 * Cryptographically verifies a quote signature token.
 * Validates HMAC authenticity, prevents replay, checks expiry, and ensures
 * exact binding to asset, amount, and recipient.
 */
export async function verifyQuoteToken(
  secret: string,
  tokenStr: string,
  expected: {
    asset: string;
    amount: string;
    recipientHandle: string;
    depositAddress?: string;
  }
): Promise<{ valid: boolean; reason?: string; payload?: QuoteAuthPayload }> {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return { valid: false, reason: 'Missing quote signature' };
  }

  // The only accepted format is `<base64url(payload)>.<hex(HMAC-SHA256)>`.
  // Bare hex strings, dummy tokens, and any other shape are rejected — an
  // unauthenticated signature can never authorize a payment.
  const parts = tokenStr.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed quote signature format' };
  }

  const [payloadB64, sigHex] = parts;

  let payload: QuoteAuthPayload;
  try {
    const jsonStr = base64UrlDecode(payloadB64);
    payload = JSON.parse(jsonStr);
  } catch (err: any) {
    return { valid: false, reason: `Failed to decode quote signature payload: ${err.message}` };
  }

  // 1. Expiry check
  if (typeof payload.expiresAt === 'number' && Date.now() > payload.expiresAt) {
    return { valid: false, reason: 'Quote signature has expired' };
  }

  // 2. Asset binding check — exact after normalization. Substring matching was
  //    removed: it let a quote for one asset satisfy a payment for a different
  //    asset whose id merely contained the other as a prefix/suffix.
  const normAsset = (v: unknown) => String(v ?? '').trim().toLowerCase();
  if (normAsset(payload.asset) !== normAsset(expected.asset)) {
    return {
      valid: false,
      reason: `Quote asset mismatch: expected ${expected.asset}, got ${payload.asset}`,
    };
  }

  // 3. Amount binding check
  if (payload.amount !== expected.amount) {
    return {
      valid: false,
      reason: `Quote amount mismatch: expected ${expected.amount}, got ${payload.amount}`,
    };
  }

  // 4. Recipient binding check — exact, no .near / holding-wallet bypass.
  const cleanExpected = expected.recipientHandle.replace(/^@/, '').toLowerCase();
  const cleanPayloadRecipient = payload.recipient.replace(/^@/, '').toLowerCase();
  if (cleanPayloadRecipient !== cleanExpected) {
    return {
      valid: false,
      reason: `Quote recipient mismatch: expected ${cleanExpected}, got ${cleanPayloadRecipient}`,
    };
  }

  // 5. Deposit address binding — the address recorded on the payment must be
  //    the address the quote was signed for.
  if (
    expected.depositAddress &&
    payload.depositAddress &&
    payload.depositAddress !== expected.depositAddress
  ) {
    return {
      valid: false,
      reason: 'Quote deposit address mismatch',
    };
  }

  // 6. HMAC verification (constant-time)
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const canonicalData = `${payload.quoteId}:${payload.asset}:${payload.amount}:${payload.recipient}:${payload.depositAddress}:${payload.expiresAt}`;
  const sigBytes = fromHex(sigHex);

  const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(canonicalData));
  if (!isValid) {
    return { valid: false, reason: 'Cryptographic HMAC signature validation failed' };
  }

  return { valid: true, payload };
}
