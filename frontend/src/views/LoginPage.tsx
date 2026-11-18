'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate } from '../lib/router';
import {
  Fingerprint,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ShieldCheck,
  CircleNotch,
  Key,
  Copy,
  DownloadSimple,
  Check,
} from '@phosphor-icons/react';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn, describePasskeyError, WebAuthnSupportStatus } from '../lib/webauthn';
import { clearInvite, currentInvite, sanitizeReturnPath, stripInvite, withInvite } from '../lib/invite';
import { api } from '../lib/api';
import { signNep413RecoveryPayload } from '../lib/selfCustody';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { LegalModal, LegalTab } from '../components/LegalModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GlitchLogo } from '../components/GlitchLogo';
import { Badge } from '../components/Badge';
import { InAppBrowserNotice } from '../components/InAppBrowserNotice';
import { AuthLoadingScreen } from '../components/AuthLoadingScreen';

interface LoginPageProps {
  initialLegalTab?: LegalTab;
}

export const LoginPage: React.FC<LoginPageProps> = ({ initialLegalTab }) => {
  const { user, isLoading, isRedirecting, login: loginWithX, refreshSession } = useXAuth();
  const navigate = useNavigate();

  const [isXLoading, setIsXLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [revokeLostPasskeys, setRevokeLostPasskeys] = useState(true);
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [pendingRecoveryBackup, setPendingRecoveryBackup] = useState<{
    recoveryKey: string;
    nearAccount: string;
    backupPubkey: string;
    backupNearPrivateKey: string;
  } | null>(null);
  const [copiedRecoveryKey, setCopiedRecoveryKey] = useState(false);
  const [downloadedRecoveryKey, setDownloadedRecoveryKey] = useState(false);
  const [savedRecoveryConfirmed, setSavedRecoveryConfirmed] = useState(false);
  const [successStepMessage, setSuccessStepMessage] = useState('');
  const [urlInvite, setUrlInvite] = useState('');

  // Legal modal state
  const [legalModalOpen, setLegalModalOpen] = useState(!!initialLegalTab);
  const [legalTab, setLegalTab] = useState<LegalTab>(initialLegalTab || 'privacy');

  const openPrivacyPolicy = () => {
    setLegalTab('privacy');
    setLegalModalOpen(true);
  };

  const openTerms = () => {
    setLegalTab('terms');
    setLegalModalOpen(true);
  };

  // Whether this device can create an on-device (platform) passkey. On Android
  // this is false when no screen lock is configured — which is exactly why
  // Chrome then offers only a security key / "another device" instead of the
  // device lock. Surfaced as a hint so the user can fix it before tapping.
  const [support, setSupport] = useState<WebAuthnSupportStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    webauthn
      .checkSupport()
      .then((s) => {
        if (!cancelled) setSupport(s);
      })
      .catch(() => {
        if (!cancelled) setSupport({ supported: false, platformAuthenticator: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Capture ?invite=CODE, ?error=..., and legal query params if present.
  // The invite is also remembered so it survives the next hop (passkey step,
  // OAuth round trip, /parking) without the recipient re-entering it.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invite') || params.get('ref') || params.get('code') || currentInvite();
      if (inv) {
        setUrlInvite(inv.trim().toUpperCase());
      } else {
        setUrlInvite('');
      }
      const err = params.get('error');
      if (err) setError(decodeURIComponent(err));
      if (params.get('privacy') || params.get('legal') === 'privacy') {
        setLegalTab('privacy');
        setLegalModalOpen(true);
      } else if (params.get('terms') || params.get('legal') === 'terms') {
        setLegalTab('terms');
        setLegalModalOpen(true);
      }
    }
  }, []);

  // Check if this device has previously completed signup / registered a passkey
  const [hasSignedUp, setHasSignedUp] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      localStorage.getItem('uprail_has_signed_up') === 'true' ||
      webauthn.hasLocalPasskey() ||
      !!localStorage.getItem('uprail_last_handle')
    );
  });

  const [lastHandle, setLastHandle] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('uprail_last_handle') || null;
  });

  const [lastName, setLastName] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('uprail_last_name') || null;
  });

  const [lastAvatar, setLastAvatar] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('uprail_last_avatar') || null;
  });

  // When returning after signup on THIS device, passkey is primary by default.
  // If this device lacks a local passkey in Keychain, default to 𝕏 to link it.
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'x'>(() => {
    if (typeof window === 'undefined') return 'x';
    return webauthn.hasLocalPasskey() ? 'passkey' : 'x';
  });

  // A recovery grant is stored server-side for 10 minutes. Rehydrate it so a
  // reload during passkey replacement does not burn a second recovery code.
  useEffect(() => {
    if (user?.recoveryAuthorized) setRecoveryAuthorized(true);
  }, [user?.recoveryAuthorized]);

  // Determine user progression stage:
  // Stage 1: Connect 𝕏 or Passkey Unlock (if !user)
  // Stage 2: Create Device Passkey (if user exists, but this specific device lacks a passkey)
  // Stage 3: Fully onboarded (has 𝕏 and passkey on this device) -> route to /parking or /app
  const isStep1 = !isLoading && !user;
  // X OAuth only proves identity. A passkey assertion (or a consumed recovery
  // code, which grants one replacement registration) is required before the
  // rest of the app is reachable.
  const needsPasskeyConfirmation =
    !isLoading && !!user && user.hasPasskey === true && user.passkeyVerified !== true && !recoveryAuthorized && !pendingRecoveryBackup;
  const needsPasskeyCreation =
    !isLoading && !!user && (user.hasPasskey !== true || recoveryAuthorized) && !pendingRecoveryBackup;
  const isComplete =
    !isLoading &&
    !!user &&
    user.hasPasskey === true &&
    user.passkeyVerified === true &&
    !needsPasskeyCreation &&
    !pendingRecoveryBackup;

  // Where this session was originally headed (share links send people to
  // /claim/<id>?invite=... — dropping that sends the recipient back to square one).
  const pendingReturnPath = () => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('return_to');
    const safe = sanitizeReturnPath(raw);
    return safe && safe !== '/login' && safe !== '/parking' ? safe : null;
  };

  const [isClaimReturn, setIsClaimReturn] = useState(false);
  const [isIosEnv, setIsIosEnv] = useState(false);
  const [isGoogleAppIos, setIsGoogleAppIos] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [copiedHandoff, setCopiedHandoff] = useState(false);

  useEffect(() => {
    setIsClaimReturn(Boolean(pendingReturnPath()?.startsWith('/claim/')));
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
      setIsIosEnv(ios);
      setIsGoogleAppIos(ios && /GSA\//i.test(ua));
    }
  }, []);

  // Pre-fetch WebAuthn options so `navigator.credentials.create()` / `.get()`
  // runs synchronously inside the user's tap gesture (WebKit on iOS expires
  // transient user activation if we await a network fetch inside onClick).
  useEffect(() => {
    if (needsPasskeyCreation && user?.handle) {
      void webauthn.prefetchRegisterOptions(user.handle);
    } else if (needsPasskeyConfirmation) {
      void webauthn.prefetchTxAuthOptions();
    } else if (isStep1 && loginMethod === 'passkey') {
      void webauthn.prefetchLoginOptions(lastHandle || undefined);
    }
  }, [needsPasskeyCreation, needsPasskeyConfirmation, isStep1, loginMethod, user?.handle, lastHandle]);

  // Pre-mint a 1-time browser handoff link on iOS when signed in with X on
  // Step 2 so tapping "Continue in Safari" / "Continue in Chrome" transfers
  // the @handle session directly without repeating X OAuth.
  useEffect(() => {
    let cancelled = false;
    if (isIosEnv && user && !user.passkeyVerified && (isGoogleAppIos || error)) {
      const ret = typeof window !== 'undefined' ? `/login${window.location.search || ''}` : '/login';
      api
        .createBrowserHandoff(ret)
        .then((res) => {
          if (!cancelled && res?.url) setHandoffUrl(res.url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isIosEnv, isGoogleAppIos, user, error]);

  // If already complete, forward immediately to destination
  useEffect(() => {
    if (isComplete && user) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('uprail_has_signed_up', 'true');
        localStorage.setItem('uprail_last_handle', user.handle);
        if (user.name) localStorage.setItem('uprail_last_name', user.name);
        if (user.avatarUrl) localStorage.setItem('uprail_last_avatar', user.avatarUrl);
      }
      if (user.isActivated === false) {
        navigate(withInvite('/parking'), { replace: true });
      } else {
        // Activated accounts no longer need the preloaded invite. Strip it
        // from the return path so a share link cannot leave the banner on
        // /app/claim after signup.
        clearInvite();
        const target = pendingReturnPath();
        navigate(target ? stripInvite(target) : '/app', { replace: true });
      }
    }
  }, [isComplete, user, navigate]);

  // Step 1: Initiate 𝕏 OAuth login
  const handleXLogin = async () => {
    try {
      setIsXLoading(true);
      setError(null);
      await loginWithX();
    } catch (err: any) {
      console.error('X login error:', err);
      setError(err?.message || 'Failed to authenticate with 𝕏. Please try again.');
      setIsXLoading(false);
    }
  };

  // Step 2: Register Device Passkey for 𝕏 handle
  const handleRegisterPasskey = async () => {
    if (!user?.handle) return;
    try {
      setIsPasskeyLoading(true);
      setError(null);

      const result = await webauthn.registerPasskey(user.handle);
      if (result.success) {
        setRecoveryAuthorized(false);
        setShowRecovery(false);

        if (result.recoveryKey) {
          setCopiedRecoveryKey(false);
          setDownloadedRecoveryKey(false);
          setSavedRecoveryConfirmed(false);
          setPendingRecoveryBackup({
            recoveryKey: result.recoveryKey,
            nearAccount: result.nearAccount || user.nearAccount || '',
            backupPubkey: result.backupPubkey || '',
            backupNearPrivateKey: result.backupNearPrivateKey || '',
          });
        } else {
          setIsSuccess(true);
          setSuccessStepMessage('You\'re all set. This device can now sign you in.');
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem('uprail_has_signed_up', 'true');
          localStorage.setItem('uprail_last_handle', user.handle);
          if (user.name) localStorage.setItem('uprail_last_name', user.name);
          if (user.avatarUrl) localStorage.setItem('uprail_last_avatar', user.avatarUrl);
          setHasSignedUp(true);
          setLastHandle(user.handle);
          setLastName(user.name || null);
          setLastAvatar(user.avatarUrl || null);
          setLoginMethod('passkey');
        }

        // Refresh user session to pick up new passkey & near account
        await refreshSession();
      }
    } catch (err: any) {
      console.error('Passkey creation error:', err);
      setError(describePasskeyError(err));
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Full reset for a stuck device: destroy the 𝕏 session cookie AND clear
  // every local key, including the passkey device records a normal logout
  // keeps. A stale `uprail_registered_passkeys` marker makes the client LOOK
  // FOR a passkey this device never created (the passkey manager then "does
  // not respond") instead of offering to create one — so we wipe it and land
  // back on step 1 to start over.
  const handleDisconnect = async () => {
    if (isDisconnecting) return;
    try {
      setIsDisconnecting(true);
      setError(null);
      await api.disconnect();
    } finally {
      // Hard navigation, not a router push: drop all in-memory auth/module
      // state so nothing can re-hydrate the old session.
      window.location.replace('/login');
    }
  };

  // Primary Passkey Sign In for returning users who already signed up
  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setError(null);

      const targetHandle = lastHandle || undefined;
      const result = await webauthn.loginWithPasskey(targetHandle);
      if (result.success) {
        setIsSuccess(true);
        setSuccessStepMessage('You\'re signed in. Welcome back.');

        if (typeof window !== 'undefined' && result.user?.handle) {
          localStorage.setItem('uprail_has_signed_up', 'true');
          localStorage.setItem('uprail_last_handle', result.user.handle);
          if (result.user.name) localStorage.setItem('uprail_last_name', result.user.name);
          if (result.user.avatarUrl) localStorage.setItem('uprail_last_avatar', result.user.avatarUrl);
          setHasSignedUp(true);
          setLastHandle(result.user.handle);
        }

        await refreshSession();
      }
    } catch (err: any) {
      console.error('Passkey login error:', err);
      const described = describePasskeyError(err);
      setError(
        err?.name === 'NotAllowedError' || err?.name === 'InvalidStateError'
          ? `${described} Sign in with 𝕏 to set up a passkey here.`
          : described
      );
      setLoginMethod('x');
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handleConfirmPasskey = async () => {
    try {
      setIsConfirmLoading(true);
      setError(null);
      await webauthn.confirmSessionPasskey(user?.handle);
      setIsSuccess(true);
      setSuccessStepMessage('Passkey confirmed. Welcome back.');
      await refreshSession();
    } catch (err: any) {
      console.error('Passkey confirmation error:', err);
      setError(describePasskeyError(err));
    } finally {
      setIsConfirmLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isSelfCustody = user?.custodyMode === 'self';
    if (!recoveryCode.trim()) {
      setError(
        isSelfCustody
          ? 'Paste your UP1-… Offline Recovery Key to authorize a replacement passkey.'
          : 'Enter one of your recovery codes.'
      );
      return;
    }
    try {
      setIsRecoveryLoading(true);
      setError(null);

      if (isSelfCustody) {
        const regOpts = await api.getSelfCustodyRecoveryRegisterOptions();
        const { startRegistration } = await import('@simplewebauthn/browser');
        const attestation = await startRegistration(regOpts.options);
        const prep = await api.prepareSelfCustodyRecovery({
          attestation,
          expectedChallenge: regOpts.challenge,
          revokeLostPasskeys,
        });
        const signedNep413 = await signNep413RecoveryPayload({
          phrase: recoveryCode.trim(),
          nearAccount: prep.nearAccount || user.nearAccount || regOpts.nearAccount,
          payload: prep.nep413Payload,
        });
        await api.submitSelfCustodyRecovery({
          recoveryActionId: prep.recoveryActionId,
          signedNep413,
        });
        setRecoveryCode('');
        setShowRecovery(false);
        setSuccessStepMessage('Self-Custody passkey recovered on-chain! Taking you to your account…');
        setIsSuccess(true);
        await refreshSession();
        return;
      }

      await api.verifyRecoveryCode(recoveryCode);
      setRecoveryCode('');
      setShowRecovery(false);
      setRecoveryAuthorized(true);
      setSuccessStepMessage('Recovery code accepted. Create a new passkey for this device.');
      setIsSuccess(true);
    } catch (err: any) {
      setError(
        describePasskeyError(err) ||
          err?.message ||
          (isSelfCustody
            ? 'Could not recover Self-Custody passkey. Verify your UP1-… Recovery Key and try again.'
            : 'That recovery code is invalid or has already been used.')
      );
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  const handleUseDifferentAccount = async () => {
    await api.logout();
    setRecoveryAuthorized(false);
    setShowRecovery(false);
    setRecoveryCode('');
    setError(null);
    setIsSuccess(false);
    await refreshSession();
  };

  const isInteracting =
    isXLoading || isPasskeyLoading || isConfirmLoading || isRecoveryLoading || isSuccess;



  const isPasskeyHero = isStep1 && loginMethod === 'passkey';

  const XGlyph: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );

  // Show a real loading surface for both the session check and the OAuth
  // hand-off. The previous code rendered the login card immediately, then
  // yanked it away mid-transition into a blank page.
  if (isLoading || isRedirecting) {
    return (
      <AuthLoadingScreen
        message={isRedirecting ? 'Opening 𝕏' : 'Checking your session'}
        hint={isRedirecting ? 'Continue in the 𝕏 window that just opened.' : 'This only takes a moment.'}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-surface text-ink flex flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-16 selection:bg-ink selection:text-surface relative overflow-hidden font-sans">
      {/* Interactive Background Canvas */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Main Multi-Stage Card */}
      <main className="relative z-10 w-full max-w-md space-y-4">
        {/* Passkeys are unavailable inside X/Telegram webviews — warn early */}
        <InAppBrowserNotice />
        <div className="bg-white border border-line rounded-3xl p-7 sm:p-9 shadow-xl space-y-8">

          {/* Brand & Heading */}
          <header className="flex flex-col items-center text-center space-y-4">
            <GlitchLogo href="/" size="lg" />

            <div className="space-y-2">
              {(() => {
                const showClaimContext = isStep1 && isClaimReturn;
                return (
                  <>
                    {isPasskeyHero ? (
                      <Badge tone="neutral" icon={<Fingerprint weight="bold" className="w-3 h-3" />}>
                        Passkey sign-in
                      </Badge>
                    ) : showClaimContext ? (
                      <Badge tone="ok">You&apos;ve been paid</Badge>
                    ) : isStep1 ? (
                      <Badge tone="neutral">Step 1 of 2</Badge>
                    ) : showRecovery ? (
                      <Badge tone="neutral" icon={<Key weight="fill" className="w-3 h-3" />}>
                        Recovery
                      </Badge>
                    ) : needsPasskeyConfirmation ? (
                      <Badge tone="neutral" icon={<ShieldCheck weight="fill" className="w-3 h-3" />}>
                        Confirm sign-in
                      </Badge>
                    ) : needsPasskeyCreation ? (
                      <Badge tone="neutral">Step 2 of 2</Badge>
                    ) : (
                      <Badge tone="neutral">Signing in</Badge>
                    )}

                    <h1 className="text-2xl sm:text-[1.75rem] font-display font-extrabold text-ink tracking-tight">
                      {isPasskeyHero
                        ? 'Welcome back'
                        : showClaimContext
                        ? 'Someone sent you money'
                        : isStep1
                        ? 'Sign in to UPRAIL'
                        : showRecovery
                        ? user?.custodyMode === 'self'
                          ? 'Use Offline Recovery Key'
                          : 'Use a recovery code'
                        : needsPasskeyConfirmation
                        ? 'Confirm it\'s you'
                        : needsPasskeyCreation
                        ? 'Secure this device'
                        : 'Signing you in'}
                    </h1>
                    <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto">
                      {isPasskeyHero
                        ? 'Use your passkey — Face ID, fingerprint, or your PIN — to sign in.'
                        : showClaimContext
                        ? 'Sign in with 𝕏 to receive it. No wallet needed.'
                        : isStep1
                        ? 'Use your 𝕏 account to get a payment handle. No crypto wallet or password to remember.'
                        : showRecovery
                        ? user?.custodyMode === 'self'
                          ? 'Paste your offline UP1-… Recovery Key to authorize a replacement passkey directly on-chain.'
                          : 'Enter one of the single-use codes you saved. It lets you replace a lost passkey.'
                        : needsPasskeyConfirmation
                        ? 'Your 𝕏 account is connected. Confirm this sign-in with the passkey on this device.'
                        : needsPasskeyCreation
                  ? recoveryAuthorized
                    ? 'Recovery code accepted. Create a new passkey to secure this device again.'
                    : 'Set up a passkey so you can use this device without 𝕏 next time.'
                      : 'Your session is verified. Taking you to your account.'}
                  </p>
                </>
                );
              })()}
            </div>
          </header>

          {/* Preloaded Invite Banner */}
          {urlInvite && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-subtle border border-line px-4 py-3 text-xs font-mono">
              <span className="text-muted">Invite code</span>
              <span className="font-bold text-ink bg-surface px-2.5 py-0.5 rounded-lg border border-line-strong tracking-wider">
                {urlInvite}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-subtle">Applied</span>
            </div>
          )}

          {/* Error / Success Feedback */}
          {error && (
            <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3.5 text-xs text-red-700 animate-fade-in space-y-3">
              <div className="flex items-start gap-2.5">
                <WarningCircle weight="fill" className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="flex-1 leading-relaxed font-mono">{error}</span>
              </div>
              {isIosEnv && (
                <div className="pt-1 border-t border-red-200/70 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={(
                        handoffUrl ||
                        (typeof window !== 'undefined' ? window.location.href : 'https://app.uprail.world/login')
                      ).replace(/^https?:\/\//i, 'x-safari-https://')}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-red-900 hover:bg-red-800 text-white font-display font-bold text-[11px] uppercase tracking-wider transition-colors text-center"
                    >
                      Continue in Safari
                    </a>
                    <a
                      href={(
                        handoffUrl ||
                        (typeof window !== 'undefined' ? window.location.href : 'https://app.uprail.world/login')
                      )
                        .replace(/^https:\/\//i, 'googlechromes://')
                        .replace(/^http:\/\//i, 'googlechrome://')}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white hover:bg-red-100/60 text-red-950 border border-red-300 font-display font-bold text-[11px] uppercase tracking-wider transition-colors text-center"
                    >
                      Continue in Chrome
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const target =
                        handoffUrl ||
                        (typeof window !== 'undefined' ? window.location.href : 'https://app.uprail.world/login');
                      await navigator.clipboard.writeText(target);
                      setCopiedHandoff(true);
                      setTimeout(() => setCopiedHandoff(false), 3000);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/80 hover:bg-white text-red-900 border border-red-200 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    {copiedHandoff ? (
                      <>
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied sign-in link — paste in Safari or Chrome</span>
                      </>
                    ) : (
                      <>
                        <Copy weight="fill" className="w-3.5 h-3.5" />
                        <span>Copy sign-in link for Safari / Chrome</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {!error && isGoogleAppIos && (needsPasskeyCreation || needsPasskeyConfirmation) && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3.5 text-xs text-amber-900 animate-fade-in space-y-2.5">
              <div className="font-mono leading-relaxed">
                Inside the Google app on iPhone? If the passkey sheet does not appear below, continue in Safari or Chrome (you&apos;ll stay signed in as @{user?.handle}):
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={(
                    handoffUrl ||
                    (typeof window !== 'undefined' ? window.location.href : 'https://app.uprail.world/login')
                  ).replace(/^https?:\/\//i, 'x-safari-https://')}
                  className="flex items-center justify-center py-2 px-3 rounded-xl bg-amber-900 hover:bg-amber-800 text-white font-display font-bold text-[11px] uppercase tracking-wider transition-colors text-center"
                >
                  Open in Safari
                </a>
                <a
                  href={(
                    handoffUrl ||
                    (typeof window !== 'undefined' ? window.location.href : 'https://app.uprail.world/login')
                  )
                    .replace(/^https:\/\//i, 'googlechromes://')
                    .replace(/^http:\/\//i, 'googlechrome://')}
                  className="flex items-center justify-center py-2 px-3 rounded-xl bg-white hover:bg-amber-100/60 text-amber-950 border border-amber-300 font-display font-bold text-[11px] uppercase tracking-wider transition-colors text-center"
                >
                  Open in Chrome
                </a>
              </div>
            </div>
          )}

          {isSuccess && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-surface-muted border border-line-strong px-4 py-3.5 text-xs text-ink animate-fade-in">
              <CheckCircle weight="fill" className="w-4 h-4 text-ink flex-shrink-0" />
              <span className="font-medium">{successStepMessage}</span>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 1: Passkey Primary OR 𝕏 OAuth */}
          {/* ============================================================== */}
          {isStep1 && (
            <div className="space-y-5">
              {isPasskeyHero ? (
                <>
                  {/* Returning User Profile */}
                  {lastHandle && (
                    <div className="flex items-center justify-between rounded-2xl bg-surface-subtle border border-line px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <img
                          src={lastAvatar || `https://unavatar.io/twitter/${lastHandle}`}
                          alt={lastHandle}
                          className="w-9 h-9 rounded-full border border-line object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://unavatar.io/twitter/${lastHandle}`;
                          }}
                        />
                        <div className="text-left">
                          {lastName && <div className="text-sm font-bold text-ink">{lastName}</div>}
                          <div className="text-xs font-mono text-muted">@{lastHandle}</div>
                        </div>
                      </div>
                      <Badge tone="ok" icon={<ShieldCheck weight="fill" className="w-3 h-3" />}>
                        Ready
                      </Badge>
                    </div>
                  )}

                  {/* Primary Hero Action: Sign in with Passkey */}
                  <button
                    type="button"
                    onClick={handlePasskeyLogin}
                    disabled={isInteracting}
                    className="btn-primary group w-full h-14 rounded-2xl px-5 font-display font-bold text-base tracking-tight flex items-center justify-between shadow-md select-none"
                  >
                    {isPasskeyLoading ? (
                      <div className="w-full flex items-center justify-center gap-2.5">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        <span className="font-mono text-xs uppercase tracking-wider">Verifying…</span>
                      </div>
                    ) : (
                      <>
                        <span className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/10 flex items-center justify-center flex-shrink-0">
                          <Fingerprint weight="bold" className="w-4 h-4" />
                        </span>
                        <span className="flex-1 text-center pr-2">Sign in with passkey</span>
                        <ArrowRight weight="bold" className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                      </>
                    )}
                  </button>

                  {/* Secondary Option: Use 𝕏 */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setLoginMethod('x')}
                      className="inline-flex items-center gap-1.5 py-1 text-xs font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                    >
                      <span>Use 𝕏 instead</span>
                      <XGlyph className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Primary Action: 𝕏 OAuth */}
                  <button
                    type="button"
                    onClick={handleXLogin}
                    disabled={isInteracting}
                    className="btn-primary group w-full h-14 rounded-2xl px-5 font-display font-bold text-base tracking-tight flex items-center justify-between shadow-md select-none"
                  >
                    {isXLoading ? (
                      <div className="w-full flex items-center justify-center gap-2.5">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        <span className="font-mono text-xs uppercase tracking-wider">Connecting…</span>
                      </div>
                    ) : (
                      <>
                        <span className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/10 flex items-center justify-center flex-shrink-0">
                          <XGlyph className="w-4 h-4" />
                        </span>
                        <span className="flex-1 text-center pr-2">Continue with 𝕏</span>
                        <ArrowRight weight="bold" className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                      </>
                    )}
                  </button>

                  {/* Secondary Option: Sign in with Passkey */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setLoginMethod('passkey')}
                      className="inline-flex items-center gap-1.5 py-1 text-xs font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                    >
                      <Fingerprint weight="bold" className="w-3.5 h-3.5" />
                      <span>{hasSignedUp ? 'Sign in with passkey' : 'Already set up on this device?'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* CONFIRM: passkey is the mandatory second factor for X OAuth */}
          {/* ============================================================== */}
          {needsPasskeyConfirmation && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between rounded-2xl bg-surface-subtle border border-line px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={user.avatarUrl}
                    alt={user.handle}
                    className="w-8 h-8 rounded-full border border-line flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="text-left min-w-0">
                    <div className="text-sm font-bold text-ink truncate">{user.name}</div>
                    <div className="text-xs font-mono text-muted flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="truncate">@{user.handle}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUseDifferentAccount}
                  disabled={isInteracting}
                  className="text-[11px] font-mono text-subtle hover:text-ink underline underline-offset-4 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Switch
                </button>
              </div>

              {showRecovery ? (
                <form onSubmit={handleRecoverySubmit} className="space-y-3">
                  <div className="space-y-1.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 px-4 py-3.5 text-amber-900">
                    <div className="flex items-center gap-1.5 font-bold text-amber-950">
                      <Key weight="fill" className="w-4 h-4 text-amber-700" />
                      <span className="text-sm">Lost your passkey?</span>
                    </div>
                    <p className="text-xs leading-relaxed text-amber-800/90">
                      {user?.custodyMode === 'self'
                        ? 'Paste your saved UP1-… Recovery Key. Your browser signs an on-chain authorization locally to enroll a replacement passkey.'
                        : 'Enter one saved code. It works once, then you\'ll create a new passkey on this device.'}
                    </p>
                  </div>
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => {
                      setRecoveryCode(
                        user?.custodyMode === 'self'
                          ? e.target.value
                          : e.target.value.toUpperCase()
                      );
                      setError(null);
                    }}
                    placeholder={
                      user?.custodyMode === 'self' ? 'UP1-XXXX-XXXX-…' : 'XXXX-XXXX-XXXX'
                    }
                    autoComplete="one-time-code"
                    spellCheck={false}
                    className="w-full h-14 rounded-2xl border border-line bg-surface px-4 font-mono text-sm tracking-[0.12em] text-ink placeholder:text-subtle focus:outline-none focus:border-ink transition-colors"
                  />
                  {user?.custodyMode === 'self' && (
                    <label className="flex items-center gap-2 text-xs text-muted px-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={revokeLostPasskeys}
                        onChange={(e) => setRevokeLostPasskeys(e.target.checked)}
                        className="rounded border-line"
                      />
                      <span>Revoke old lost passkey(s) on-chain during recovery</span>
                    </label>
                  )}
                  <button
                    type="submit"
                    disabled={isRecoveryLoading || !recoveryCode.trim()}
                    className="btn-primary w-full h-14 rounded-2xl px-5 font-display font-bold text-base tracking-tight flex items-center justify-center gap-2.5 shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isRecoveryLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        <span className="font-mono text-xs uppercase tracking-wider">
                          {user?.custodyMode === 'self' ? 'Recovering…' : 'Checking…'}
                        </span>
                      </>
                    ) : (
                      <span>
                        {user?.custodyMode === 'self'
                          ? 'Enroll new passkey with Recovery Key'
                          : 'Use recovery code'}
                      </span>
                    )}
                  </button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRecovery(false);
                        setRecoveryCode('');
                        setError(null);
                      }}
                      className="text-xs font-mono text-muted hover:text-ink underline underline-offset-4 transition-colors cursor-pointer"
                    >
                      Back to passkey
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="space-y-1.5 rounded-2xl bg-surface-subtle border border-line px-4 py-3.5">
                    <div className="flex items-center gap-1.5 font-bold text-ink">
                      <ShieldCheck weight="fill" className="w-4 h-4" />
                      <span className="text-sm">Second factor required</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      X proves who you are. Your passkey proves this sign-in is really you.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmPasskey}
                    disabled={isInteracting}
                    className="btn-primary group w-full h-14 rounded-2xl px-5 font-display font-bold text-base tracking-tight flex items-center justify-between shadow-md select-none"
                  >
                    {isConfirmLoading ? (
                      <div className="w-full flex items-center justify-center gap-2.5">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        <span className="font-mono text-xs uppercase tracking-wider">Verifying…</span>
                      </div>
                    ) : (
                      <>
                        <span className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/10 flex items-center justify-center flex-shrink-0">
                          <Fingerprint weight="bold" className="w-4 h-4" />
                        </span>
                        <span className="flex-1 text-center pr-2">Confirm with passkey</span>
                        <ArrowRight weight="bold" className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                      </>
                    )}
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRecovery(true);
                        setError(null);
                      }}
                      disabled={isInteracting}
                      className="inline-flex items-center gap-1.5 py-1 text-xs font-mono text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Key weight="fill" className="w-3.5 h-3.5" />
                      <span>
                        {user?.custodyMode === 'self'
                          ? 'Use your Offline Recovery Key'
                          : 'Use a recovery code'}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 2: Create / Register Device Passkey */}
          {/* ============================================================== */}
          {needsPasskeyCreation && (
            <div className="space-y-5 animate-fade-in">
              {/* Identity */}
              <div className="flex items-center justify-between rounded-2xl bg-surface-subtle border border-line px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={user.avatarUrl}
                    alt={user.handle}
                    className="w-8 h-8 rounded-full border border-line flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="text-left min-w-0">
                    <div className="text-sm font-bold text-ink truncate">{user.name}</div>
                    <div className="text-xs font-mono text-muted flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="truncate">@{user.handle}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDisconnectConfirm(true)}
                  disabled={isInteracting || isDisconnecting}
                  title="Disconnect this 𝕏 account and clear this device"
                  className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-stone-600 hover:text-red-600 bg-surface px-2.5 py-1 rounded-md border border-line hover:border-red-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <XGlyph className="w-3 h-3" />
                  <span>{isDisconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
                </button>
              </div>

              {/* Explanation */}
              <div className="space-y-1.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 px-4 py-3.5 text-amber-900">
                <div className="flex items-center gap-1.5 font-bold text-amber-950">
                  <ShieldCheck weight="fill" className="w-4 h-4 text-amber-700" />
                  <span className="text-sm">One-time setup</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-800/90">
                  {recoveryAuthorized
                    ? 'Your recovery code was accepted. Create a new passkey now — this replaces the passkey that was lost or left on another device.'
                    : 'This device saves a passkey — a secure sign-in built into your phone or laptop. Use Face ID, fingerprint, or your PIN. No password to remember.'}
                </p>
              </div>

              {/* Primary Action: Create Passkey */}
              <button
                type="button"
                onClick={handleRegisterPasskey}
                disabled={isInteracting}
                className="btn-primary group w-full h-14 rounded-2xl px-5 font-display font-bold text-base tracking-tight flex items-center justify-between shadow-md select-none"
              >
                {isPasskeyLoading ? (
                  <div className="w-full flex items-center justify-center gap-2.5">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-xs uppercase tracking-wider">Creating…</span>
                  </div>
                ) : (
                  <>
                    <span className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/10 flex items-center justify-center flex-shrink-0">
                      <Fingerprint weight="bold" className="w-4 h-4" />
                    </span>
                    <span className="flex-1 text-center pr-2">Set up passkey</span>
                    <ArrowRight weight="bold" className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                  </>
                )}
              </button>

              {/* Switch Account */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={handleUseDifferentAccount}
                  disabled={isInteracting}
                  className="text-[11px] font-mono text-subtle hover:text-ink underline underline-offset-4 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Use a different 𝕏 account
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 2B: Save Offline Self-Custody Recovery Key (New Signups) */}
          {/* ============================================================== */}
          {pendingRecoveryBackup && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3.5">
                <div className="flex items-center gap-1.5 font-bold text-emerald-700">
                  <ShieldCheck weight="fill" className="w-4 h-4" />
                  <span className="text-sm">Non-Custodial Vault Locked to Your Passkey</span>
                </div>
                <p className="text-xs leading-relaxed text-stone-600">
                  Save your offline Recovery Key before continuing. It is generated only in your browser and never sent to UPRAIL.
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-surface-subtle p-4 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted font-bold">
                  Offline Recovery Key
                </div>
                <div className="rounded-xl bg-surface border border-line p-3 font-mono text-xs font-semibold tracking-wider text-ink select-all break-all text-center">
                  {pendingRecoveryBackup.recoveryKey}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(pendingRecoveryBackup.recoveryKey);
                      setCopiedRecoveryKey(true);
                    }}
                    className="btn-secondary flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    {copiedRecoveryKey ? (
                      <>
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy weight="fill" className="w-3.5 h-3.5" />
                        <span>Copy Key</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const handle = (user?.handle || 'uprail').replace(/[^a-zA-Z0-9_-]/g, '');
                      const content = [
                        'UPRAIL SELF-CUSTODY RECOVERY KEY (DEVICE-ONLY — NEVER SENT TO SERVER)',
                        '========================================================================',
                        `Handle: @${handle}`,
                        `NEAR Intents & L1 Account: ${pendingRecoveryBackup.nearAccount}`,
                        `Backup Public Key: ${pendingRecoveryBackup.backupPubkey}`,
                        `NEAR L1 FullAccess Private Key: ${pendingRecoveryBackup.backupNearPrivateKey}`,
                        '',
                        `Recovery Key: ${pendingRecoveryBackup.recoveryKey}`,
                        '',
                        'IMPORTANT:',
                        '- Keep this Recovery Key offline (password manager, hardware vault, or paper).',
                        '- Anyone with this key + your X sign-in can authorize a replacement passkey.',
                        '- Uprail never stores this key and cannot regenerate it for you.',
                      ].join('\n');
                      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `uprail-recovery-key-${handle}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      setDownloadedRecoveryKey(true);
                    }}
                    className="btn-secondary flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    {downloadedRecoveryKey ? (
                      <>
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Saved .txt</span>
                      </>
                    ) : (
                      <>
                        <DownloadSimple weight="fill" className="w-3.5 h-3.5" />
                        <span>Download .txt</span>
                      </>
                    )}
                  </button>
                </div>

                <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={savedRecoveryConfirmed}
                    onChange={(e) => setSavedRecoveryConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-emerald-600"
                  />
                  <span className="text-xs text-stone-600 leading-snug">
                    I have saved my Recovery Key offline. I understand UPRAIL cannot recover my account without it if I lose my passkey.
                  </span>
                </label>
              </div>

              <button
                type="button"
                disabled={!savedRecoveryConfirmed || (!copiedRecoveryKey && !downloadedRecoveryKey)}
                onClick={() => {
                  setIsSuccess(true);
                  setSuccessStepMessage('You\'re all set. Non-custodial vault active.');
                  setPendingRecoveryBackup(null);
                }}
                className="btn-primary w-full h-12 rounded-2xl px-5 font-display font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Continue to UPRAIL</span>
                <ArrowRight weight="bold" className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Terms & Privacy */}
          <div className="border-t border-line pt-5 text-center text-[11px] text-subtle leading-relaxed">
            By continuing, you agree to UPRAIL&apos;s{' '}
            <button
              type="button"
              onClick={openTerms}
              className="font-medium text-muted hover:text-ink underline underline-offset-2 transition-colors cursor-pointer"
            >
              Terms &amp; Conditions
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={openPrivacyPolicy}
              className="font-medium text-muted hover:text-ink underline underline-offset-2 transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            .
          </div>

        </div>

        {/* Footer Legal Links */}
        <footer className="mt-6 flex items-center justify-center gap-3 text-xs font-mono text-subtle select-none">
          <button
            type="button"
            onClick={openPrivacyPolicy}
            className="hover:text-ink underline underline-offset-4 transition-colors cursor-pointer"
          >
            Privacy Policy
          </button>
          <span aria-hidden="true">•</span>
          <button
            type="button"
            onClick={openTerms}
            className="hover:text-ink underline underline-offset-4 transition-colors cursor-pointer"
          >
            Terms &amp; Conditions
          </button>
        </footer>
      </main>

      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        title="Disconnect this 𝕏 account?"
        description="This signs out of UPRAIL on this device and clears the local sign-in records. Your account and money stay onchain."
        details={[
          { label: 'Account', value: user ? `@${user.handle}` : '—', mono: true },
          { label: 'This device', value: 'Passkey records will be cleared', mono: false },
        ]}
        warning="You will need your 𝕏 account and device sign-in to sign back in. Only do this if you are switching accounts or this device is stuck."
        confirmLabel="Disconnect & clear"
        tone="danger"
        isLoading={isDisconnecting}
        onConfirm={() => {
          setShowDisconnectConfirm(false);
          void handleDisconnect();
        }}
        onCancel={() => setShowDisconnectConfirm(false)}
      />

      {/* Modal for Privacy Policy and Terms & Conditions */}
      <LegalModal
        isOpen={legalModalOpen}
        onClose={() => setLegalModalOpen(false)}
        initialTab={legalTab}
      />
    </div>
  );
};
