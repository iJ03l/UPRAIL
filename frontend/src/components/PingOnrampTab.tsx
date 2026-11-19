'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretDown,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  CreditCard,
  DeviceMobile,
  Fingerprint,
  Globe,
  Warning,
} from '@phosphor-icons/react';
import { Link } from '../lib/router';
import {
  checkPingPayOtp,
  createPingPayHeadlessOrder,
  DepositStatusResponse,
  fetchPingPayConfig,
  fetchPingPayQuote,
  FiatPaymentMethod,
  PingPayApiError,
  PingPayConfigResponse,
  PingPayQuoteResponse,
  startPingPayOtp,
} from '../lib/onchainApi';
import { Badge } from './Badge';
import { TokenIcon } from './TokenIcon';
import { useToast } from './Toast';

type CheckoutStep = 'form' | 'verify' | 'otp' | 'checkout';

const METHOD_META: Record<FiatPaymentMethod, { label: string; badge: string }> = {
  APPLE_PAY: { label: 'Apple Pay', badge: 'iOS · US' },
  GOOGLE_PAY: { label: 'Google Pay', badge: 'Android · US' },
};

const METHOD_PRIORITY: FiatPaymentMethod[] = ['APPLE_PAY', 'GOOGLE_PAY'];

const QUICK_AMOUNTS = ['10', '25', '50', '100', '250'];
const OTP_STORAGE_KEY = 'uprail_pingpay_otp_v1';

interface SavedOtpToken {
  phone: string;
  token: string;
  exp: number;
}

