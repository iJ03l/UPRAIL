import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

export default function DocsOverviewPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Developer documentation
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950">
          Build on UPRAIL
        </h1>
        <p className="text-base text-stone-600 leading-relaxed max-w-2xl">
          UPRAIL moves value between X handles on NEAR Confidential Intents — no wallet, no seed
          phrase. These docs cover the two new developer surfaces: the{' '}
          <strong className="text-stone-900">agent payment rail</strong> and{' '}
          <strong className="text-stone-900">launchpad creator-fee routing</strong>.
        </p>
      </header>

      <section className="grid sm:grid-cols-2 gap-4">
        <a
          href="/docs/agents"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">Agent rail</h2>
          <p className="text-sm text-stone-600">
            Scoped Bearer keys that let an AI agent pay X handles within the limits and policy you
            set. Always-Ask approvals, spend caps, allowlists.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/agents →
          </span>
        </a>

        <a
          href="/docs/x402"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">x402 / MPP</h2>
          <p className="text-sm text-stone-600">
            Charge for any resource with a standards-shaped HTTP 402, settled over NEAR Intents.
            Mint a challenge, verify, settle — single-use.
          </p>
          <span className="text-[11px] font-mono font-bold text-stone-500">
            /docs/x402 →
          </span>
        </a>

        <a
          href="/docs/mcp"
          className="block p-5 rounded-2xl border border-stone-200 hover:border-stone-900 transition-colors space-y-2"
        >
          <h2 className="font-display font-extrabold text-stone-950">MCP server</h2>
          <p className="text-sm text-stone-600">
            Drop UPRAIL into any MCP client. Tools to resolve handles, read balances, pay, and
            create payment requests — all under the agent policy.
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
          Every surface is a thin wrapper over the same primitive: resolve an X handle, and either
          deliver to its NEAR account (if it has signed up) or escrow the funds until it does. That
          is what makes an agent payment, an x402 settlement, and a launchpad creator fee the same
          object on-chain — same quote binding, same escrow, same expiry and refund rules.
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
