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
  UserCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';
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
  const { toast } = useToast();

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
    toast('Invite code copied');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    if (!inviteData?.inviteCode) return;
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://app.uprail.world';
    const link = `${origin}/login?invite=${inviteData.inviteCode}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    toast('Invite link copied');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md animate-fade-in select-none">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-lg bg-white border border-stone-200 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
          aria-label="Close modal"
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
              <span>Your Ref Code</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200">
                1 Allotted
              </span>
            </h3>
            <p className="text-xs text-stone-500 font-mono">
              Share your 6-letter referral code to grant access to a peer.
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
            {/* 1 Personal Ref Code Card */}
            <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-500">
                  Personal Ref Code
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
                    Claimed by <span className="font-mono font-bold text-stone-900">@{inviteData.claimedBy.handle}</span> on {new Date(inviteData.claimedBy.claimedAt).toLocaleDateString()}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-stone-500 font-mono">
                  Your colleague will enter this 6-letter code during sign-up to unlock access.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
