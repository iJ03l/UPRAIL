import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function AgentsDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          AI Chat Payments
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Send &amp; receive from any AI chat
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Connect Grok Bot, Meta Muse, OpenAI Dot / ChatGPT, Claude, Cursor, or any AI chat interface
          to your UPRAIL vault using a Passkey-authorized key. Every key enforces live USD spend
          limits (max per payment and max per day) with atomic reservations before any funds move.
        </p>
        <Callout>
          <strong className="text-stone-900">Per-chat setup:</strong> see the{' '}
          <a className="text-stone-900 underline" href="/docs/mcp">
            MCP &amp; OpenAPI connector guide
          </a>{' '}
          for the exact URL, JSON, or Action to use in Grok, Meta Muse, OpenAI Dot, Claude, Cursor,
          or another chat.
        </Callout>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Before you start</h2>
        <Callout>
          <strong className="text-stone-900">Prerequisites:</strong> activate your UPRAIL account,
          fund the vault with the token you will send, and have a passkey ready. Create a separate
          low-limit key for each chat, then test with $1 before increasing limits.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">1. Create an AI chat key</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Create a key in one tap at{' '}
          <a
            className="text-stone-900 underline"
            href="https://app.uprail.world/app/agents"
          >
            app.uprail.world/app/agents
          </a>
          . Creating or revoking a key requires Face ID, fingerprint, or your PIN (a passkey).
        </p>
        <Endpoint verb="POST" path="/api/agent/keys" auth="cookie + passkey" />
        <Code title="Request">{`{
  "name": "Claude",
  "perTxLimit": 25,
  "dailyLimit": 100,
  "expiresInDays": 90
}`}</Code>
        <p className="text-sm text-stone-600 leading-relaxed">
          The response returns the plaintext key <strong className="text-stone-900">once</strong>.
          Only a SHA-256 hash is stored server-side.
        </p>
        <Code title="Response 201">{`{
  "id": "…",
  "agentId": "…",
  "name": "Claude",
  "perTxLimit": "25",
  "dailyLimit": "100",
  "expiresAt": 1760000000000,
  "keyPrefix": "up_agent_3f9c",
  "key": "up_agent_…"   // shown once
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Spend limits (USD)</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="perTxLimit" type="number (USD)">
            Maximum USD value allowed for a single payment (default <code className="font-mono">$25</code>).
          </Field>
          <Field name="dailyLimit" type="number (USD)">
            Maximum cumulative USD value allowed per UTC day (default <code className="font-mono">$100</code>).
          </Field>
          <Field name="expiresInDays" type="number | null">
            Optional key expiration in days (up to 365 days).
          </Field>
        </div>
        <Callout>
          <strong className="text-stone-900">Live USD pricing.</strong> Spend caps are evaluated in
          USD using live on-chain token prices so token unit differences can never bypass your limits.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">2. Send a payment</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Authenticate with your key in the <code className="font-mono">Authorization</code> header.
          REST actions reject keys in the URL; the query-string form is limited to the MCP connector
          URL. UPRAIL automatically quotes and settles the payment in a single request:
        </p>
        <Code title="Header">{`Authorization: Bearer up_agent_…`}</Code>
        <Endpoint verb="POST" path="/api/agent/pay" auth="Bearer agent key" />
        <p className="text-sm text-stone-600 leading-relaxed">
          Send an <code className="font-mono">Idempotency-Key</code> with retryable requests. A
          repeated key never sends a second payment; it returns{' '}
          <code className="font-mono">AGENT_REQUEST_ALREADY_COMPLETED</code> with the original
          payment id instead.
        </p>
        <Code title="Request">{`Authorization: Bearer up_agent_…
Idempotency-Key: 6f1c2a3e-order-42

{
  "recipientHandle": "@alice",
  "asset": "USDC",
  "amount": 10,
  "memo": "coffee"
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          3. Receive payments &amp; deposit addresses
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Retrieve your UPRAIL <code className="font-mono">@handle</code>, view pending incoming
          payments, or generate a single-use deposit address on any supported chain (
          <code className="font-mono">near</code>, <code className="font-mono">base</code>,{' '}
          <code className="font-mono">ethereum</code>, <code className="font-mono">arbitrum</code>,{' '}
          <code className="font-mono">solana</code>, <code className="font-mono">bitcoin</code>):
        </p>
        <Endpoint
          verb="GET"
          path="/api/agent/receive?chain=base&token=USDC&amount=50"
          auth="Bearer agent key"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          4. Check balance &amp; activity
        </h2>
        <Endpoint verb="GET" path="/api/agent/balance?asset=USDC" auth="Bearer agent key" />
        <Endpoint verb="GET" path="/api/agent/payments" auth="Bearer agent key" />
        <Endpoint verb="GET" path="/api/agent/openapi.json" auth="public (ChatGPT Actions)" />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Errors</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="401" type="AGENT_KEY_REQUIRED">
            Missing or malformed Bearer token (<code className="font-mono">up_agent_…</code>).
          </Field>
          <Field name="401" type="AGENT_KEY_INVALID">No key with that value exists.</Field>
          <Field name="403" type="AGENT_KEY_REVOKED">The key was revoked by the owner.</Field>
          <Field name="403" type="AGENT_KEY_EXPIRED">The key passed its expiration date.</Field>
          <Field name="403" type="AGENT_POLICY_DENIED">
            Payment exceeds the key&apos;s per-payment or daily USD spend cap.
          </Field>
        </div>
      </section>
    </article>
  );
}
