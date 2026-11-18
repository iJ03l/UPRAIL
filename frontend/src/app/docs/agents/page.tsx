import React from 'react';
import { Badge } from '@/components/Badge';
import { Callout } from '@/components/docs/DocsUI';

const APP_SETUP_URL = 'https://app.uprail.world/app/agents';
const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';
const OPENAPI_SPEC_URL = 'https://api.uprail.world/api/agent/openapi.json';
const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/plugins';
const GROK_CONNECTORS_URL = 'https://grok.com/connectors';
const META_MUSE_URL = 'https://muse.ai/';

const buttonClass =
  'inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-white transition-colors hover:bg-stone-800';
const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-stone-900 transition-colors hover:border-stone-900';

function UrlBox({ value }: { value: string }) {
  return (
    <code className="block break-all rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-xs text-stone-800">
      {value}
    </code>
  );
}

export default function AgentsDocsPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
            AI Agents &amp; MCP
          </span>
          <Badge tone="neutral">Post-Frontend Rail</Badge>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950">
          The Value Railway for Autonomous AI Agents
        </h1>
        <p className="text-base text-stone-600 leading-relaxed max-w-2xl">
          In the coming era, users will rarely interact with traditional web frontends. Software is
          shifting to conversational and autonomous agents—Claude, ChatGPT, Grok, Meta Muse, Cursor,
          and autonomous bots—that negotiate, orchestrate workflows, and settle transactions.
        </p>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL provides the agentic payment infrastructure from day one: an open{' '}
          <strong className="text-stone-900">Model Context Protocol (MCP)</strong> server secured by{' '}
          <strong className="text-stone-900">OAuth 2.1 PKCE</strong> and{' '}
          <strong className="text-stone-900">hardware passkeys (WebAuthn)</strong>. AI models transact
          freely within your cryptographic guardrails without ever touching raw private keys.
        </p>
        <Callout>
          <strong className="text-stone-900">Why are Agents &amp; MCP unified here?</strong> MCP
          (Model Context Protocol) is the open wire protocol that lets LLMs invoke external tools, while
          AI Agents and Chat apps are the autonomous consumers of that protocol. In UPRAIL, they are the
          exact same payment rail: you connect your AI via the MCP endpoint, and control its spending
          with your passkey.
        </Callout>
      </header>

      {/* Quick Setup / Endpoint */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Remote MCP Server Endpoint</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL exposes a standard Streamable HTTP MCP server (<span className="font-mono text-xs">2025-06-18</span>)
          with RFC 8414 &amp; RFC 9728 OAuth 2.1 discovery. Add this single URL as a custom or remote MCP connector
          in any supported AI client. Leave authentication blank—your client handles OAuth discovery automatically.
        </p>
        <UrlBox value={MCP_ENDPOINT} />
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={APP_SETUP_URL} className={buttonClass}>
            Connect AI Chat in App
          </a>
          <a href="#clients" className={secondaryButtonClass}>
            Jump to Client Guides ↓
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">How It Works: Cryptographic Guardrails</h2>
        <ol className="space-y-3 text-sm text-stone-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              1
            </span>
            <span>
              <strong className="text-stone-900">Zero Raw Key Exposure:</strong> The AI model never touches,
              stores, or logs a private key or seed phrase. It receives a revocable, scoped OAuth 2.1 bearer
              token strictly bound to your spend policies.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              2
            </span>
            <span>
              <strong className="text-stone-900">Biometric Passkey Authorization:</strong> You approve the
              connection in your browser using Face ID, Touch ID, fingerprint, or your hardware security key
              (WebAuthn P-256). You set a per-transaction USD cap and a daily UTC USD spend limit.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              3
            </span>
            <span>
              <strong className="text-stone-900">Atomic Spend Reservation &amp; Live Oracle:</strong> Every
              tool invocation checks live oracle exchange rates and reserves daily spend atomically in durable
              storage before signing or executing on NEAR. Retried prompts cannot cause double-spends.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              4
            </span>
            <span>
              <strong className="text-stone-900">Agent Allowance Pocket (Passkey Self-Custody):</strong>{' '}
              In Passkey Self-Custody accounts, your main vault stays 100% locked to your device key.
              Pre-fund your isolated <strong className="text-stone-900">Agent Allowance Pocket</strong>{' '}
              with USDC, USDT, or NEAR on <code className="text-xs">/app/agents</code> so your agent
              can execute zero-prompt confidential sends and withdrawals within your spend caps (while
              remaining part of your unified balance).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              5
            </span>
            <span>
              <strong className="text-stone-900">Human-in-the-Loop Escalation (<code className="text-xs">/approve</code>):</strong> If an
              agent needs to execute a batch payout, spend beyond policy thresholds, or send when the
              Agent Allowance Pocket does not cover the amount, it generates an instant authorization
              ticket link. You confirm with your passkey, and the intent settles cleanly.
            </span>
          </li>
        </ol>
      </section>

      {/* Available MCP Tools */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">13 Autonomous MCP Tools</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Every connected AI client receives access to all 13 live MCP tools to perform autonomous financial
          operations within its authorized limits:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [
              'pay_handle',
              'Send crypto confidentially to any X handle (single or batch). Returns claim links and prefilled X post intent URLs.',
            ],
            [
              'check_approval',
              'Query the resolution status of batch payouts or passkey escalation tickets.',
            ],
            [
              'withdraw_to_wallet',
              'Withdraw funds to any external address across 35+ blockchains (Base, Solana, Ethereum, Bitcoin, etc.) or internal near.com.',
            ],
            [
              'receive_payment',
              'Show your persistent deposit address, pending incoming transfers, or shareable payment instructions.',
            ],
            [
              'get_balance',
              'Check public, confidential, pocket, and total balances for any supported asset (USDC, USDT, NEAR, ETH, SOL, BTC).',
            ],
            [
              'list_payments',
              'Audit recent sent and received payments with transaction IDs, timestamps, and settlement status.',
            ],
            [
              'resolve_handle',
              'Inspect whether an X handle has an activated UPRAIL account or routes through confidential escrow.',
            ],
            [
              'list_contacts',
              'Retrieve saved contacts ("People you pay") and frequent transfer recipients with nicknames and pinned state.',
            ],
            [
              'save_contact',
              'Save, update, or pin a trusted @handle contact with optional nickname and preferred asset/amount.',
            ],
            [
              'request_payment',
              'Create a shareable payment request asking any X @handle for funds with an optional note and expiry.',
            ],
            [
              'list_requests',
              'List incoming, outgoing, or all pending and completed payment requests.',
            ],
            [
              'accept_request',
              'Accept and settle an incoming payment request within agent spend caps.',
            ],
            [
              'decline_request',
              'Decline an incoming payment request with an optional reason.',
            ],
          ].map(([tool, detail]) => (
            <div key={tool} className="rounded-xl border border-stone-200 p-3.5 space-y-1 bg-white">
              <div className="text-xs font-mono font-bold text-stone-900">{tool}</div>
              <p className="text-xs text-stone-600 leading-relaxed">{detail}</p>
            </div>
          ))}
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">Withdrawals are irreversible:</strong> The AI agent must specify
          an explicit positive amount and destination address (optional chain slug defaults safely when inferred).
          Spending limits apply identically to payments and withdrawals, and ambiguous requests like
          &ldquo;withdraw all&rdquo; are rejected.
        </Callout>
      </section>

      {/* Client Setup Guides */}
      <section id="clients" className="scroll-mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">Client Configuration Guides</h2>
          <p className="text-sm text-stone-600 leading-relaxed">
            Choose your AI assistant below for step-by-step connection instructions:
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['#claude', 'Claude'],
            ['#chatgpt', 'ChatGPT / OpenAI Dot'],
            ['#grok', 'Grok'],
            ['#meta-muse', 'Meta Muse'],
            ['#cursor', 'Cursor / Windsurf'],
            ['#other', 'Any other MCP client'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-mono font-bold text-stone-700 transition-colors hover:border-stone-900 hover:text-stone-950"
            >
              {label}
            </a>
          ))}
        </div>

        {/* Claude */}
        <section id="claude" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">Claude</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              Custom Connector
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>Open Claude Settings &rarr; Custom Connectors.</li>
            <li>Add a custom connector named <strong>UPRAIL</strong> and paste the MCP URL.</li>
            <li>Click <strong>Connect</strong>. Claude opens UPRAIL in your browser for passkey approval.</li>
            <li>Configure your per-payment and daily spend caps, confirm with Face ID / Touch ID, and return to Claude.</li>
            <li>Start a fresh conversation and ask: &ldquo;What is my UPRAIL balance?&rdquo;</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Open Claude Connectors
            </a>
            <a href={APP_SETUP_URL} className={secondaryButtonClass}>
              Manage AI Chats
            </a>
          </div>
        </section>

        {/* ChatGPT */}
        <section id="chatgpt" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">ChatGPT / OpenAI Dot</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              OAuth 2.1
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>In ChatGPT, go to Settings &rarr; Connectors &rarr; Add custom connector.</li>
            <li>Name it <strong>UPRAIL</strong> and paste the MCP URL. Leave authentication blank.</li>
            <li>Approve the OAuth connection in your browser with your biometric passkey.</li>
            <li>Start a fresh chat with the connector enabled. OpenAI Dot inherits the connector automatically.</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={CHATGPT_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Open ChatGPT Connectors
            </a>
            <a href={APP_SETUP_URL} className={secondaryButtonClass}>
              Manage AI Chats
            </a>
          </div>
        </section>

        {/* Grok */}
        <section id="grok" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">Grok</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              Custom MCP
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>Open Grok Connectors &rarr; New Connector &rarr; Custom.</li>
            <li>Paste the MCP URL and connect.</li>
            <li>Approve the OAuth session in your browser using Face ID or Touch ID.</li>
            <li>Start a conversation and ask Grok to check balances or send crypto to an X handle.</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={GROK_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Open Grok Connectors
            </a>
            <a href={APP_SETUP_URL} className={secondaryButtonClass}>
              Manage AI Chats
            </a>
          </div>
        </section>

        {/* Meta Muse */}
        <section id="meta-muse" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">Meta Muse</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              Remote MCP
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>Open Meta Muse.</li>
            <li>Instruct Muse to add a custom remote MCP connector named UPRAIL with the MCP URL.</li>
            <li>Authenticate via the browser popup with your WebAuthn passkey.</li>
            <li>Test by asking Muse to generate a payment link or check recent payouts.</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={META_MUSE_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Open Meta Muse
            </a>
            <a href={APP_SETUP_URL} className={secondaryButtonClass}>
              Manage AI Chats
            </a>
          </div>
        </section>

        {/* Cursor / Windsurf */}
        <section id="cursor" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">Cursor / Windsurf</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              Config JSON
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>Open Cursor / Windsurf MCP Settings.</li>
            <li>Add a remote server entry or add the configuration to your project&apos;s MCP config:</li>
          </ol>
          <UrlBox
            value={JSON.stringify({ mcpServers: { uprail: { url: MCP_ENDPOINT } } }, null, 2)}
          />
          <p className="text-sm text-stone-600 leading-relaxed">
            Click Connect, complete the browser passkey challenge, and prompt Cursor directly in chat.
          </p>
        </section>

        {/* Any Other Client */}
        <section id="other" className="scroll-mt-24 rounded-2xl border border-stone-200 p-5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-stone-950">Any Other MCP Client</h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
              Streamable HTTP
            </span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
            <li>Add <span className="font-mono text-stone-900">{MCP_ENDPOINT}</span> as a Streamable HTTP MCP server.</li>
            <li>Choose OAuth if prompted for authentication method.</li>
            <li>Approve the connection and daily limit in UPRAIL.</li>
            <li>If your client only supports REST OpenAPI Actions, use the manual Bearer key flow below.</li>
          </ol>
        </section>
      </section>

      {/* Manual Bearer Keys */}
      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Manual Bearer Keys (OpenAPI Actions &amp; Headless Bots)
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Some autonomous workers, background cron jobs, or older clients cannot complete an interactive browser OAuth flow.
          For these environments, open AI Chat Payments and select <strong>Use a manual Bearer key instead</strong>.
          The secret key is displayed once, works with the REST API and OpenAPI Actions, and is bounded by the same strict USD limits.
        </p>
        <UrlBox value={OPENAPI_SPEC_URL} />
        <Callout tone="warn">
          <strong className="text-stone-900">Treat Bearer keys like cash:</strong> Anyone with the key can spend within its
          configured limits until revoked. Never commit a Bearer key to public git repositories or shared chats.
        </Callout>
      </section>

      {/* Verification & Safeguards */}
      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Testing &amp; Disconnecting</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Start with a conservative limit ($10–$50) and test with $1 first.</li>
          <li>Ask a read-only query like &ldquo;What is my UPRAIL balance?&rdquo; to verify tool discovery.</li>
          <li>Send $1 to an X handle you control to test intent signing and the 1% protocol fee (added on top from your balance so the recipient receives the full $1).</li>
          <li>Check the transaction in UPRAIL dashboard history before increasing limits.</li>
          <li>
            To disconnect, go to <strong>Connected AI Chats</strong> in the app, click <strong>Disconnect</strong>,
            and confirm with your passkey. Revocation is instantaneous.
          </li>
        </ol>
      </section>
    </article>
  );
}
