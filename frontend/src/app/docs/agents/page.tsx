import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function AgentsDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Feature 1
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Agent rail
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Give an AI agent a scoped key so it can pay X handles on your behalf — inside limits you
          set. A key never touches your passkey; it acts as you through the same send pipeline, and
          every payment is bound by a spend policy you define.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Create a key</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Creating a key is fund-affecting, so it is cookie + passkey gated. You can create keys in
          the dashboard at{' '}
          <a
            className="text-stone-900 underline"
            href="https://app.uprail.world/app/agents"
          >
            app.uprail.world/app/agents
          </a>{' '}
          or directly:
        </p>
        <Endpoint verb="POST" path="/api/agent/keys" auth="cookie + passkey" />
        <Code title="Request">{`{
  "name": "treasury-bot",
  "mode": "always_ask",
  "asset": "USDC",
  "perTxLimit": 25,
  "dailyLimit": 200,
  "allowlist": ["@alice", "@bob"],
  "expiresInDays": 30
}`}</Code>
        <p className="text-sm text-stone-600 leading-relaxed">
          The response contains the plaintext key <strong className="text-stone-900">once</strong>.
          Store it securely — only a hash is kept server-side.
        </p>
        <Code title="Response 201">{`{
  "id": "…",
  "agentId": "…",
  "name": "treasury-bot",
  "mode": "always_ask",
  "asset": "USDC",
  "perTxLimit": "25",
  "dailyLimit": "200",
  "allowlist": ["alice", "bob"],
  "expiresAt": 1760000000000,
  "keyPrefix": "up_agent_3f9c",
  "key": "up_agent_…"   // shown once
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Policy fields</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="mode" type="'always_ask' | 'autonomous'">
            <strong className="text-stone-900">always_ask</strong> queues every payment for your
            on-device approval. <strong className="text-stone-900">autonomous</strong> executes
            immediately when within policy and denies anything outside it.
          </Field>
          <Field name="asset" type="string | null">
            Pin the key to a single asset (e.g. <code className="font-mono">USDC</code>). Null means
            any asset.
          </Field>
          <Field name="perTxLimit" type="number | null">Maximum amount for a single payment.</Field>
          <Field name="dailyLimit" type="number | null">Rolling 24-hour spend ceiling.</Field>
          <Field name="allowlist" type="string[] | null">
            Restrict payments to a set of X handles.
          </Field>
          <Field name="expiresInDays" type="number | null">
            Key expiry, up to 365 days. Expired keys are rejected.
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Pay with the key</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Programmatic calls authenticate with the key as a Bearer token:
        </p>
        <Code title="Header">{`Authorization: Bearer up_agent_…`}</Code>
        <Endpoint verb="POST" path="/api/agent/pay" auth="Bearer agent key" />
        <Code title="Request">{`{
  "recipientHandle": "@alice",
  "asset": "USDC",
  "amount": "12.50",
  "memo": "api credits"
}`}</Code>

        <h3 className="text-base font-display font-bold text-stone-950 pt-2">
          Always-Ask flow
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          In <code className="font-mono text-[13px]">always_ask</code> mode the first call queues an
          approval and returns <code className="font-mono text-[13px]">202</code>:
        </p>
        <Code title="Response 202">{`{
  "status": "PENDING_APPROVAL",
  "approvalId": "8f2c…",
  "code": "AGENT_APPROVAL_REQUIRED"
}`}</Code>
        <p className="text-sm text-stone-600 leading-relaxed">
          Approve it on device (dashboard → Agents), then retry the exact same request with the
          approval id. Approvals are single-use and expire after 24 hours.
        </p>
        <Code title="Retry header">{`X-Agent-Approval: 8f2c…`}</Code>
        <Callout>
          An approval is bound to one intent. If the retried <code className="font-mono">recipientHandle</code>,{' '}
          <code className="font-mono">asset</code>, or <code className="font-mono">amount</code>{' '}
          differ, the intent does not match and a new approval is queued.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Read endpoints</h2>
        <Endpoint verb="GET" path="/api/agent/balance?asset=USDC" auth="Bearer agent key" />
        <Endpoint verb="GET" path="/api/agent/payments" auth="Bearer agent key" />
        <Endpoint verb="GET" path="/api/agent/keys" auth="cookie" />
        <Endpoint verb="POST" path="/api/agent/keys/:id/revoke" auth="cookie + passkey" />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Errors</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="401" type="AGENT_KEY_REQUIRED">
            Missing or malformed Bearer token. Keys look like <code className="font-mono">up_agent_…</code>.
          </Field>
          <Field name="401" type="AGENT_KEY_INVALID">No key with that value exists.</Field>
          <Field name="403" type="AGENT_KEY_REVOKED">The key was revoked.</Field>
          <Field name="403" type="AGENT_KEY_EXPIRED">The key passed its expiry.</Field>
          <Field name="403" type="AGENT_POLICY_DENIED">
            Autonomous payment outside the key&apos;s asset, per-tx, daily, or allowlist policy.
          </Field>
        </div>
      </section>
    </article>
  );
}
