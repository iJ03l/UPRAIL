'use client';

import React from 'react';
import { Shield, ArrowRight, Loader2 } from 'lucide-react';
import { useXAuth } from '../hooks/useXAuth';

interface XAuthBannerProps {
  title?: string;
  description?: string;
  actionText?: string;
}

export const XAuthBanner: React.FC<XAuthBannerProps> = ({
  title = '𝕏 Authentication Required',
  description = 'Sign in with your 𝕏 account to activate your UPRAIL account, receive payments, and route them securely.',
  actionText = 'Connect with 𝕏',
}) => {
  const { login, isRedirecting } = useXAuth();

  return (
    <div className="rounded-3xl p-6 sm:p-7 bg-stone-900 text-white border border-stone-800 shadow-md space-y-4 animate-fade-in relative overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start sm:items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-white text-stone-950 flex items-center justify-center font-bold flex-shrink-0 text-base shadow-xs">
            <span className="font-display font-black">𝕏</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold font-display flex items-center space-x-2">
              <span>{title}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </h3>
            <p className="text-xs text-stone-300 max-w-xl leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => login()}
          disabled={isRedirecting}
          className="self-start sm:self-auto px-5 py-3 rounded-2xl bg-white hover:bg-stone-100 text-stone-950 font-display font-extrabold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-xs transition-all cursor-pointer whitespace-nowrap"
        >
          {isRedirecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <span>{actionText}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      <div className="flex items-center space-x-2 pt-2 border-t border-stone-800 text-[11px] font-mono text-stone-400">
        <Shield className="w-3.5 h-3.5 text-stone-400" />
        <span>Protected by your passkey · No crypto wallet needed</span>
      </div>
    </div>
  );
};
