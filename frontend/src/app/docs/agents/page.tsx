import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

const APP_SETUP_URL = 'https://app.uprail.world/app/agents';

export default function AgentsDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          AI Chat Payments
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Send, receive &amp; withdraw from your AI chat
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Create a passkey-authorized key in the UPRAIL app, connect it to Claude, ChatGPT, Grok,
          Meta Muse, Cursor, or another AI chat, then send, receive, withdraw, and check payments
          without leaving the conversation. Every key has a per-transaction and daily USD limit.
        </p>
        <Callout>
          <strong className="text-stone-900">Start here:</strong> create a low-limit key, follow the
          setup steps for your chat in the{' '}
          <a className="text-stone-900 underline" href="/docs/mcp">
            connecting guide
          </a>
          , then test with $1 before raising the limits.
        </Callout>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">How it works</h2>
        <ol className="space-y-3 text-sm text-stone-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              1
            </span>
            <span>
              <strong className="text-stone-900">Create a key.</strong> Pick your chat, set a
              per-transaction limit and a daily limit, then approve with Face ID, fingerprint, or your
              PIN. The secret is shown once.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              2
            </span>
            <span>
              <strong className="text-stone-900">Connect your chat.</strong> The key screen gives
              you the right action for the chat you picked. Claude and Cursor open with the
              connection prefilled; other chats open the right settings page and copy what you
              need.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              3
            </span>
            <span>
              <strong className="text-stone-900">Ask in chat.</strong> Start a fresh conversation,
              enable the UPRAIL connector, and ask for your balance, send a payment, or withdraw
              to a wallet in plain language.
            </span>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">1. Create your key</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Open AI Chat Payments in the UPRAIL app, choose the chat you are connecting, and confirm
          the key with your passkey. Use a separate key for each chat so you can revoke one without
          affecting the others.
        </p>
        <a
          href={APP_SETUP_URL}
          className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-white transition-colors hover:bg-stone-800"
        >
          Create an AI chat key
        </a>
        <div className="rounded-2xl border border-stone-200 p-4 space-y-2 text-sm text-stone-600 leading-relaxed">
          <p>
            <strong className="text-stone-900">Per-transaction limit:</strong> the most one payment or withdrawal can
            move, in USD.
          </p>
          <p>
            <strong className="text-stone-900">Daily limit:</strong> the most the key can spend in
            one UTC day, in USD.
          </p>
          <p>
            <strong className="text-stone-900">Expiry:</strong> optional. Choose a shorter lifetime
            for a test key.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          2. Connect your chat
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          After the key is created, the UPRAIL app shows a setup action for the chat you selected.
          Use the per-chat guide for the exact menu path and what to expect.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#claude"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Claude</h3>
            <p className="mt-1 text-xs text-stone-600">
              Open the prefilled custom connector, review it, then connect.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#chatgpt"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">
              ChatGPT / OpenAI Dot
            </h3>
            <p className="mt-1 text-xs text-stone-600">
              Add a custom connector in Settings, then paste the UPRAIL URL.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#grok"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Grok</h3>
            <p className="mt-1 text-xs text-stone-600">
              Create a custom MCP connector and paste the UPRAIL URL.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#meta-muse"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Meta Muse</h3>
            <p className="mt-1 text-xs text-stone-600">
              Paste the setup prompt and let Muse create the connector.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#cursor"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Cursor / Windsurf</h3>
            <p className="mt-1 text-xs text-stone-600">
              Open the install link in Cursor, or paste the config in Windsurf.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#other"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Any other chat</h3>
            <p className="mt-1 text-xs text-stone-600">
              Add the UPRAIL URL as a remote MCP connector.
            </p>
          </a>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">3. Test with $1</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open a fresh conversation and enable the UPRAIL connector.</li>
          <li>Ask a read-only question first, such as “What is my UPRAIL balance?”</li>
          <li>Send $1 to a handle you control.</li>
          <li>Check the payment in UPRAIL history before increasing your limits.</li>
        </ol>
        <div className="grid gap-2 text-xs font-mono text-stone-700 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-200 p-3">
            “Send 10 USDC to @alice for coffee”
          </div>
          <div className="rounded-xl border border-stone-200 p-3">
            “Give me a Base USDC address to receive $50”
          </div>
          <div className="rounded-xl border border-stone-200 p-3">
            “Withdraw 5 USDC to 0x… on Base”
          </div>
          <div className="rounded-xl border border-stone-200 p-3">
            “Check my UPRAIL balance and recent payments”
          </div>
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">Withdrawals are irreversible.</strong> Always state the
          amount and destination network explicitly. The key&apos;s USD limits apply to withdrawals
          too, and the chat cannot use “all” as an amount.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Manage &amp; revoke</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Every connected chat appears under AI Chat Payments with its limits and today&apos;s
          spend. Revoke a key at any time with your passkey. Revoking is immediate: that chat can no
          longer read your balance or move funds. Once revoked, you can permanently delete the key
          record from the same screen.
        </p>
        <Callout tone="warn">
          <strong className="text-stone-900">Treat the key like cash.</strong> Never paste it into a
          public or shared chat. The Meta Muse setup prompt is for your own private Muse chat, so use
          a dedicated low-limit key there. If a link or key is exposed, revoke it and create a new
          one.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Troubleshooting</h2>
        <div className="space-y-3 text-sm text-stone-600 leading-relaxed">
          <p>
            <strong className="text-stone-900">The UPRAIL tools do not appear.</strong> Make sure
            you started a fresh conversation after connecting. If they still do not appear, your
            plan or chat version may not support custom connectors.
          </p>
          <p>
            <strong className="text-stone-900">A payment timed out.</strong> Check UPRAIL history
            before retrying. The payment may have completed even if the chat lost the response.
          </p>
          <p>
            <strong className="text-stone-900">The key was exposed.</strong> Revoke it immediately
            in AI Chat Payments. Creating a replacement key takes one passkey confirmation.
          </p>
        </div>
      </section>
    </article>
  );
}
