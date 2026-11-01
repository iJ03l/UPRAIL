import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

export default function DocsOverviewPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Documentation
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950">
          UPRAIL Documentation
        </h1>
        <p className="text-base text-stone-600 leading-relaxed max-w-2xl">
          UPRAIL moves value between X handles on NEAR Confidential Intents — no wallet, no seed
          phrase. Connect <strong className="text-stone-900">any AI chat interface</strong> (Grok Bot,
          Meta Muse, OpenAI Dot / ChatGPT, Claude, Cursor) to send, receive, and check payments, or route{' '}
          <strong className="text-stone-900">launchpad creator fees</strong> straight to an X handle.
        </p>
      </header>

      <section className="grid sm:grid-cols-2 gap-4">
        <a
          href="/docs/near"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase tracking-wider">
              near.com Rail
            </span>
          </div>
          <h2 className="font-display font-extrabold text-stone-950">near.com Integration</h2>
          <p className="text-sm text-stone-600">
            How to copy your internal address from near.com, bind it to your passkey, and withdraw
            Intents assets with zero bridge fees.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/near →
          </span>
        </a>

        <a
          href="/docs/agents"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">AI Chat payments</h2>
          <p className="text-sm text-stone-600">
            Passkey-authorized keys with per-payment and daily USD limits that let you send,
            receive, and check payments from any AI chat.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/agents →
          </span>
        </a>

        <a
          href="/docs/mcp"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">Connect your chat</h2>
          <p className="text-sm text-stone-600">
            Step-by-step setup for Claude, ChatGPT, Grok, Meta Muse, Cursor, and any other chat that
            supports a remote connector.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/mcp →
          </span>
        </a>

        <a
          href="/docs/fees"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">Creator fees</h2>
          <p className="text-sm text-stone-600">
            Launchpads keep their own fee receiver. A payout meant for an X handle goes out
            through their UPRAIL adapter and is credited to that handle like a normal send.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/fees →
          </span>
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">How it fits together</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Every surface uses the same confidential settlement primitive: resolve an X handle, and
          either deliver directly to its NEAR Intents vault (if already activated) or escrow the
          funds until the recipient receives it with a passkey.
        </p>
        <Callout>
          <strong className="text-stone-900">New to UPRAIL?</strong> Start with{' '}
          <a className="text-stone-900 underline" href="/docs/agents">
            AI Chat payments
          </a>{' '}
          to create a key, then follow the chat setup guide.
        </Callout>
      </section>
    </article>
  );
}
