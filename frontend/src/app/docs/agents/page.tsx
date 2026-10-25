import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

const APP_SETUP_URL = 'https://app.uprail.world/app/agents';
const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';

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
          Connect Claude, ChatGPT, Grok, Meta Muse, Cursor, or another AI chat to UPRAIL with OAuth
          and Face ID. No secret key is copied into the chat. Every connection has a
          per-transaction and daily USD limit, and you can disconnect it in one tap.
        </p>
        <Callout>
          <strong className="text-stone-900">Start here:</strong> open AI Chat Payments, click{' '}
          <strong>Connect AI Chat</strong>, and approve low limits. Follow the per-chat steps in the{' '}
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
              <strong className="text-stone-900">Choose your chat.</strong> UPRAIL gives you the MCP
              URL and the exact settings page. Nothing secret is created or copied.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              2
            </span>
            <span>
              <strong className="text-stone-900">Approve with your passkey.</strong> The chat opens
              UPRAIL in your browser. Set a per-transaction and daily USD limit, then confirm with
              Face ID, Touch ID, fingerprint, or your PIN.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              3
            </span>
            <span>
              <strong className="text-stone-900">Ask in chat.</strong> Start a fresh conversation,
              enable the UPRAIL connector, and ask for your balance, send a payment, or withdraw to
              a wallet in plain language.
            </span>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">1. Connect your chat</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Open AI Chat Payments and click <strong>Connect AI Chat</strong>. Pick your app, then add
          this URL as a custom or remote MCP connector. Leave authentication empty: OAuth discovery
          handles it.
        </p>
        <code className="block break-all rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-xs text-stone-800">
          {MCP_ENDPOINT}
        </code>
        <a
          href={APP_SETUP_URL}
          className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-white transition-colors hover:bg-stone-800"
        >
          Connect an AI chat
        </a>
        <div className="rounded-2xl border border-stone-200 p-4 space-y-2 text-sm text-stone-600 leading-relaxed">
          <p>
            <strong className="text-stone-900">Per-transaction limit:</strong> the most one payment
            or withdrawal can move, in USD.
          </p>
          <p>
            <strong className="text-stone-900">Daily limit:</strong> the most the connection can
            spend in one UTC day, in USD.
          </p>
          <p>
            <strong className="text-stone-900">Expiry:</strong> connections last 90 days. Reconnect
            with a fresh passkey approval when prompted.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          2. Approve the connection
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Your browser opens the UPRAIL consent page. Review the app name and the limits, then
          approve. If you verified your passkey within the last five minutes, UPRAIL skips the
          second prompt. Otherwise it asks for Face ID or fingerprint once.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#claude"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Claude</h3>
            <p className="mt-1 text-xs text-stone-600">
              Add a custom connector, paste the URL, then approve in the browser.
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
              Ask Muse to add a remote MCP connector with the UPRAIL URL.
            </p>
          </a>
          <a
            className="rounded-2xl border border-stone-200 p-4 transition-colors hover:border-stone-900"
            href="/docs/mcp#cursor"
          >
            <h3 className="text-sm font-display font-bold text-stone-950">Cursor / Windsurf</h3>
            <p className="mt-1 text-xs text-stone-600">
              Add a remote MCP server with the URL and approve OAuth.
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
          amount and destination network explicitly. The connection&apos;s USD limits apply to
          withdrawals too, and the chat cannot use “all” as an amount.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Manage &amp; disconnect
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Every connected app appears under <strong>Connected AI Chats</strong> with its client
          name, limits, and today&apos;s spend. Click <strong>Disconnect</strong> and confirm with
          your passkey. Revocation is immediate: the app can no longer read your balance or move
          funds. Reconnecting requires a fresh approval.
        </p>
        <Callout tone="warn">
          <strong className="text-stone-900">Manual Bearer keys are different.</strong> Bots and
          OpenAPI clients may still use a one-time Bearer key. Treat that key like cash, never paste
          it into a public chat, and revoke it immediately if exposed.
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
            <strong className="text-stone-900">The consent page did not open.</strong> Allow
            pop-ups for the AI app, then retry the connection. If it still fails, add the MCP URL
            manually and choose OAuth when prompted.
          </p>
          <p>
            <strong className="text-stone-900">A payment timed out.</strong> Check UPRAIL history
            before retrying. The payment may have completed even if the chat lost the response.
          </p>
          <p>
            <strong className="text-stone-900">A connection was exposed or lost.</strong>{' '}
            Disconnect it immediately in AI Chat Payments. Reconnecting takes one passkey approval.
          </p>
        </div>
      </section>
    </article>
  );
}
