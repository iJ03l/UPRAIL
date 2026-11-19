'use client';

import React, { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  Users,
  Sparkle,
  ArrowSquareOut,
  ShieldCheck,
  UserCheck,
} from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { api, SHARE_CARD_VERSION } from '../lib/api';
import { useToast } from './Toast';
import { getInviteClaimSummary } from '../lib/invite';
import { MyInviteResponse } from '../types';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  userHandle?: string;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
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
    const link = `${origin}/login?invite=${inviteData.inviteCode}&v=${SHARE_CARD_VERSION}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    toast('Invite link copied');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-lg"
      panelClassName="px-6 sm:p-7 pt-2 sm:pt-7 pb-6 space-y-6 select-none"
      showCloseButton
      closeLabel="Close invite modal"
      ariaLabel="Your Ref Code"
    >
      {/* Modal Header */}
      <div className="flex items-center space-x-3 pr-11">
        <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-xs flex-shrink-0">
          <Users weight="fill" className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl font-black font-display text-stone-950 tracking-tight flex items-center flex-wrap gap-2">
            <span>Your Ref Code</span>
            <Badge tone="neutral">Reusable</Badge>
          </h3>
          <p className="text-xs text-stone-500 font-mono">
            Share your 6-letter referral code with anyone joining UPRAIL.
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
      {!isLoading && inviteData && (() => {
        const { claims, useCount } = getInviteClaimSummary(inviteData);

        return (
          <div className="space-y-5">
            {/* Reusable Personal Ref Code Card */}
            <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-500">
                  Personal Ref Code
                </span>
                {inviteData.status === 'ACTIVE' ? (
                  <Badge tone="ok" icon={<Sparkle weight="fill" className="w-3 h-3" />}>
                    {useCount > 0 ? `Active · ${useCount} used` : 'Active · Unlimited'}
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon={<UserCheck weight="fill" className="w-3 h-3" />}>
                    Inactive
                  </Badge>
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
                    className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-800 text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5 min-h-11"
                    title="Copy code"
                  >
                    {copiedCode ? <Check weight="bold" className="w-4 h-4" /> : <Copy weight="fill" className="w-4 h-4" />}
                    <span className="hidden sm:inline">{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="p-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs min-h-11"
                    title="Copy direct invite link"
                  >
                    {copiedLink ? <Check weight="bold" className="w-4 h-4" /> : <ArrowSquareOut weight="fill" className="w-4 h-4" />}
                    <span className="hidden sm:inline">{copiedLink ? 'Link Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>

              {/* Claimed history */}
              {claims.length > 0 ? (
                <div className="p-3 rounded-xl bg-white border border-stone-200 text-xs text-stone-700 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center space-x-2 font-semibold text-stone-900">
                      <ShieldCheck weight="fill" className="w-4 h-4 flex-shrink-0" />
                      <span>Joined with your code ({useCount})</span>
                    </span>
                    <span className="text-[11px] font-mono text-stone-500">Code stays active</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {claims.map((claim) => (
                      <span
                        key={`${claim.handle}-${claim.claimedAt}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-mono font-bold text-stone-900"
                        title={`Joined ${new Date(claim.claimedAt).toLocaleDateString()}`}
                      >
                        @{claim.handle}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-stone-500 font-mono">
                  Anyone signing up can enter this 6-letter code to unlock access — it stays active after every use.
                </p>
              )}
            </div>
          </div>
        );
      })()}
    </ModalSheet>
  );
};
