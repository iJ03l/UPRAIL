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
          phrase. Connect <strong className="text-stone-900">any AI chat interface</strong> (ChatGPT,
          Claude, Cursor) to send, receive, and check payments, or route{' '}
          <strong className="text-stone-900">launchpad creator fees</strong> straight to an X handle.
        </p>
      </header>

      <section className="grid sm:grid-cols-2 gap-4">
        <a
          href="/docs/agents"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">AI Chat payments</h2>
          <p className="text-sm text-stone-600">
            Passkey-authorized Bearer keys with mandatory USD spend caps (`perTxLimit` and
            `dailyLimit`) that let you send, receive, and check payments from any AI chat.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/agents →
          </span>
        </a>

        <a
          href="/docs/mcp"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">MCP server &amp; ChatGPT Actions</h2>
          <p className="text-sm text-stone-600">
            Drop UPRAIL into Claude, Cursor, Windsurf, or ChatGPT Actions. Tools to send payments,
            receive across chains, read balances, and list activity.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/mcp →
          </span>
        </a>

        <a
          href="/docs/fees"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2 sm:col-span-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">Creator fees</h2>
          <p className="text-sm text-stone-600">
            Launch on Nearly or JustHoot, point your creator fees at an X handle, and UPRAIL routes
            the paired token to that handle like a normal send.
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
          funds until the recipient claims with a passkey.
        </p>
        <Callout>
          <strong className="text-stone-900">Base URL.</strong> All API calls use{' '}
          <code className="font-mono text-[13px]">https://api.uprail.world</code>. Docs live at{' '}
          <code className="font-mono text-[13px]">https://docs.uprail.world</code>.
        </Callout>
      </section>
    </article>
  );
}
