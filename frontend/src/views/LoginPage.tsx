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
      const inv = params.get('invite') || currentInvite();
      if (inv) setUrlInvite(inv.trim().toUpperCase());
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

  // When returning after signup, passkey is primary by default!
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'x'>(() => {
    if (typeof window === 'undefined') return 'passkey';
    const returning =
      localStorage.getItem('uprail_has_signed_up') === 'true' ||
      webauthn.hasLocalPasskey() ||
      !!localStorage.getItem('uprail_last_handle');
    return returning ? 'passkey' : 'x';
  });

  // Determine user progression stage:
  // Stage 1: Connect 𝕏 or Passkey Unlock (if !user)
  // Stage 2: Create Device Passkey (if user exists, but hasPasskey is false)
  // Stage 3: Fully onboarded (has 𝕏 and passkey) -> route to /parking or /app
  const isStep1 = !isLoading && !user;
  const isStep2 = !isLoading && !!user && user.hasPasskey === false;
  const isComplete = !isLoading && !!user && user.hasPasskey === true;

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
        setError('Passkey prompt was cancelled on your device.');
      } else {
        setError(err?.message || 'Passkey not recognized on this device. Please sign in with 𝕏.');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const isInteracting = isXLoading || isPasskeyLoading || isSuccess;



  const isPasskeyHero = isStep1 && loginMethod === 'passkey';

  return (
    <div className="min-h-[100dvh] w-full bg-stone-50 text-stone-900 flex flex-col justify-center items-center px-4 py-8 sm:px-6 sm:py-12 selection:bg-black selection:text-white relative overflow-hidden font-sans">
      {/* Interactive Background Canvas */}
      <QuantusInteractiveCanvas fullScreenRoam={true} />

      {/* Main Multi-Stage Card */}
      <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-white border border-stone-200/90 rounded-3xl p-6 sm:p-8 md:p-9 shadow-xl space-y-6">
        
        {/* Brand & Step Indicator */}
        <div className="flex flex-col items-center text-center space-y-3">
          <GlitchLogo href="/" size="lg" />

          <div className="space-y-1">
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-600 mb-1">
              {isPasskeyHero ? (
                <>
                  <Fingerprint className="w-3.5 h-3.5 text-stone-800" />
                  <span>Passkey Biometrics</span>
                </>
              ) : isStep1 ? (
                <span>Step 1 of 2: Identity</span>
              ) : (
                <span>Step 2 of 2: Security</span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight">
              {isPasskeyHero ? 'Welcome Back' : isStep1 ? 'Connect with 𝕏' : 'Set Up Device Passkey'}
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 font-sans">
              {isPasskeyHero
                ? 'Sign in with your hardware passkey (Face ID, Touch ID, or Security Key).'
                : isStep1
                ? 'Sign in with your Twitter handle to link confidential payments.'
                : 'Create your hardware biometric key to secure your NEAR vault.'}
            </p>
          </div>
        </div>

        {/* Preloaded Invite Banner */}
        {urlInvite && (
          <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 text-xs font-mono flex items-center justify-between shadow-xs">
            <span className="text-stone-500">Access Invite:</span>
            <span className="font-bold text-stone-950 bg-white px-2 py-0.5 rounded border border-stone-300 tracking-wider">
              {urlInvite}
            </span>
            <span className="text-[10px] text-stone-400">Preloaded</span>
          </div>
        )}

        {/* Error / Success Feedback */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-mono flex items-start space-x-2.5 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{error}</span>
          </div>
        )}

        {isSuccess && (
          <div className="p-3.5 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs font-mono flex items-center space-x-2.5 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <span className="font-medium">{successStepMessage}</span>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 1: Passkey Primary OR 𝕏 OAuth */}
        {/* ============================================================== */}
        {isStep1 && (
          <div className="space-y-4 pt-1">
            {isPasskeyHero ? (
              <>
                {/* Returning User Profile Badge (if known) */}
                {lastHandle && (
                  <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <img
                        src={lastAvatar || `https://unavatar.io/twitter/${lastHandle}`}
                        alt={lastHandle}
                        className="w-9 h-9 rounded-full border border-stone-300 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://unavatar.io/twitter/${lastHandle}`;
                        }}
                      />
                      <div className="text-left">
                        {lastName && <div className="text-xs font-bold font-sans text-stone-900">{lastName}</div>}
                        <div className="text-xs font-mono font-bold text-stone-800">@{lastHandle}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Passkey Ready</span>
                    </div>
                  </div>
                )}

                {/* Primary Hero Action: Sign In with Passkey */}
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={isInteracting}
                  className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-md hover:shadow-lg cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
                >
                  {isPasskeyLoading ? (
                    <div className="w-full flex items-center justify-center space-x-2.5">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="font-mono text-xs uppercase tracking-wider">Verifying Biometrics...</span>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Fingerprint className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                        Sign In with Passkey
                      </span>
                      <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </>
                  )}
                </button>

                {/* Secondary Option: Connect with X */}
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => setLoginMethod('x')}
                    className="text-xs text-stone-500 hover:text-stone-900 font-mono transition-colors cursor-pointer inline-flex items-center space-x-1.5 mx-auto py-1"
                  >
                    <span>Or connect with</span>
                    <svg className="w-3.5 h-3.5 fill-current inline-block" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
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
                  className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
                >
                  {isXLoading ? (
                    <div className="w-full flex items-center justify-center space-x-2.5">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="font-mono text-xs uppercase tracking-wider">Connecting to 𝕏...</span>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                      </div>
                      <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                        1. Connect with 𝕏
                      </span>
                      <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </>
                  )}
                </button>

                {/* Secondary Option: Switch to Passkey */}
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => setLoginMethod('passkey')}
                    className="text-xs text-stone-600 hover:text-stone-900 font-mono transition-colors cursor-pointer inline-flex items-center space-x-1.5 mx-auto py-1"
                  >
                    <Fingerprint className="w-3.5 h-3.5 text-stone-600" />
                    <span>{hasSignedUp ? 'Switch back to Passkey' : 'Already have a passkey? Sign in with Passkey'}</span>
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
          <div className="space-y-4 pt-1 animate-fade-in">
            {/* Identity Badge */}
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <img
                  src={user.avatarUrl}
                  alt={user.handle}
                  className="w-8 h-8 rounded-full border border-stone-300"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="text-left">
                  <div className="text-xs font-bold font-sans text-stone-900">
                    {user.name}
                  </div>
                  <div className="text-[11px] font-mono text-stone-500">
                    @{user.handle}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-1 text-[11px] font-mono text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                <span>Connected</span>
              </div>
            </div>

            {/* Explanation box */}
            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 space-y-1 font-sans">
              <div className="font-bold flex items-center space-x-1.5 text-amber-950">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>One-time Passkey Registration</span>
              </div>
              <p className="text-[11px] text-amber-800/90 leading-relaxed">
                Your device hardware (Face ID / Touch ID) will generate a cryptographic key. No passwords or seed phrases needed.
              </p>
            </div>

            {/* Primary Action: Create Passkey */}
            <button
              type="button"
              onClick={handleRegisterPasskey}
              disabled={isInteracting}
              className="group relative w-full h-14 px-4 sm:px-5 rounded-2xl bg-black hover:bg-stone-900 active:scale-[0.99] text-white font-display font-bold text-sm sm:text-base tracking-wide transition-all duration-150 flex items-center justify-between shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
            >
              {isPasskeyLoading ? (
                <div className="w-full flex items-center justify-center space-x-2.5">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-wider">Creating Passkey...</span>
                </div>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Fingerprint className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white flex-1 text-center pr-1 sm:pr-2">
                    2. Enable Device Passkey
                  </span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </>
              )}
            </button>

            {/* Switch Account */}
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={async () => {
                  await api.logout();
                  await refreshSession();
                }}
                disabled={isInteracting}
                className="text-[11px] font-mono text-stone-400 hover:text-stone-700 transition-colors underline underline-offset-4 cursor-pointer"
              >
                Sign in with a different 𝕏 account
              </button>
            </div>
          </div>
        )}

        {/* Terms & Privacy Disclaimer inside the Card */}
        <div className="pt-3 text-center text-[11px] font-sans text-stone-400 leading-normal border-t border-stone-100">
          By continuing, you agree to UPRAIL&apos;s{' '}
          <button
            type="button"
            onClick={openTerms}
            className="text-stone-700 hover:text-black underline underline-offset-2 transition-colors cursor-pointer font-medium"
          >
            Terms &amp; Conditions
          </button>{' '}
          and{' '}
          <button
            type="button"
            onClick={openPrivacyPolicy}
            className="text-stone-700 hover:text-black underline underline-offset-2 transition-colors cursor-pointer font-medium"
          >
            Privacy Policy
          </button>
          .
        </div>

      </div>

      {/* Subtle Footer with Legal Links */}
      <footer className="relative z-10 mt-6 flex items-center justify-center space-x-3 text-xs font-mono text-stone-400 select-none">
        <button
          type="button"
          onClick={openPrivacyPolicy}
          className="hover:text-stone-700 transition-colors cursor-pointer underline underline-offset-4"
        >
          Privacy Policy
        </button>
        <span>•</span>
        <button
          type="button"
          onClick={openTerms}
          className="hover:text-stone-700 transition-colors cursor-pointer underline underline-offset-4"
        >
          Terms &amp; Conditions
        </button>
      </footer>

      {/* Modal for Privacy Policy and Terms & Conditions */}
      <LegalModal
        isOpen={legalModalOpen}
        onClose={() => setLegalModalOpen(false)}
        initialTab={legalTab}
      />
    </div>
  );
};
