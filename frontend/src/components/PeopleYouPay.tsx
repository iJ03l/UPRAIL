'use client';

import React, { useEffect, useState } from 'react';
import { User, PushPin, ArrowUpRight, ArrowDownLeft, Clock, Plus, Check, Trash } from '@phosphor-icons/react';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { api } from '../lib/api';
import type { Contact } from '../types';

interface PeopleYouPayProps {
  onSelectRecipient?: (handle: string, asset?: string, amount?: string) => void;
  onRequestMoney?: (handle: string, asset?: string) => void;
  className?: string;
}

function formatTimeAgo(timestamp?: number | null): string {
  if (!timestamp) return 'Never';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export const PeopleYouPay: React.FC<PeopleYouPayProps> = ({
  onSelectRecipient,
  onRequestMoney,
  className = '',
}) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContacts = async () => {
    try {
      setIsLoading(true);
      const data = await api.getContacts();
      setContacts(data);
    } catch (err) {
      console.warn('Failed to load contacts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleTogglePin = async (contact: Contact) => {
    try {
      const newPin = contact.is_pinned === 1 ? false : true;
      await api.saveContact(contact.contact_handle, { is_pinned: newPin });
      setContacts((prev) =>
        prev.map((c) =>
          c.contact_handle.toLowerCase() === contact.contact_handle.toLowerCase()
            ? { ...c, is_pinned: newPin ? 1 : 0 }
            : c
        )
      );
    } catch (err) {
      console.warn('Could not toggle pin:', err);
    }
  };

  const handleDelete = async (contact: Contact) => {
    try {
      await api.deleteContact(contact.contact_handle);
      setContacts((prev) =>
        prev.filter((c) => c.contact_handle.toLowerCase() !== contact.contact_handle.toLowerCase())
      );
    } catch (err) {
      console.warn('Could not delete contact:', err);
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newHandle.trim().replace(/^@+/, '');
    if (!clean) return;
    try {
      setIsSaving(true);
      setError(null);
      await api.saveContact(clean, {
        nickname: newNickname.trim() || undefined,
        is_pinned: true,
      });
      setShowAddModal(false);
      setNewHandle('');
      setNewNickname('');
      fetchContacts();
    } catch (err: any) {
      setError(err?.message || 'Failed to save contact');
    } finally {
      setIsSaving(false);
    }
  };

  const addContactSheet = (
    <ModalSheet
      isOpen={showAddModal}
      onClose={() => setShowAddModal(false)}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-sm"
      panelClassName="p-5 pt-2 sm:p-5 pb-6"
      showCloseButton
      closeLabel="Close save contact modal"
      ariaLabel="Save Contact"
    >
      <div className="mb-4 pr-11">
        <h3 className="text-sm font-display font-bold text-stone-950 uppercase tracking-wider">
          Save Contact
        </h3>
      </div>
      <form onSubmit={handleAddContact} className="space-y-3">
        {error && <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl font-mono">{error}</div>}
        <div>
          <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-600 block mb-1">
            𝕏 Handle
          </label>
          <div className="flex items-center border border-stone-300 rounded-xl px-3 py-2 bg-stone-50">
            <span className="text-stone-400 font-mono text-sm mr-1">@</span>
            <input
              type="text"
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              placeholder="username"
              className="w-full bg-transparent text-base sm:text-sm text-stone-950 font-mono outline-hidden"
              required
              autoFocus
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-600 block mb-1">
            Nickname (Optional)
          </label>
          <input
            type="text"
            value={newNickname}
            onChange={(e) => setNewNickname(e.target.value)}
            placeholder="e.g. Satoshi"
            className="w-full border border-stone-300 rounded-xl px-3 py-2 bg-stone-50 text-base sm:text-sm text-stone-950 font-mono outline-hidden"
          />
        </div>
        <div className="flex space-x-2 pt-2">
          <button
            type="button"
            onClick={() => setShowAddModal(false)}
            className="w-1/2 py-2.5 min-h-11 rounded-xl border border-stone-300 text-xs font-mono font-bold text-stone-700 hover:bg-stone-100 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="w-1/2 py-2.5 min-h-11 rounded-xl bg-stone-950 hover:bg-black text-white text-xs font-mono font-bold disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalSheet>
  );

  if (!isLoading && contacts.length === 0) {
    return (
      <div className={`rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-3 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <User weight="fill" className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-stone-900">
              People You Pay
            </span>
            <Badge tone="neutral">0</Badge>
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="text-xs font-mono font-bold text-stone-900 hover:underline flex items-center space-x-1 cursor-pointer whitespace-nowrap flex-shrink-0 min-h-10 px-2 -mr-2"
          >
            <Plus weight="bold" className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
        <div className="p-4 sm:p-5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--line)] text-center space-y-2.5">
          <p className="text-xs text-[var(--fg-muted)] font-sans">
            People you pay show up here.
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center space-x-1.5 min-h-10 px-3.5 py-2 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-xs font-mono font-bold cursor-pointer transition-opacity hover:opacity-90"
          >
            <Plus weight="bold" className="w-3.5 h-3.5" />
            <span>Add a person</span>
          </button>
        </div>

        {addContactSheet}
      </div>
    );
  }

  return (
    <div className={`rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <User weight="fill" className="w-4 h-4 text-stone-900" />
          <span className="text-xs font-mono font-bold tracking-wider uppercase text-stone-900">
            People You Pay
          </span>
          <Badge tone="neutral">{contacts.length}</Badge>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="text-xs font-mono font-bold text-stone-900 hover:underline flex items-center space-x-1 cursor-pointer min-h-10 px-2 -mr-2"
        >
          <Plus weight="bold" className="w-3.5 h-3.5" />
          <span>Add Contact</span>
        </button>
      </div>

      {/* Scrollable Row across full desktop width */}
      <div className="flex items-stretch space-x-3 overflow-x-auto pb-2 scrollbar-none">
        {contacts.map((c) => {
          const initials = (c.nickname || c.contact_handle).slice(0, 2).toUpperCase();
          const isPinned = c.is_pinned === 1;

          return (
            <div
              key={c.id || c.contact_handle}
              className="flex-shrink-0 w-44 sm:w-48 p-3.5 rounded-2xl border border-stone-200 bg-stone-50/60 hover:bg-stone-50 shadow-xs hover:border-stone-400 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div className="relative w-9 h-9 flex-shrink-0">
                    <img
                      src={c.avatar_url || `https://unavatar.io/twitter/${c.contact_handle}`}
                      alt={c.contact_handle}
                      className="w-9 h-9 rounded-xl object-cover border border-stone-200 shadow-2xs"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                        const fb = (e.currentTarget.parentElement?.querySelector('.avatar-initials') as HTMLElement);
                        if (fb) fb.style.display = 'flex';
                      }}
                    />
                    <div className="avatar-initials hidden w-9 h-9 rounded-xl bg-white text-stone-900 font-mono font-bold text-xs items-center justify-center border border-stone-200 shadow-2xs">
                      {initials}
                    </div>
                  </div>
                  <div className="flex items-center space-x-0.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(c)}
                      title={isPinned ? 'Unpin contact' : 'Pin to top'}
                      aria-label={isPinned ? `Unpin @${c.contact_handle}` : `Pin @${c.contact_handle}`}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        isPinned
                          ? 'text-orange-600 bg-orange-50'
                          : 'text-stone-400 hover:text-stone-700'
                      }`}
                    >
                      <PushPin weight="fill" className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c)}
                      title="Remove contact"
                      aria-label={`Remove @${c.contact_handle}`}
                      className="p-1.5 rounded-md text-stone-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash weight="fill" className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-bold text-stone-900 font-display truncate">
                    {c.nickname || `@${c.contact_handle}`}
                  </div>
                  {c.nickname && (
                    <div className="text-[11px] text-stone-500 font-mono truncate">
                      @{c.contact_handle}
                    </div>
                  )}
                  <div className="text-[11px] text-stone-500 font-mono mt-1.5 flex items-center space-x-1">
                    <Clock weight="fill" className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">
                      {c.last_transfer_at ? `Last · ${formatTimeAgo(c.last_transfer_at)}` : 'No transfers'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons: Quick Send & Quick Request */}
              <div className="grid grid-cols-2 gap-1.5 pt-3 mt-3 border-t border-stone-200/80">
                <button
                  type="button"
                  onClick={() => onSelectRecipient?.(c.contact_handle, c.preferred_asset || undefined, c.preferred_amount || undefined)}
                  className="py-2 px-2 rounded-xl bg-stone-900 hover:bg-black text-white text-[11px] font-mono font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer"
                >
                  <ArrowUpRight weight="bold" className="w-3 h-3" />
                  <span>Send</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRequestMoney?.(c.contact_handle, c.preferred_asset || undefined)}
                  className="py-2 px-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-800 text-[11px] font-mono font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer"
                >
                  <ArrowDownLeft weight="bold" className="w-3 h-3" />
                  <span>Req</span>
                </button>
              </div>
            </div>
          );
        })}

        {/* Quick Add Card at end of scrollable row */}
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="flex-shrink-0 w-36 sm:w-40 p-3.5 rounded-2xl border-2 border-dashed border-stone-200 hover:border-stone-400 bg-stone-50/30 flex flex-col items-center justify-center space-y-2 text-stone-500 hover:text-stone-900 transition-all cursor-pointer group"
        >
          <div className="w-9 h-9 rounded-xl bg-stone-100 text-stone-500 group-hover:text-stone-900 flex items-center justify-center transition-colors">
            <Plus weight="bold" className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-mono font-bold">Add Contact</span>
        </button>
      </div>

      {addContactSheet}
    </div>
  );
};
