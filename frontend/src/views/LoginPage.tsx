'use client';

import React, { useState, useEffect } from 'react';
import { useNavigate } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';
import { webauthn } from '../lib/webauthn';
import { currentInvite, sanitizeReturnPath, withInvite } from '../lib/invite';
import { api } from '../lib/api';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { LegalModal, LegalTab } from '../components/LegalModal';
import { GlitchLogo } from '../components/GlitchLogo';
import { InAppBrowserNotice } from '../components/InAppBrowserNotice';

interface LoginPageProps {
  initialLegalTab?: LegalTab;
}

export const LoginPage: React.FC<LoginPageProps> = ({ initialLegalTab }) => {
  const { user, isLoading, login: loginWithX, refreshSession } = useXAuth();
  const navigate = useNavigate();

  const [isXLoading, setIsXLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
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

  // Determine user progression stage:
  // Stage 1: Connect 𝕏 or Passkey Unlock (if !user)
  // Stage 2: Create Device Passkey (if user exists, but this specific device lacks a passkey)
  // Stage 3: Fully onboarded (has 𝕏 and passkey on this device) -> route to /parking or /app
  const hasLocalDevicePasskey = user?.handle ? webauthn.hasLocalPasskey(user.handle) : webauthn.hasLocalPasskey();
  const isStep1 = !isLoading && !user;
  const isStep2 = !isLoading && !!user && (!user.hasPasskey || !hasLocalDevicePasskey);
  const isComplete = !isLoading && !!user && user.hasPasskey === true && hasLocalDevicePasskey;

  // Where this session was originally headed (share links send people to
  // /claim/<id>?invite=... — dropping that sends the recipient back to square one).
  const pendingReturnPath = () => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('return_to');
    const safe = sanitizeReturnPath(raw);
    return safe && safe !== '/login' && safe !== '/parking' ? safe : null;
  };

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
        const target = pendingReturnPath();
        navigate(target || '/app', { replace: true });
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
        setIsSuccess(true);
        setSuccessStepMessage('Device Passkey created! Confidential vault secured.');

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
        const status = await api.getAuthStatus();
        await refreshSession();

        // Redirect after short confirmation
        setTimeout(() => {
          if (!status.user?.isActivated) {
            navigate(withInvite('/parking'), { replace: true });
          } else {
            navigate(pendingReturnPath() || '/app', { replace: true });
          }
        }, 800);
      }
    } catch (err: any) {
      console.error('Passkey creation error:', err);
      if (err?.name === 'NotAllowedError') {
        setError('Passkey prompt was cancelled on your device.');
      } else {
        setError(err?.message || 'Failed to register passkey. Please try again.');
      }
    } finally {
      setIsPasskeyLoading(false);
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
        setSuccessStepMessage('Passkey verified! Welcome back.');

        if (typeof window !== 'undefined' && result.user?.handle) {
          localStorage.setItem('uprail_has_signed_up', 'true');
          localStorage.setItem('uprail_last_handle', result.user.handle);
          if (result.user.name) localStorage.setItem('uprail_last_name', result.user.name);
          if (result.user.avatarUrl) localStorage.setItem('uprail_last_avatar', result.user.avatarUrl);
          setHasSignedUp(true);
          setLastHandle(result.user.handle);
        }

        await refreshSession();

        setTimeout(() => {
          if (result.user.isActivated === false) {
            navigate(withInvite('/parking'), { replace: true });
          } else {
            navigate(pendingReturnPath() || '/app', { replace: true });
          }
        }, 500);
      }
    } catch (err: any) {
      console.error('Passkey login error:', err);
      if (err?.name === 'NotAllowedError') {
        setError('Passkey prompt cancelled or not found on this device. Sign in with 𝕏 to add a passkey here.');
      } else {
        setError('No passkey found on this device yet. Sign in with 𝕏 to add one.');
      }
      setLoginMethod('x');
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const isInteracting = isXLoading || isPasskeyLoading || isSuccess;



  const isPasskeyHero = isStep1 && loginMethod === 'passkey';

  const XGlyph: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );

  return (
    <div className="min-h-[100dvh] w-full bg-surface-subtle text-ink flex flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-16 selection:bg-ink selection:text-surface relative overflow-hidden font-sans">
      {/* Interactive Background Canvas */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Main Multi-Stage Card */}
      <main className="relative z-10 w-full max-w-md space-y-4">
        {/* Passkeys are unavailable inside X/Telegram webviews — warn early */}
        <InAppBrowserNotice />
        <div className="bg-surface border border-line rounded-3xl p-7 sm:p-9 shadow-xl space-y-8">

          {/* Brand & Heading */}
          <header className="flex flex-col items-center text-center space-y-4">
            <GlitchLogo href="/" size="lg" />

            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-muted border border-line text-[11px] font-mono font-semibold uppercase tracking-wider text-muted">
                {isPasskeyHero ? (
                  <>
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>Passkey sign in</span>
                  </>
                ) : isStep1 ? (
                  <span>Step 1 of 2</span>
                ) : (
                  <span>Step 2 of 2</span>
                )}
              </span>

              <h1 className="text-2xl sm:text-[1.75rem] font-display font-extrabold text-ink tracking-tight">
                {isPasskeyHero ? 'Welcome back' : isStep1 ? 'Sign in to UPRAIL' : 'Secure this device'}
              </h1>
              <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto">
                {isPasskeyHero
                  ? 'Use your passkey to sign in.'
                  : isStep1
                  ? 'Use your 𝕏 account to get a payment handle. No wallet, no seed phrase.'
                  : 'Add a passkey so you can sign in here without 𝕏 next time.'}
              </p>
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
            <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 border border-red-200 px-4 py-3.5 text-xs text-red-700 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="flex-1 leading-relaxed font-mono">{error}</span>
            </div>
          )}

          {isSuccess && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-surface-muted border border-line-strong px-4 py-3.5 text-xs text-ink animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-ink flex-shrink-0" />
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
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Ready</span>
                      </span>
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
                          <Fingerprint className="w-4 h-4" />
                        </span>
                        <span className="flex-1 text-center pr-2">Sign in with passkey</span>
                        <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
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
                        <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
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
                      <Fingerprint className="w-3.5 h-3.5" />
                      <span>{hasSignedUp ? 'Sign in with your passkey' : 'Already have a passkey?'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 2: Create / Register Device Passkey */}
          {/* ============================================================== */}
          {isStep2 && (
            <div className="space-y-5 animate-fade-in">
              {/* Identity */}
              <div className="flex items-center justify-between rounded-2xl bg-surface-subtle border border-line px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <img
                    src={user.avatarUrl}
                    alt={user.handle}
                    className="w-8 h-8 rounded-full border border-line"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="text-left">
                    <div className="text-sm font-bold text-ink">{user.name}</div>
                    <div className="text-xs font-mono text-muted">@{user.handle}</div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Connected</span>
                </span>
              </div>

              {/* Explanation */}
              <div className="space-y-1.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 px-4 py-3.5 text-amber-900">
                <div className="flex items-center gap-1.5 font-bold text-amber-950">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  <span className="text-sm">One-time setup</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-800/90">
                  Your device creates a secure passkey for this account. There is no password or seed phrase to remember.
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
                      <Fingerprint className="w-4 h-4" />
                    </span>
                    <span className="flex-1 text-center pr-2">Create passkey</span>
                    <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                  </>
                )}
              </button>

              {/* Skip if the account already has a passkey elsewhere */}
              {user?.hasPasskey && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => navigate(pendingReturnPath() || (user.isActivated ? '/app' : withInvite('/parking')), { replace: true })}
                    className="text-xs font-mono text-muted hover:text-ink underline underline-offset-4 transition-colors cursor-pointer"
                  >
                    Skip for now, continue to app &rarr;
                  </button>
                </div>
              )}

              {/* Switch Account */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={async () => {
                    await api.logout();
                    await refreshSession();
                  }}
                  disabled={isInteracting}
                  className="text-[11px] font-mono text-subtle hover:text-ink underline underline-offset-4 transition-colors cursor-pointer"
                >
                  Use a different 𝕏 account
                </button>
              </div>
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

      {/* Modal for Privacy Policy and Terms & Conditions */}
      <LegalModal
        isOpen={legalModalOpen}
        onClose={() => setLegalModalOpen(false)}
        initialTab={legalTab}
      />
    </div>
  );
};
