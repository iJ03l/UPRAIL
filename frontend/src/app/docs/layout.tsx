import type { Metadata } from 'next';
import React from 'react';
import { DocsNav } from '@/components/docs/DocsNav';

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.uprail.world'),
  title: 'UPRAIL Docs — AI Agents & MCP payments, near.com rail & creator fees',
  description:
    'Documentation for UPRAIL AI Agents & Model Context Protocol payments (Grok, Meta Muse, ChatGPT, Claude, Cursor), near.com routing, and launchpad creator-fee routing to an X handle.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-stone-900">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-surface-glass backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/docs" className="flex items-center space-x-2">
            <img
              src="/brand/uprail-icon.png"
              alt="UPRAIL"
              className="h-6 w-6 object-contain sm:hidden"
            />
            <img
              src="/brand/uprail-wordmark.png"
              alt="uprail"
              className="hidden sm:block h-5 w-auto object-contain"
            />
            <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-stone-900 text-white">
              Docs
            </span>
          </a>
          <div className="flex items-center space-x-4 text-xs font-mono font-bold">
            <a href="/docs/agents" className="hidden sm:inline text-stone-500 hover:text-stone-950">
              AI Agents &amp; MCP
            </a>
            <a
              href="https://app.uprail.world"
              className="px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-900"
            >
              Launch app
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-10">
        <aside className="lg:w-56 flex-shrink-0">
          <div className="lg:sticky lg:top-20">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 px-3 mb-2">
              Reference
            </div>
            <DocsNav />
          </div>
        </aside>

        <main className="min-w-0 flex-1 max-w-3xl">{children}</main>
      </div>

      <footer className="border-t border-stone-200 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-stone-400 font-mono">
          <span>UPRAIL — the confidential value railway for X.</span>
          <div className="flex items-center space-x-4">
            <a href="https://app.uprail.world" className="hover:text-stone-700">
              app.uprail.world
            </a>
            <a href="https://x.com/uprailworld" className="hover:text-stone-700">
              @uprailworld
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
