'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, User, X, AlertCircle, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';

export interface ResolvedAccountInfo {
  handle: string;
  cleanHandle: string;
  resolved: boolean;
  exists: boolean;
  isRegistered: boolean;
  name?: string;
  avatarUrl?: string;
  nearAccount?: string | null;
  message?: string;
}

interface HandleInputProps {
  value: string;
  onChange: (val: string) => void;
  onResolved?: (account: ResolvedAccountInfo | null, isValid: boolean | null) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  mode?: 'send' | 'request';
  helperText?: string;
}

export const HandleInput: React.FC<HandleInputProps> = ({
  value,
  onChange,
  onResolved,
  disabled = false,
  placeholder = 'username',
  label,
  mode = 'send',
  helperText,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAccount, setResolvedAccount] = useState<ResolvedAccountInfo | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayLabel = label || (mode === 'request' ? 'Request From' : 'Recipient');

  // Clean raw handle input: handle pasted URLs (x.com/user, twitter.com/user), @ symbols, spaces
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    // Strip web prefix if pasted
    raw = raw.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '');
    const clean = raw.replace(/^@+/, '').replace(/\s+/g, '').toLowerCase().split(/[?#]/)[0];
    onChange(clean);
  };

  useEffect(() => {
    let clean = value.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@+/, '').replace(/\s+/g, '').toLowerCase().split(/[?#]/)[0];

    if (!clean) {
      setIsResolving(false);
      setResolvedAccount(null);
      setResolutionError(null);
      setImgLoaded(false);
      onResolved?.(null, null);
      return;
    }

    // Cancel previous request if still in flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Quick regex validation before hitting network
    const isValidFormat = /^[a-z0-9_]{1,15}$/.test(clean);
    if (!isValidFormat) {
      setIsResolving(false);
      setResolvedAccount(null);
      if (clean.length > 15) {
        setResolutionError('𝕏 handles cannot exceed 15 characters');
      } else {
        setResolutionError('Only letters, numbers, and underscores allowed');
      }
      onResolved?.(null, false);
      return;
    }

    setIsResolving(true);
    setResolutionError(null);
    setImgLoaded(false);

    const timer = setTimeout(async () => {
      try {
        const info = await api.resolveHandle(clean);
        setResolvedAccount(info);
        setResolutionError(null);
        onResolved?.(info, true);
      } catch (err: any) {
        setResolvedAccount(null);
        const errMsg = err?.message || `Account @${clean} does not exist on 𝕏`;
        setResolutionError(errMsg);
        onResolved?.(null, false);
      } finally {
        setIsResolving(false);
      }
    }, 450);

    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400">
          {displayLabel}
        </label>
        {isResolving ? (
          <span className="text-xs text-stone-500 flex items-center space-x-1.5 font-mono animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Verifying on 𝕏...</span>
          </span>
        ) : resolvedAccount ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center space-x-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{resolvedAccount.isRegistered ? 'UPRAIL Account' : 'Valid 𝕏 Account'}</span>
          </span>
        ) : resolutionError && !isFocused ? (
          <span className="text-xs text-red-500 dark:text-red-400 flex items-center space-x-1 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Not found</span>
          </span>
        ) : null}
      </div>

      {/* Input container */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={`relative flex items-center rounded-2xl bg-stone-50 dark:bg-stone-900 border transition-all duration-200 cursor-text ${
          isFocused
            ? 'border-stone-900 dark:border-stone-100 ring-1 ring-stone-900 dark:ring-stone-100 bg-white dark:bg-stone-950'
            : resolutionError && !isFocused
            ? 'border-red-300 dark:border-red-800 bg-red-50/20'
            : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {/* At Prefix */}
        <div className="pl-4 pr-1 text-stone-400 dark:text-stone-500 font-mono text-base font-normal flex items-center pointer-events-none select-none">
          @
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="w-full min-w-0 bg-transparent py-3.5 pr-10 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 font-normal text-base focus:outline-none"
        />

        {/* Clear or Status Indicator */}
        {value ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              inputRef.current?.focus();
            }}
            disabled={disabled}
            className="absolute right-3.5 p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="absolute right-3.5 text-stone-300 dark:text-stone-600 pointer-events-none">
            <User className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Account Verification & Avatar Card */}
      <AnimatePresence mode="wait">
        {resolvedAccount && !isResolving ? (
          <motion.div
            key={`resolved-${resolvedAccount.cleanHandle}`}
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="relative overflow-hidden rounded-2xl p-3 bg-gradient-to-r from-stone-50 to-stone-100/70 dark:from-stone-900/90 dark:to-stone-900/50 border border-stone-200 dark:border-stone-800 shadow-xs"
          >
            <div className="flex items-center space-x-3">
              {/* DP Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-stone-200 dark:bg-stone-800 border border-white dark:border-stone-700 shadow-xs flex items-center justify-center relative">
                  {resolvedAccount.avatarUrl ? (
                    <img
                      src={resolvedAccount.avatarUrl}
                      alt={`@${resolvedAccount.cleanHandle}`}
                      onLoad={() => setImgLoaded(true)}
                      className={`w-full h-full object-cover transition-opacity duration-200 ${
                        imgLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  {!imgLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-stone-800 text-white font-medium text-xs font-mono">
                      {resolvedAccount.cleanHandle.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Status indicator on avatar */}
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border border-white dark:border-stone-900 flex items-center justify-center text-[8px] ${
                    resolvedAccount.isRegistered
                      ? 'bg-emerald-500 text-white'
                      : 'bg-blue-500 text-white'
                  }`}
                  title={resolvedAccount.isRegistered ? 'UPRAIL Registered' : 'Verified 𝕏 Account'}
                >
                  {resolvedAccount.isRegistered ? (
                    <ShieldCheck className="w-2 h-2" />
                  ) : (
                    <Sparkles className="w-2 h-2" />
                  )}
                </div>
              </div>

              {/* Profile Details */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-1.5 truncate">
                  <span className="font-semibold text-xs sm:text-sm text-stone-900 dark:text-stone-100 truncate">
                    {resolvedAccount.name || resolvedAccount.cleanHandle}
                  </span>
                  {resolvedAccount.isRegistered && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                      REGISTERED
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1.5 text-[11px] text-stone-500 dark:text-stone-400 font-mono truncate">
                  <span>@{resolvedAccount.cleanHandle}</span>
                  <span>•</span>
                  <span className="truncate">
                    {mode === 'request'
                      ? (resolvedAccount.isRegistered ? 'Instant request notification' : 'Direct request via 𝕏')
                      : (resolvedAccount.isRegistered ? 'Instant vault transfer' : 'Held in escrow until claimed')}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : resolutionError && !isResolving ? (
          <motion.div
            key="error-banner"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="p-3 rounded-2xl bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-start space-x-2.5 shadow-xs"
          >
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 leading-snug">
              <span className="font-medium">{resolutionError}</span>
              <p className="text-[11px] text-red-600/80 dark:text-red-400/80 mt-0.5 font-sans">
                {mode === 'request'
                  ? 'Please check the spelling. Requests must be sent to a valid 𝕏 account.'
                  : 'Please check the spelling. Payments to non-existent accounts cannot be claimed.'}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!resolvedAccount && !resolutionError && (
        <p className="text-[11px] text-stone-500 dark:text-stone-400 font-sans">
          {helperText ||
            (mode === 'request'
              ? 'Enter the 𝕏 handle of the person you are requesting money from.'
              : 'Double-check the exact handle — transfers are non-reversible.')}
        </p>
      )}
    </div>
  );
};
