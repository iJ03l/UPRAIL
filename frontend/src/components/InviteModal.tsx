'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Users,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Send,
  Clock,
  UserCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { MyInviteResponse } from '../types';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  userHandle?: string;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
  userHandle,
}) => {
  const [inviteData, setInviteData] = useState<MyInviteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    api
      .getMyInvite()
      .then((data) => {
        if (isMounted) setInviteData(data);
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Failed to fetch invite details');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    if (!inviteData?.inviteCode) return;
    navigator.clipboard.writeText(inviteData.inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    if (!inviteData?.inviteLink) return;
    navigator.clipboard.writeText(inviteData.inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in font-sans">
      <div className="relative w-full max-w-lg rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 overflow-hidden space-y-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
          aria-label="Close invite modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-xs">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black font-display text-stone-950 tracking-tight flex items-center gap-2">
              <span>Your Invite Code</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200">
                1 Allotted
              </span>
            </h3>
            <p className="text-xs text-stone-500 font-mono">
              Share access with a friend and see who claimed it.
            </p>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="p-8 text-center space-y-2 animate-pulse">
            <div className="h-6 w-36 bg-stone-200 rounded mx-auto" />
            <div className="h-4 w-48 bg-stone-100 rounded mx-auto" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Content */}
        {!isLoading && inviteData && (
          <div className="space-y-5">
            {/* 1 Personal Invite Card */}
            <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-500">
                  Personal Invite Code
                </span>
                {inviteData.status === 'ACTIVE' ? (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-900 text-white text-[10px] font-mono font-bold">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>1 Available</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-200 text-stone-700 text-[10px] font-mono font-bold">
                    <UserCheck className="w-2.5 h-2.5" />
                    <span>Claimed</span>
                  </span>
                )}
              </div>

              {/* Code Box */}
              <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-stone-200 shadow-xs">
                <span className="text-2xl sm:text-3xl font-mono font-black tracking-widest text-stone-950">
                  {inviteData.inviteCode}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-800 text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5"
                    title="Copy code"
                  >
                    {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span className="hidden sm:inline">{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="p-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs"
                    title="Copy direct invite link"
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                    <span className="hidden sm:inline">{copiedLink ? 'Link Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>

              {/* Claimed status detail */}
              {inviteData.status === 'USED' && inviteData.claimedBy ? (
                <div className="p-3 rounded-xl bg-white border border-stone-200 text-xs text-stone-700 flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-stone-900 flex-shrink-0" />
                  <div>
                    Used by <span className="font-mono font-bold text-stone-900">@{inviteData.claimedBy.handle}</span> on {new Date(inviteData.claimedBy.claimedAt).toLocaleDateString()}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-stone-500 font-mono">
                  Your friend will enter this 6-letter code during sign in to unlock access.
                </p>
              )}
            </div>

            {/* Preloaded Payment Invites Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-500">
                  Preloaded Payment Invites
                </span>
                <span className="text-[10px] text-stone-400 font-mono">
                  Generated via sends
                </span>
              </div>

              {inviteData.paymentInvites && inviteData.paymentInvites.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {inviteData.paymentInvites.map((pi) => (
                    <div
                      key={pi.code}
                      className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center space-x-2">
                        <Send className="w-3.5 h-3.5 text-stone-500" />
                        <span className="text-stone-700">Sent to @{pi.recipientHandle}</span>
                        <span className="font-bold text-stone-950 px-1.5 py-0.5 rounded bg-white border border-stone-200">
                          {pi.code}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          pi.status === 'USED'
                            ? 'bg-stone-200 text-stone-700'
                            : 'bg-stone-900 text-white'
                        }`}
                      >
                        {pi.status === 'USED' ? 'Claimed' : 'Active'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-500 text-center font-mono">
                  No payment invites yet. Sending money automatically generates a claim link with an invite code attached!
                </div>
              )}
            </div>

            {/* Protocol Rule Explanatory Banner */}
            <div className="p-3 rounded-2xl bg-stone-100 border border-stone-200 text-[11px] text-stone-600 space-y-1">
              <div className="font-bold text-stone-900 flex items-center space-x-1">
                <span>The UPRAIL Invite Rule</span>
              </div>
              <p>
                Every user gets exactly <strong>1 personal invite code</strong>. The only other way to onboard someone is by sending them confidential funds — their claim link automatically preloads an invite code so they can onboard immediately.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