function loadSavedOtpToken(phone: string): string | null {
  try {
    const raw = localStorage.getItem(OTP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedOtpToken;
    if (
      parsed.phone === phone &&
      typeof parsed.token === 'string' &&
      typeof parsed.exp === 'number' &&
      parsed.exp * 1000 > Date.now() + 60_000
    ) {
      return parsed.token;
    }
    return null;
  } catch {
    return null;
  }
}

function saveOtpToken(entry: SavedOtpToken) {
  try {
    localStorage.setItem(OTP_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore storage errors */
  }
}

function clearSavedOtpToken() {
  try {
    localStorage.removeItem(OTP_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function normalizeUsDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function formatUsPhone(raw: string): string {
  const d = normalizeUsDigits(raw);
  if (!d) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function toE164Us(raw: string): string {
  const d = normalizeUsDigits(raw);
  return d.length === 10 ? `+1${d}` : '';
}

function isCoinbaseOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'coinbase.com' || host.endsWith('.coinbase.com');
  } catch {
    return false;
  }
}

interface PingOnrampTabProps {
  hasIntentAccount: boolean;
  onrampAddress: string;
  isDeriving: boolean;
  error: string | null;
  oneClickPrepare?: Record<string, any> | null;
  isUnlockingPasskey?: boolean;
  onUnlockWithPasskey?: () => void;
  status: DepositStatusResponse | null;
  settled: boolean;
  onRefresh: () => void;
  onRetryAccountCheck: () => void;
}

/**
 * Native in-app Apple Pay / Google Pay checkout locked to USDC on NEAR:
 *  - Only APPLE_PAY and GOOGLE_PAY (no Coinbase account, no Cash App, no Crypto, no Sell/Pay tabs)
 *  - Destination fixed to USDC on NEAR (no user-controlled token picker)
 *  - Pre-checks regional eligibility cleanly before showing the form
 */
export const PingOnrampTab: React.FC<PingOnrampTabProps> = ({
  hasIntentAccount,
  onrampAddress,
  isDeriving,
  error,
  oneClickPrepare,
  isUnlockingPasskey = false,
  onUnlockWithPasskey,
  status,
  settled,
  onRefresh,
  onRetryAccountCheck,
}) => {
  const { toast } = useToast();

  const [config, setConfig] = useState<PingPayConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [amount, setAmount] = useState('25');
  const [method, setMethod] = useState<FiatPaymentMethod | null>(null);
  const [quote, setQuote] = useState<PingPayQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [step, setStep] = useState<CheckoutStep>('form');
  const [email, setEmail] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpResendIn, setOtpResendIn] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'authorizing'>('loading');

  const [showAddressDetails, setShowAddressDetails] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetchPingPayConfig('USD');
      setConfig(res);
      const candidates = METHOD_PRIORITY.filter((m) =>
        res.availablePaymentMethods.includes(m)
      );
      setMethod((prev) => (prev && candidates.includes(prev) ? prev : candidates[0] || null));
    } catch (err: any) {
      setConfigError(err?.message || 'Could not load payment methods right now.');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasIntentAccount && onrampAddress && !config && !configLoading && !configError) {
      loadConfig();
    }
  }, [hasIntentAccount, onrampAddress, config, configLoading, configError, loadConfig]);

  const orderedMethods = useMemo(() => {
    if (!config?.availablePaymentMethods) return [];
    return METHOD_PRIORITY.filter((m) => config.availablePaymentMethods.includes(m));
  }, [config]);

  const activeCurrency = config?.defaultCurrency || 'USD';
  const limits = method ? config?.limitsByMethod?.[method] : undefined;

  const parsedAmount = parseFloat(amount);
  const minLimit = limits ? parseFloat(limits.min) : 1;
  const maxLimit = limits ? parseFloat(limits.max) : 2500;
  const amountValidationError = useMemo(() => {
    if (!amount.trim()) return null;
    if (isNaN(parsedAmount) || parsedAmount <= 0) return 'Enter a valid USD amount.';
    if (parsedAmount < minLimit) return `Minimum is $${minLimit}.`;
    if (parsedAmount > maxLimit) return `Maximum is $${maxLimit.toLocaleString()}.`;
    return null;
  }, [amount, parsedAmount, minLimit, maxLimit]);

  // Debounced live quote locked to USDC on NEAR
  useEffect(() => {
    if (
      !config?.fiatAvailable ||
      !method ||
      !amount.trim() ||
      amountValidationError ||
      step !== 'form'
    ) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetchPingPayQuote({
          amount: amount.trim(),
          paymentMethod: method,
          sourceCurrency: activeCurrency,
        });
        if (!cancelled) {
          setQuote(res);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err?.message || 'Rate unavailable for this amount right now.');
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [config?.fiatAvailable, method, amount, amountValidationError, activeCurrency, step]);

  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = window.setTimeout(() => setOtpResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [otpResendIn]);

  useEffect(() => {
    if (step !== 'checkout' || !checkoutUrl) return;
    const onMessage = (ev: MessageEvent) => {
      if (!isCoinbaseOrigin(ev.origin)) return;
      let payload: any = ev.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== 'object') return;
      switch (payload.eventName) {
        case 'onramp_api.load_success':
          setFrameState('ready');
          break;
        case 'onramp_api.commit_success':
          setFrameState('authorizing');
          break;
        case 'onramp_api.load_error':
        case 'onramp_api.commit_error':
        case 'onramp_api.polling_error':
          setStepError(payload?.data?.errorMessage || 'Payment could not be completed. Try again.');
          setStep('form');
          break;
        case 'onramp_api.cancel':
          setStep('form');
          break;
        case 'onramp_api.polling_success':
          setFrameState('ready');
          toast('Payment submitted — confirming in your balance…');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [step, checkoutUrl, toast]);

  const handleStartFresh = () => {
    setStep('form');
    setStepError(null);
    setCheckoutUrl('');
    setOtpCode('');
    setQuote(null);
    setQuoteError(null);
    onRefresh();
    loadConfig();
  };

  const handleCopyAddress = async () => {
    if (!onrampAddress) return;
    try {
      await navigator.clipboard.writeText(onrampAddress);
      setCopiedAddress(true);
      toast('Address copied');
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      toast('Could not copy address', 'error');
    }
  };

  const handleContinueFromForm = () => {
    if (!method || !onrampAddress || !quote || submitting) return;
    setStepError(null);
    setStep('verify');
  };

  const submitHeadlessOrder = async (e164Phone: string, token?: string) => {
    if (!method || !onrampAddress) return;
    const res = await createPingPayHeadlessOrder({
      amount: amount.trim(),
      paymentMethod: method,
      recipientAddress: onrampAddress,
      selectedCurrency: activeCurrency,
      email: email.trim(),
      phone: e164Phone,
      verificationToken: token,
    });
    setCheckoutUrl(res.paymentLinkUrl);
    setFrameState('loading');
    setStep('checkout');
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = toE164Us(phoneInput);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStepError('Enter a valid email address.');
      return;
    }
    if (!e164) {
      setStepError('Enter a valid 10-digit US mobile number.');
      return;
    }

    setStepError(null);
    setSubmitting(true);
    try {
      const savedToken = loadSavedOtpToken(e164);
      if (savedToken) {
        try {
          await submitHeadlessOrder(e164, savedToken);
          return;
        } catch (err: any) {
          if (err instanceof PingPayApiError && err.status === 403) {
            clearSavedOtpToken();
          } else {
            throw err;
          }
        }
      }
      await startPingPayOtp(e164);
      setOtpResendIn(30);
      setOtpCode('');
      setStep('otp');
    } catch (err: any) {
      setStepError(err?.message || "Couldn't send the verification code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = toE164Us(phoneInput);
    const cleanCode = otpCode.replace(/\D/g, '');
    if (cleanCode.length !== 6 || !e164) return;

    setStepError(null);
    setSubmitting(true);
    try {
      const verified = await checkPingPayOtp(e164, cleanCode);
      saveOtpToken({ phone: e164, token: verified.token, exp: verified.exp });
      await submitHeadlessOrder(e164, verified.token);
    } catch (err: any) {
      setStepError(err?.message || 'Verification failed. Please check the code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    const e164 = toE164Us(phoneInput);
    if (!e164 || otpResendIn > 0) return;
    setStepError(null);
    try {
      await startPingPayOtp(e164);
      setOtpResendIn(30);
    } catch (err: any) {
      setStepError(err?.message || "Couldn't resend the code.");
    }
  };

  const receiveFormatted = useMemo(() => {
    if (!quote?.estimatedReceiveAmount) return null;
    const num = parseFloat(quote.estimatedReceiveAmount);
    if (isNaN(num)) return quote.estimatedReceiveAmount;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [quote]);

  const isIncoming =
    !settled &&
    (status?.status === 'PROCESSING' ||
      status?.status === 'KNOWN_DEPOSIT_TX' ||
      parseFloat(status?.depositedAmountFormatted || '0') > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start animate-fade-in">
      {/* ── LEFT COLUMN: APPLE PAY / GOOGLE PAY CHECKOUT (7 Cols) ── */}
      <div className="lg:col-span-7 space-y-3 sm:space-y-4">
        {(settled || isIncoming) && (
          <div
            className={`lg:hidden p-4 rounded-2xl border flex items-center justify-between gap-3 ${
              settled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/50 text-blue-950 dark:text-blue-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {settled ? (
                <CheckCircle weight="fill" className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              ) : (
                <CircleNotch
                  weight="bold"
                  className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400 flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">
                  {settled
                    ? `Added ${status?.depositedAmountFormatted || ''} USDC`
                    : 'Payment on the way…'}
                </p>
                <p className="text-[11px] opacity-80 truncate">
                  {settled
                    ? 'Ready to spend in your UPRAIL balance.'
                    : 'Updating your balance in a moment.'}
                </p>
              </div>
            </div>
            {settled && (
              <Link
                to="/app"
                className="px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold font-mono flex-shrink-0"
              >
                Home
              </Link>
            )}
          </div>
        )}

        <div className="rounded-2xl sm:rounded-3xl bg-white border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-stone-100">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <h2 className="text-lg sm:text-2xl font-display font-extrabold text-stone-950">
                  Add money right here
                </h2>
                <p className="text-xs sm:text-sm text-stone-600 font-sans leading-relaxed">
                  Pay with Apple Pay or Google Pay — arrives as USDC in UPRAIL.
                </p>
              </div>

              {hasIntentAccount && (
                <button
                  type="button"
                  onClick={handleStartFresh}
                  disabled={isDeriving || isUnlockingPasskey || configLoading}
                  className="min-h-[32px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-800 text-[11px] sm:text-xs font-mono font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 flex-shrink-0"
                  title="Reload checkout and refresh address"
                >
                  <ArrowsClockwise
                    weight="bold"
                    className={`w-3.5 h-3.5 ${isDeriving || configLoading ? 'animate-spin' : ''}`}
                  />
                  <span>Start fresh</span>
                </button>
              )}
            </div>
          </div>

          {!hasIntentAccount ? (
            <div className="py-16 sm:py-20 px-5 flex flex-col items-center justify-center text-center space-y-3 font-mono text-xs text-stone-500">
              <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
              <span className="font-bold text-stone-800">Finishing your UPRAIL account setup…</span>
              <span className="max-w-xs text-stone-400 font-sans leading-relaxed">
                Apple Pay &amp; Google Pay top-ups unlock in a few seconds right after your first sign-in.
              </span>
              <button
                type="button"
                onClick={onRetryAccountCheck}
                className="mt-1 px-4 py-2 rounded-xl bg-black text-white text-xs font-bold hover:bg-stone-800 transition-colors cursor-pointer"
              >
                Check again
              </button>
            </div>
          ) : oneClickPrepare && !onrampAddress ? (
            <div className="py-14 sm:py-20 px-5 flex flex-col items-center justify-center text-center space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900">
                <Fingerprint weight="bold" className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-xs">
                <p className="text-sm sm:text-base font-display font-bold text-stone-900">
                  Turn on instant top-ups
                </p>
                <p className="text-xs text-stone-500 font-sans leading-relaxed">
                  Confirm once with Face ID or your passkey so we can prepare your private USDC receiving address.
                </p>
              </div>
              <button
                type="button"
                onClick={onUnlockWithPasskey}
                disabled={isUnlockingPasskey}
                className="px-5 py-2.5 rounded-xl bg-black text-white text-xs font-mono font-bold hover:bg-stone-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isUnlockingPasskey ? (
                  <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                ) : (
                  <Fingerprint weight="bold" className="w-4 h-4" />
                )}
                <span>{isUnlockingPasskey ? 'Checking passkey…' : 'Continue with Passkey'}</span>
              </button>
            </div>
          ) : (isDeriving && !onrampAddress) || (configLoading && !config) ? (
            <div className="py-16 sm:py-20 px-5 flex flex-col items-center justify-center text-center space-y-3 font-mono text-xs text-stone-500">
              <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
              <span>Preparing Apple Pay &amp; Google Pay…</span>
            </div>
          ) : (error && !onrampAddress) || configError ? (
            <div className="py-16 sm:py-20 px-5 flex flex-col items-center justify-center text-center space-y-3">
              <Warning weight="fill" className="w-8 h-8 text-amber-600" />
              <p className="text-sm font-display font-bold text-stone-900">
                Couldn&apos;t load top-up right now
              </p>
              <p className="text-xs text-stone-500 font-sans max-w-xs leading-relaxed">
                {error || configError}
              </p>
              <button
                type="button"
                onClick={handleStartFresh}
                className="px-4 py-2 rounded-xl bg-black text-white text-xs font-mono font-bold hover:bg-stone-800 transition-colors cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : config && !config.fiatAvailable ? (
            <div className="py-14 sm:py-16 px-5 sm:px-8 flex flex-col items-center justify-center text-center space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-700">
                <Globe weight="duotone" className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <p className="text-sm sm:text-base font-display font-bold text-stone-950">
                  Apple Pay &amp; Google Pay aren&apos;t available in your region
                </p>
                <p className="text-xs text-stone-600 font-sans leading-relaxed">
                  PingPay currently restricts Apple Pay and Google Pay top-ups to supported US iOS/Android devices with a +1 phone number{config.userCountry ? ` (your region: ${config.userCountry})` : ''}. You can still add funds anytime using the Deposit or NEAR &amp; memes tabs.
                </p>
              </div>
              <button
                type="button"
                onClick={loadConfig}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-900 text-xs font-mono font-bold transition-colors cursor-pointer"
              >
                Check again
              </button>
            </div>
          ) : step === 'checkout' && checkoutUrl ? (
            <div className="relative bg-white w-full">
              <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="text-xs font-mono font-bold text-stone-600 hover:text-black flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft weight="bold" className="w-3.5 h-3.5" />
                  <span>Change amount or method</span>
                </button>
                <span className="text-[11px] font-mono text-stone-500">
                  ${amount} → USDC
                </span>
              </div>
              <div className="relative bg-[#0b0b0e] w-full overflow-hidden">
                {frameState !== 'ready' && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0b0b0e]/95 text-stone-300 font-mono text-xs">
                    <CircleNotch weight="bold" className="w-7 h-7 animate-spin text-white" />
                    <span>
                      {frameState === 'authorizing'
                        ? 'Authorizing payment…'
                        : 'Loading payment sheet…'}
                    </span>
                  </div>
                )}
                <iframe
                  src={checkoutUrl}
                  title="Complete Apple Pay or Google Pay top-up in UPRAIL"
                  allow="payment *; clipboard-write; web-share"
                  referrerPolicy="no-referrer"
                  onLoad={() => setFrameState((prev) => (prev === 'authorizing' ? prev : 'ready'))}
                  className="w-full min-h-[540px] h-[min(640px,76dvh)] sm:h-[680px] border-0 block bg-white"
                />
              </div>
            </div>
          ) : step === 'verify' ? (
            <form onSubmit={handleVerifySubmit} className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setStepError(null);
                    setStep('form');
                  }}
                  className="text-xs font-mono font-bold text-stone-600 hover:text-black flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft weight="bold" className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <span className="text-xs font-mono font-bold text-stone-900">
                  ${amount} → ~{receiveFormatted || amount} USDC
                </span>
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-display font-bold text-stone-950">
                  Verify your contact details
                </h3>
                <p className="text-xs text-stone-600 font-sans leading-relaxed">
                  Required once for {method ? METHOD_META[method]?.label : 'express pay'} before completing your top-up.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="pingpay-email" className="block text-[11px] font-mono font-bold uppercase text-stone-600 mb-1">
                    Email
                  </label>
                  <input
                    id="pingpay-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-50 border border-stone-200 text-sm text-stone-950 font-sans focus:outline-none focus:border-black"
                  />
                </div>
                <div>
                  <label htmlFor="pingpay-phone" className="block text-[11px] font-mono font-bold uppercase text-stone-600 mb-1">
                    US Mobile Number
                  </label>
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-50 border border-stone-200 focus-within:border-black">
                    <span className="text-sm font-mono font-bold text-stone-700">+1</span>
                    <input
                      id="pingpay-phone"
                      type="tel"
                      inputMode="tel"
                      required
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(formatUsPhone(e.target.value))}
                      placeholder="(555) 123-4567"
                      className="w-full bg-transparent text-sm text-stone-950 font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {stepError && <p className="text-xs text-red-600 font-sans">{stepError}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs sm:text-sm font-display font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {submitting && <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />}
                <span>{submitting ? 'Continuing…' : `Continue to ${method ? METHOD_META[method]?.label : 'Pay'}`}</span>
              </button>
            </form>
          ) : step === 'otp' ? (
            <form onSubmit={handleOtpSubmit} className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setStepError(null);
                    setStep('verify');
                  }}
                  className="text-xs font-mono font-bold text-stone-600 hover:text-black flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft weight="bold" className="w-3.5 h-3.5" />
                  <span>Edit number</span>
                </button>
                <span className="text-xs font-mono text-stone-500">+1 {phoneInput}</span>
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-display font-bold text-stone-950 flex items-center gap-2">
                  <DeviceMobile weight="bold" className="w-4 h-4" />
                  <span>Enter 6-digit SMS code</span>
                </h3>
                <p className="text-xs text-stone-600 font-sans">
                  We sent a quick verification code to your phone. Valid for 60 days.
                </p>
              </div>

              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-center font-mono text-xl tracking-[0.35em] font-bold text-stone-950 focus:outline-none focus:border-black"
              />

              {stepError && <p className="text-xs text-red-600 font-sans">{stepError}</p>}

              <div className="flex items-center justify-between text-xs font-sans text-stone-500">
                {otpResendIn > 0 ? (
                  <span>Resend code in {otpResendIn}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="underline text-stone-800 hover:text-black cursor-pointer"
                  >
                    Resend code
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || otpCode.replace(/\D/g, '').length !== 6}
                className="w-full py-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs sm:text-sm font-display font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting && <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />}
                <span>{submitting ? 'Verifying…' : 'Verify & Pay'}</span>
              </button>
            </form>
          ) : (
            <div className="p-4 sm:p-6 space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="onramp-usd-amount" className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
                    You pay
                  </label>
                  <span className="text-[11px] font-mono text-stone-500">{activeCurrency}</span>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-stone-50 border border-stone-200 focus-within:border-black flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                    <span className="text-2xl sm:text-3xl font-display font-extrabold text-stone-400">
                      $
                    </span>
                    <input
                      id="onramp-usd-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        if ((val.match(/\./g) || []).length <= 1) setAmount(val);
                      }}
                      placeholder="25"
                      className="w-full bg-transparent text-2xl sm:text-3xl font-display font-extrabold text-stone-950 focus:outline-none"
                    />
                  </div>
                  <span className="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-mono font-bold text-stone-800 flex-shrink-0">
                    {activeCurrency}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_AMOUNTS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(preset)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition-colors cursor-pointer ${
                        amount === preset
                          ? 'bg-black text-white border-black'
                          : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                      }`}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>
                {amountValidationError && (
                  <p className="text-xs text-red-600 font-sans">{amountValidationError}</p>
                )}
              </div>

              {orderedMethods.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
                    Pay with
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {orderedMethods.map((m) => {
                      const active = method === m;
                      const meta = METHOD_META[m];
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMethod(m)}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'bg-black text-white border-black shadow-xs'
                              : 'bg-stone-50 hover:bg-stone-100 text-stone-900 border-stone-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs sm:text-sm font-display font-bold truncate">
                              {meta.label}
                            </span>
                            <CreditCard weight={active ? 'fill' : 'regular'} className="w-3.5 h-3.5 flex-shrink-0 opacity-80" />
                          </div>
                          <p className={`text-[10px] font-mono mt-0.5 truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                            {meta.badge}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3.5 sm:p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
                    You get
                  </span>
                  <div className="flex items-center gap-2">
                    <TokenIcon symbol="USDC" size="sm" />
                    <span className="text-base sm:text-lg font-display font-extrabold text-stone-950">
                      {quoteLoading ? (
                        <span className="text-stone-400 font-mono text-sm">Calculating…</span>
                      ) : receiveFormatted ? (
                        `~${receiveFormatted} USDC`
                      ) : (
                        'USDC'
                      )}
                    </span>
                  </div>
                </div>

                {quote && (
                  <div className="pt-2 border-t border-stone-200/70 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-stone-500">
                    <span>
                      1 USD ≈{' '}
                      {parsedAmount > 0 && quote.estimatedReceiveAmount
                        ? (parseFloat(quote.estimatedReceiveAmount) / parsedAmount).toFixed(3)
                        : '—'}{' '}
                      USDC
                    </span>
                    {quote.fees?.totalFee && <span>Total fees: ${quote.fees.totalFee}</span>}
                  </div>
                )}

                {quoteError && <p className="text-xs text-amber-700 font-sans">{quoteError}</p>}
              </div>

              {stepError && <p className="text-xs text-red-600 font-sans">{stepError}</p>}

              <button
                type="button"
                onClick={handleContinueFromForm}
                disabled={
                  !method ||
                  !onrampAddress ||
                  Boolean(amountValidationError) ||
                  quoteLoading ||
                  !quote ||
                  submitting
                }
                className="w-full py-3.5 rounded-2xl bg-black hover:bg-stone-800 text-white text-sm font-display font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting && <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />}
                <span>
                  {submitting
                    ? 'Preparing checkout…'
                    : method
                    ? `Pay $${amount || '0'} with ${METHOD_META[method].label}`
                    : 'Add money'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT COLUMN: LIVE ARRIVAL WATCHER & PLAIN GUIDE (5 Cols) ── */}
      <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
        <div className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2.5 border-b border-stone-100 gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-stone-800">
              Balance Status
            </span>
            <Badge tone="ok">{settled ? 'Added' : isIncoming ? 'Incoming' : 'Ready'}</Badge>
          </div>

          {settled ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2.5 animate-fade-in">
              <div className="flex items-center space-x-2 font-bold text-emerald-900 text-xs">
                <CheckCircle weight="fill" className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>Money added to your account!</span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed font-sans">
                Your funds arrived and are ready to send or spend in UPRAIL.
              </p>
              {status?.depositedAmountFormatted && (
                <div className="p-2.5 bg-white/80 rounded-xl border border-emerald-200 flex items-center justify-between font-mono text-xs">
                  <span className="text-stone-500">Added:</span>
                  <span className="font-bold text-emerald-900">
                    +{status.depositedAmountFormatted} USDC
                    {status.depositedAmountUsd ? ` (~$${status.depositedAmountUsd})` : ''}
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-2 pt-1">
                <Link
                  to="/app"
                  className="px-3.5 py-2 rounded-xl bg-black text-white text-xs font-bold font-mono hover:bg-stone-800 transition-colors"
                >
                  Back to Home
                </Link>
                <button
                  type="button"
                  onClick={handleStartFresh}
                  className="px-3.5 py-2 rounded-xl bg-white border border-stone-200 text-stone-900 text-xs font-bold font-mono hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  Add more
                </button>
              </div>
            </div>
          ) : isIncoming ? (
            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50 text-blue-950 dark:text-blue-200 space-y-2 animate-fade-in">
              <div className="flex items-center space-x-2 text-xs font-bold text-blue-900 dark:text-blue-100">
                <CircleNotch weight="bold" className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <span>On its way to your balance…</span>
              </div>
              <p className="text-xs text-blue-800 dark:text-blue-200/90 leading-relaxed font-sans">
                We see your payment coming in. Hang tight — your UPRAIL balance updates automatically in a moment.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex items-start space-x-3">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping flex-shrink-0 mt-1" />
              <div className="font-sans text-xs text-stone-600 space-y-1">
                <p className="font-semibold text-stone-900">Waiting for your purchase</p>
                <p className="leading-relaxed">
                  Finish checkout right on this page. Added USDC usually arrives in 1–3 minutes.
                </p>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-stone-100 space-y-3">
            <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-500">
              How it works
            </h3>
            <ol className="space-y-2.5 text-xs font-sans text-stone-600">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-stone-100 border border-stone-200 text-stone-900 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  <strong className="text-stone-900">Enter an amount</strong> in USD.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-stone-100 border border-stone-200 text-stone-900 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  <strong className="text-stone-900">Pick Apple Pay or Google Pay</strong> (supported on US iOS and Android devices).
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-stone-100 border border-stone-200 text-stone-900 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  <strong className="text-stone-900">Done — arrives as USDC</strong> directly inside your UPRAIL balance.
                </span>
              </li>
            </ol>
          </div>

          {onrampAddress && (
            <div className="pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setShowAddressDetails((v) => !v)}
                className="w-full flex items-center justify-between text-[11px] font-mono text-stone-500 hover:text-stone-900 py-1 cursor-pointer"
              >
                <span>Pre-filled USDC receiving address</span>
                <CaretDown
                  weight="bold"
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    showAddressDetails ? 'rotate-180 text-stone-900' : ''
                  }`}
                />
              </button>
              {showAddressDetails && (
                <div className="mt-2 p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2 animate-fade-in">
                  <p className="text-[11px] font-sans text-stone-500 leading-relaxed">
                    Locked to your UPRAIL account so purchased USDC arrives directly in your balance.
                  </p>
                  <div className="p-2.5 rounded-lg bg-white border border-stone-200 font-mono text-[11px] text-stone-800 break-all select-all">
                    {onrampAddress}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="w-full py-2 px-3 rounded-lg bg-black hover:bg-stone-800 text-white text-[11px] font-mono font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedAddress ? (
                      <>
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy weight="fill" className="w-3.5 h-3.5" />
                        <span>Copy Address</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
