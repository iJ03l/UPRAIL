/**
 * In-app (embedded) browser detection.
 *
 * Passkeys / WebAuthn are refused inside the embedded webviews that X,
 * Telegram, Instagram and similar apps open links in. The ceremony fails with
 * a `NotAllowedError`, which we surface to the user as "passkey cancelled" —
 * even though nothing was cancelled; the host app simply does not allow
 * WebAuthn. Detecting these browsers lets us tell the user to open the link in
 * their real browser instead of blaming their device.
 */

export interface InAppBrowserInfo {
  isInApp: boolean;
  /** Human name of the host app, e.g. "X", "Telegram". */
  app: string | null;
  ios: boolean;
  android: boolean;
}

const HOST_APPS: Array<{ app: string; re: RegExp }> = [
  { app: 'X', re: /Twitter for iPhone|Twitter for iPad|TwitterAndroid|TwitterBot/i },
  { app: 'Telegram', re: /Telegram/i },
  { app: 'Instagram', re: /Instagram/i },
  { app: 'Facebook', re: /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i },
  { app: 'WhatsApp', re: /WhatsApp/i },
  { app: 'TikTok', re: /BytedanceWebview|TikTok|musical_ly/i },
  { app: 'Snapchat', re: /Snapchat/i },
  { app: 'LinkedIn', re: /\bLinkedInApp\b/i },
  { app: 'Reddit', re: /Reddit/i },
];

export function detectInAppBrowser(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''
): InAppBrowserInfo {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
  const android = /Android/i.test(ua);

  for (const { app, re } of HOST_APPS) {
    if (re.test(ua)) return { isInApp: true, app, ios, android };
  }

  // Generic embedded markers.
  // Android WebView: "...; wv) AppleWebKit/... Version/4.0 ..." (also used by
  // Gmail/Newsstand etc.).
  if (android && /; wv\)/i.test(ua)) return { isInApp: true, app: null, ios, android };

  // iOS/iPadOS webviews almost always omit the "Safari/" token that real
  // Safari/Chrome/Firefox include.
  if (ios && !/Safari|CriOS|FxiOS|EdgiOS|GSA\//i.test(ua)) {
    return { isInApp: true, app: null, ios, android };
  }

  return { isInApp: false, app: null, ios, android };
}

/** Name to show the user, falling back to a generic phrase. */
export function inAppBrowserLabel(info: InAppBrowserInfo): string {
  return info.app ? `${info.app}'s in-app browser` : "this app's in-app browser";
}

/**
 * Best-effort escape hatch out of an in-app webview and into the platform
 * browser. Returns true when a navigation was attempted.
 *
 * - iOS: the `x-safari-https://` scheme makes Safari open the URL.
 * - Android: an `intent://` URL asks the OS to open the link in Chrome.
 */
export function openInSystemBrowser(url: string = window.location.href): boolean {
  if (typeof window === 'undefined') return false;
  const info = detectInAppBrowser();

  if (info.ios) {
    const safariUrl = url.replace(/^https?:\/\//i, 'x-safari-https://');
    window.location.href = safariUrl;
    return true;
  }

  if (info.android) {
    const rest = url.replace(/^https?:\/\//i, '');
    const intentUrl = `intent://${rest}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = intentUrl;
    return true;
  }

  // Desktop or an already-good browser: just open normally.
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
