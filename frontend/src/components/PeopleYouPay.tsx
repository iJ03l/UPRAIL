'use client';

import React, { useEffect, useState } from 'react';
import { User, Pin, ArrowUpRight, ArrowDownLeft, Clock, Plus, Check, Trash2, X } from 'lucide-react';
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

  if (!isLoading && contacts.length === 0) {
    return (
      <div className={`rounded-3xl p-5 sm:p-6 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs space-y-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <User className="w-4 h-4 text-stone-900 dark:text-white" />
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-stone-900 dark:text-white">
              People You Pay
            </span>
            <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10px] font-mono font-bold text-stone-500">
              0
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="text-xs font-mono font-bold text-orange-600 hover:text-orange-700 dark:text-orange-400 flex items-center space-x-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
        <div className="p-6 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-dashed border-stone-200 dark:border-stone-800 text-center space-y-2">
          <p className="text-xs text-stone-500 dark:text-stone-400 font-sans max-w-md mx-auto">
            Your frequent recipients and saved 𝕏 contacts will appear here for fast one-tap sends and payment requests.
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add a person</span>
          </button>
        </div>

        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-display font-bold text-stone-900 dark:text-white uppercase tracking-wider">
                  Save Contact
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleAddContact} className="space-y-3">
                {error && <div className="p-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/40 rounded-lg">{error}</div>}
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
                    𝕏 Handle
                  </label>
                  <div className="flex items-center border border-stone-300 dark:border-stone-700 rounded-xl px-3 py-2 bg-stone-50 dark:bg-stone-950">
                    <span className="text-stone-400 font-mono text-sm mr-1">@</span>
                    <input
                      type="text"
                      value={newHandle}
                      onChange={(e) => setNewHandle(e.target.value)}
                      placeholder="username"
                      className="w-full bg-transparent text-sm text-stone-900 dark:text-white font-mono outline-hidden"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
                    Nickname (Optional)
                  </label>
                  <input
                    type="text"
                    value={newNickname}
                    onChange={(e) => setNewNickname(e.target.value)}
                    placeholder="e.g. Satoshi"
                    className="w-full border border-stone-300 dark:border-stone-700 rounded-xl px-3 py-2 bg-stone-50 dark:bg-stone-950 text-sm text-stone-900 dark:text-white font-mono outline-hidden"
                  />
                </div>
                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="w-1/2 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-mono font-bold text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="w-1/2 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-mono font-bold disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-3xl p-5 sm:p-6 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <User className="w-4 h-4 text-stone-900 dark:text-white" />
          <span className="text-xs font-mono font-bold tracking-wider uppercase text-stone-900 dark:text-white">
            People You Pay
          </span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10px] font-mono font-bold text-stone-600 dark:text-stone-400">
            {contacts.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="text-xs font-mono font-bold text-orange-600 hover:text-orange-700 dark:text-orange-400 flex items-center space-x-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Contact</span>
        </button>
      </div>

      {/* Responsive Grid across full desktop width */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {contacts.map((c) => {
          const initials = (c.nickname || c.contact_handle).slice(0, 2).toUpperCase();
          const isPinned = c.is_pinned === 1;

          return (
            <div
              key={c.id || c.contact_handle}
              className="p-3.5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-950/60 hover:bg-stone-50 dark:hover:bg-stone-950 shadow-xs hover:border-stone-400 dark:hover:border-stone-700 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-xl bg-white dark:bg-stone-800 text-stone-900 dark:text-white font-mono font-bold text-xs flex items-center justify-center border border-stone-200 dark:border-stone-700 shadow-2xs">
                    {initials}
                  </div>
                  <div className="flex items-center space-x-0.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(c)}
                      title={isPinned ? 'Unpin contact' : 'Pin to top'}
                      className={`p-1 rounded-md transition-colors ${
                        isPinned
                          ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40'
                          : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                      }`}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c)}
                      title="Remove contact"
                      className="p-1 rounded-md text-stone-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-bold text-stone-900 dark:text-white font-display truncate">
                    {c.nickname || `@${c.contact_handle}`}
                  </div>
                  {c.nickname && (
                    <div className="text-[10px] text-stone-500 dark:text-stone-400 font-mono truncate">
                      @{c.contact_handle}
                    </div>
                  )}
                  <div className="text-[10px] text-stone-400 dark:text-stone-500 font-mono mt-1.5 flex items-center space-x-1">
                    <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">
                      {c.last_transfer_at ? `Last · ${formatTimeAgo(c.last_transfer_at)}` : 'No transfers'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons: Quick Send & Quick Request */}
              <div className="grid grid-cols-2 gap-1.5 pt-3 mt-3 border-t border-stone-200/80 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => onSelectRecipient?.(c.contact_handle, c.preferred_asset || undefined, c.preferred_amount || undefined)}
                  className="py-1.5 px-2 rounded-xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-[10px] font-mono font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer"
                >
                  <ArrowUpRight className="w-3 h-3" />
                  <span>Send</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRequestMoney?.(c.contact_handle, c.preferred_asset || undefined)}
                  className="py-1.5 px-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-[10px] font-mono font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer"
                >
                  <ArrowDownLeft className="w-3 h-3" />
                  <span>Req</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-display font-bold text-stone-900 dark:text-white uppercase tracking-wider">
                Save Contact
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddContact} className="space-y-3">
              {error && <div className="p-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/40 rounded-lg">{error}</div>}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
                  𝕏 Handle
                </label>
                <div className="flex items-center border border-stone-300 dark:border-stone-700 rounded-xl px-3 py-2 bg-stone-50 dark:bg-stone-950">
                  <span className="text-stone-400 font-mono text-sm mr-1">@</span>
                  <input
                    type="text"
                    value={newHandle}
                    onChange={(e) => setNewHandle(e.target.value)}
                    placeholder="username"
                    className="w-full bg-transparent text-sm text-stone-900 dark:text-white font-mono outline-hidden"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
                  Nickname (Optional)
                </label>
                <input
                  type="text"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder="e.g. Satoshi"
                  className="w-full border border-stone-300 dark:border-stone-700 rounded-xl px-3 py-2 bg-stone-50 dark:bg-stone-950 text-sm text-stone-900 dark:text-white font-mono outline-hidden"
                />
              </div>
              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-1/2 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-mono font-bold text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-1/2 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-mono font-bold disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
