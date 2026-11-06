'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AtSign, CheckCircle2, User, X, AlertCircle, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
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
  onResolved?: (account: ResolvedAccountInfo | null, isValid: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
}

export const HandleInput: React.FC<HandleInputProps> = ({
  value,
  onChange,
  onResolved,
  disabled = false,
  placeholder = 'username',
  label = 'Recipient',
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAccount, setResolvedAccount] = useState<ResolvedAccountInfo | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean raw handle input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleaned = raw.replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
    onChange(cleaned);
  };

  useEffect(() => {
    const clean = value.replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();

    if (!clean) {
      setIsResolving(false);
      setResolvedAccount(null);
      setResolutionError(null);
      setImgLoaded(false);
      onResolved?.(null, false);
      return;
    }

    // Cancel previous request if still in flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (clean.length < 1) {
      setIsResolving(false);
      setResolvedAccount(null);
      setResolutionError(null);
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
    }, 320);

    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-stone-400">
          {label}
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
        ) : resolutionError ? (
          <span className="text-xs text-red-500 dark:text-red-400 flex items-center space-x-1 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Not found</span>
          </span>
        ) : null}
      </div>

      {/* Input container */}
      <div
        className={`relative flex items-center rounded-2xl bg-stone-50 dark:bg-stone-900 border transition-all duration-200 ${
          isFocused
            ? 'border-stone-900 dark:border-stone-100 ring-1 ring-stone-900 dark:ring-stone-100 bg-white dark:bg-stone-950'
            : resolutionError
            ? 'border-red-300 dark:border-red-800 bg-red-50/20'
            : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {/* At Prefix */}
        <div className="pl-4 pr-1 text-stone-500 dark:text-stone-400 font-mono font-bold flex items-center pointer-events-none select-none">
          <AtSign className="w-5 h-5" />
        </div>

        {/* Input */}
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-transparent py-3.5 pr-10 text-stone-900 dark:text-stone-100 placeholder-stone-400 font-medium text-base focus:outline-none"
        />

        {/* Clear or Status Indicator */}
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="absolute right-3.5 p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="absolute right-3.5 text-stone-400 pointer-events-none">
            <User className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Cool DP & Account Animation Card */}
      <AnimatePresence mode="wait">
        {resolvedAccount && !isResolving ? (
          <motion.div
            key={`resolved-${resolvedAccount.cleanHandle}`}
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 4 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="relative overflow-hidden rounded-2xl p-3.5 bg-gradient-to-r from-stone-50 to-stone-100/70 dark:from-stone-900/90 dark:to-stone-900/50 border border-stone-200 dark:border-stone-800 shadow-xs"
          >
            <div className="flex items-center space-x-3.5">
              {/* DP Avatar with animated ring and pulse */}
              <div className="relative flex-shrink-0">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.05, duration: 0.2 }}
                  className="w-12 h-12 rounded-full overflow-hidden bg-stone-200 dark:bg-stone-800 border-2 border-white dark:border-stone-700 shadow-xs flex items-center justify-center relative"
                >
                  {resolvedAccount.avatarUrl ? (
                    <img
                      src={resolvedAccount.avatarUrl}
                      alt={`@${resolvedAccount.cleanHandle}`}
                      onLoad={() => setImgLoaded(true)}
                      className={`w-full h-full object-cover transition-opacity duration-200 ${
                        imgLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      onError={(e) => {
                        // Fallback on image load error
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  {!imgLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-stone-800 text-white font-bold text-sm font-mono">
                      {resolvedAccount.cleanHandle.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </motion.div>

                {/* Status indicator on avatar */}
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white dark:border-stone-900 flex items-center justify-center text-[9px] ${
                    resolvedAccount.isRegistered
                      ? 'bg-emerald-500 text-white'
                      : 'bg-blue-500 text-white'
                  }`}
                  title={resolvedAccount.isRegistered ? 'UPRAIL Registered' : 'Verified 𝕏 Account'}
                >
                  {resolvedAccount.isRegistered ? (
                    <ShieldCheck className="w-2.5 h-2.5" />
                  ) : (
                    <Sparkles className="w-2.5 h-2.5" />
                  )}
                </div>
              </div>

              {/* Profile Details */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-1.5 truncate">
                  <span className="font-bold text-sm text-stone-900 dark:text-stone-100 truncate">
                    {resolvedAccount.name || resolvedAccount.cleanHandle}
                  </span>
                  {resolvedAccount.isRegistered && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800">
                      REGISTERED
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-xs text-stone-500 dark:text-stone-400 font-mono">
                  <span>@{resolvedAccount.cleanHandle}</span>
                  <span>•</span>
                  <span className="text-[11px] truncate">
                    {resolvedAccount.isRegistered
                      ? 'Instant vault transfer'
                      : 'Held in escrow until claimed'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : resolutionError && !isResolving ? (
          <motion.div
            key="error-banner"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, x: [0, -4, 4, -2, 2, 0] }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center space-x-2.5 shadow-xs"
          >
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div className="min-w-0 flex-1 leading-snug">
              <span className="font-medium">{resolutionError}</span>
              <p className="text-[11px] text-red-500/80 mt-0.5 font-sans">
                Please check the spelling. Payments to non-existent accounts cannot be claimed.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!resolvedAccount && !resolutionError && (
        <p className="text-[11px] text-stone-500 dark:text-stone-400 font-sans">
          Double-check the exact handle — transfers are non-reversible.
        </p>
      )}
    </div>
  );
};
