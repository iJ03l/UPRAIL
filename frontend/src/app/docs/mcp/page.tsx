import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function McpDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          MCP &amp; OpenAPI Actions
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Connect Claude, OpenAI Dot, Grok Bot, Meta Muse &amp; Cursor
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL exposes a universal <strong className="text-stone-900">1-Click MCP URL</strong>, a
          standard <strong className="text-stone-900">MCP JSON config</strong>, and an{' '}
          <strong className="text-stone-900">OpenAPI 3.1 spec</strong> so you can connect any AI chat
          interface in seconds. Every tool call runs under your key&apos;s USD spend limits.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Before you connect</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="1. Account" type="required">
            Activate your UPRAIL account at{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world">
              app.uprail.world
            </a>{' '}
            and fund the vault with the token you want to send.
          </Field>
          <Field name="2. Key" type="required">
            Open{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world/app/agents">
              AI Chat Payments
            </a>
            , choose the chat you are connecting, set a per-payment and daily USD limit, and confirm
            with your passkey. Use a separate low-limit key for each chat.
          </Field>
          <Field name="3. Connect" type="required">
            Copy the 1-click MCP URL, MCP JSON, or OpenAPI spec below, add it to the chat, then start
            a fresh conversation and enable the connector.
          </Field>
          <Field name="4. Test" type="recommended">
            Ask for your balance first, then send a $1 payment to a handle you control. Confirm it in
            the UPRAIL app history before increasing limits.
          </Field>
        </div>
        <Callout>
          <strong className="text-stone-900">Support depends on the client.</strong> UPRAIL works
          with any chat that accepts a remote MCP server or OpenAPI Actions. Some plans or client
          versions hide custom connectors; in that case use the OpenAPI option where available.
          Client labels change, so treat the menu names below as a guide rather than an exact map.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Which setup should each chat use?
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">Grok Bot</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              1-click MCP URL in Grok&apos;s Tools / Connectors / Remote MCP settings. If your Grok
              client does not expose custom MCP servers, use OpenAPI Actions with the spec and a
              Bearer key.
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">Meta Muse</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              1-click MCP URL in Connectors / MCP URL. In Meta Muse Studio, the OpenAPI spec can be
              imported as an Action with a Bearer key.
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">
              OpenAI Dot / ChatGPT
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              Import the OpenAPI spec in Actions / Tools → Import from URL, then use API Key (Bearer).
              Use the MCP URL for clients that support remote MCP connectors.
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">Claude Web &amp; Mobile</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              1-click MCP URL in Settings → Integrations / Connectors → Add MCP Server. Use the JSON
              form for Claude Desktop.
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">
              Claude Desktop, Cursor &amp; Windsurf
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              Use the MCP JSON config with the endpoint and an{' '}
              <code className="font-mono text-[12px]">Authorization: Bearer up_agent_…</code>{' '}
              header.
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4 space-y-1.5">
            <h3 className="text-sm font-display font-bold text-stone-950">Any other chat</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              Use remote MCP if supported, otherwise OpenAPI Actions. UPRAIL cannot add connector
              support to a client that does not expose MCP or Actions.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option A — 1-Click Connector URL (Grok Bot, Meta Muse, OpenAI Dot, Claude Web/Mobile)
        </h2>
        <Endpoint verb="POST" path="/api/mcp?key=up_agent_…" auth="Self-authenticated URL" />
        <p className="text-sm text-stone-600 leading-relaxed">
          For AI chats that accept a single Remote MCP / Connector URL without a separate custom
          header field, paste your 1-click URL directly:
        </p>
        <Code title="1-Click MCP Server URL">{`https://api.uprail.world/api/mcp?key=up_agent_YOUR_KEY`}</Code>
        <Callout>
          <strong className="text-stone-900">The URL contains your secret key.</strong> Use a
          dedicated key for connector URLs, never paste it into a public chat, and revoke the key
          immediately if the URL is exposed. Header-based MCP config authenticates without putting
          the secret in a URL.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option B — OpenAI Dot / ChatGPT, Grok &amp; Meta Muse OpenAPI Actions
        </h2>
        <Endpoint verb="GET" path="/api/agent/openapi.json" auth="public" />
        <p className="text-sm text-stone-600 leading-relaxed">
          In <strong className="text-stone-900">OpenAI Dot / ChatGPT</strong>,{' '}
          <strong className="text-stone-900">Grok Studio</strong>, or{' '}
          <strong className="text-stone-900">Meta Muse</strong>, open{' '}
          <strong className="text-stone-900">Actions / Tools → Import from URL</strong>, paste{' '}
          <code className="font-mono text-[13px]">https://api.uprail.world/api/agent/openapi.json</code>,
          and set Authentication to <strong className="text-stone-900">API Key (Bearer)</strong> with
          your <code className="font-mono text-[13px]">up_agent_…</code> key.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option C — Claude Desktop, Cursor &amp; Windsurf (MCP JSON)
        </h2>
        <Endpoint verb="POST" path="/api/mcp" auth="Bearer agent key" />
        <Code title="MCP config JSON">{`{
  "mcpServers": {
    "uprail": {
      "url": "https://api.uprail.world/api/mcp",
      "headers": {
        "Authorization": "Bearer up_agent_…"
      }
    }
  }
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Connect, then test with $1
        </h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-stone-600 leading-relaxed">
          <li>Save the connector or Action in the chat, then open a fresh conversation.</li>
          <li>Enable the UPRAIL connector and ask a read-only question, e.g. “What is my UPRAIL balance?”</li>
          <li>Send $1 to a handle you control, then check the payment in UPRAIL history.</li>
          <li>Only raise the key limits after that test succeeds.</li>
        </ol>
        <Callout>
          <strong className="text-stone-900">If the tools do not appear:</strong> the client likely
          does not support that connector type. Try the OpenAPI option instead. If a payment times
          out, check history before retrying; some chats do not send an{' '}
          <code className="font-mono text-[13px]">idempotencyKey</code> automatically.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Available tools</h2>

        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="pay_handle" type="recipientHandle, asset, amount, memo?">
            Send a confidential payment to an X <code className="font-mono">@handle</code> within
            your USD spend limits.
          </Field>
          <Field name="receive_payment" type="chain?, token?, amount?">
            Get your UPRAIL <code className="font-mono">@handle</code>, check pending incoming
            payments, or generate a fresh deposit address on any supported blockchain.
          </Field>
          <Field name="get_balance" type="asset?: string">
            Read your available UPRAIL balance for a token (e.g. USDC, USDT, NEAR).
          </Field>
          <Field name="list_payments" type="none">
            List your recent sent and received payments on UPRAIL.
          </Field>
          <Field name="resolve_handle" type="handle: string">
            Check if an X <code className="font-mono">@handle</code> has activated UPRAIL.
          </Field>
        </div>

        <h3 className="text-base font-display font-bold text-stone-950 pt-2">Example MCP call</h3>
        <Code title="tools/call">{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "pay_handle",
    "arguments": {
      "recipientHandle": "@alice",
      "asset": "USDC",
      "amount": 10,
      "memo": "coffee"
    }
  }
}`}</Code>
        <Callout>
          <strong className="text-stone-900">Shared USD enforcement.</strong> Both MCP{' '}
          <code className="font-mono text-[13px]">pay_handle</code> and REST{' '}
          <code className="font-mono text-[13px]">POST /api/agent/pay</code> run through the exact
          same atomic USD spend reservation and quote-and-send pipeline.
        </Callout>
      </section>
    </article>
  );
}
