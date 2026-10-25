import React from 'react';
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

export default function McpDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Connect a chat
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Connect Claude, ChatGPT, Grok, Meta Muse &amp; Cursor
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL is a remote MCP server with OAuth 2.1. Add one URL to your AI chat, approve the
          connection with Face ID or fingerprint, and set per-payment and daily USD limits. There is
          no secret key to paste, and you can disconnect the app in one tap.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Before you connect</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Activate your UPRAIL account and fund the vault with the token you want to send.</li>
          <li>
            Open{' '}
            <a className="text-stone-900 underline" href={APP_SETUP_URL}>
              AI Chat Payments
            </a>{' '}
            and click <strong>Connect AI Chat</strong>.
          </li>
          <li>Keep your device passkey available. Approval uses Face ID, Touch ID, or fingerprint.</li>
          <li>Start with low limits and test with $1 before raising them.</li>
        </ol>
        <a href={APP_SETUP_URL} className={buttonClass}>
          Open AI Chat Payments
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">The only URL you need</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Add this as a custom or remote MCP connector. Leave authentication empty: your chat
          discovers the OAuth endpoints automatically.
        </p>
        <UrlBox value={MCP_ENDPOINT} />
        <Callout>
          <strong className="text-stone-900">OAuth, not a key.</strong> The app receives its own
          revocable tokens. UPRAIL never puts a spending secret in the connector URL.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">What your chat can do</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['pay_handle', 'Send to an X @handle within your USD limits.'],
            ['withdraw_to_wallet', 'Withdraw an explicit amount to a supported wallet address.'],
            ['receive_payment', 'Show your handle, pending payments, or a deposit address.'],
            ['get_balance', 'Check the available balance for one named asset.'],
            ['list_payments', 'Show your 25 most recent sent and received payments.'],
            ['resolve_handle', 'Check whether an X handle is registered on UPRAIL.'],
          ].map(([tool, detail]) => (
            <div key={tool} className="rounded-xl border border-stone-200 p-3">
              <div className="text-xs font-mono font-bold text-stone-900">{tool}</div>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed">{detail}</p>
            </div>
          ))}
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">Withdrawals are irreversible.</strong> The chat must use
          an explicit amount and the correct destination network. USD limits apply to both payments
          and withdrawals, and every connection can use every tool.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Connect in four steps</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>In your AI app, add a custom or remote MCP connector.</li>
          <li>Paste <span className="font-mono text-stone-900">{MCP_ENDPOINT}</span> and save.</li>
          <li>
            The app opens UPRAIL in your browser. Sign in, confirm with your passkey, and approve the
            per-payment and daily limits.
          </li>
          <li>
            Return to the chat and start a fresh conversation. The app now appears under{' '}
            <strong>Connected AI Chats</strong>, where you can disconnect it instantly.
          </li>
        </ol>
        <Callout>
          <strong className="text-stone-900">Recent passkey approvals:</strong> if you confirmed
          your passkey within the last five minutes, UPRAIL skips the second prompt and only asks
          you to approve the limits.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Choose your chat</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['#claude', 'Claude'],
            ['#chatgpt', 'ChatGPT / OpenAI Dot'],
            ['#grok', 'Grok'],
            ['#meta-muse', 'Meta Muse'],
            ['#cursor', 'Cursor / Windsurf'],
            ['#other', 'Any other chat'],
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
      </section>

      <section id="claude" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Claude</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open Claude&apos;s custom connectors settings.</li>
          <li>Add a custom connector named UPRAIL and paste the MCP URL.</li>
          <li>Click Connect. Claude opens UPRAIL for browser approval.</li>
          <li>Approve the limits, then enable UPRAIL in a fresh Claude conversation.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            Open Claude connectors
          </a>
          <a href={APP_SETUP_URL} className={secondaryButtonClass}>
            Open AI Chat Payments
          </a>
        </div>
      </section>

      <section id="chatgpt" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          ChatGPT / OpenAI Dot
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>In ChatGPT, go to Settings → Connectors → Add custom connector.</li>
          <li>Name it UPRAIL and paste the MCP URL. Leave authentication empty.</li>
          <li>Approve the OAuth connection in the browser.</li>
          <li>Start a fresh chat with the connector enabled.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={CHATGPT_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            Open ChatGPT connectors
          </a>
          <a href={APP_SETUP_URL} className={secondaryButtonClass}>
            Open AI Chat Payments
          </a>
        </div>
        <Callout>
          Custom connectors require a paid ChatGPT plan and the developer-mode connector setting.
          OpenAI Dot uses the same connector once it is added to your account.
        </Callout>
      </section>

      <section id="grok" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Grok</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open Grok connectors and choose New Connector → Custom.</li>
          <li>Paste the MCP URL and connect.</li>
          <li>Approve the OAuth connection in the browser.</li>
          <li>Start a fresh Grok conversation and ask for your balance.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={GROK_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            Open Grok connectors
          </a>
          <a href={APP_SETUP_URL} className={secondaryButtonClass}>
            Open AI Chat Payments
          </a>
        </div>
      </section>

      <section id="meta-muse" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Meta Muse</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open Meta Muse.</li>
          <li>Ask it to create a custom remote MCP connector named UPRAIL.</li>
          <li>Paste the MCP URL. Authentication is OAuth, not a key.</li>
          <li>Approve the browser connection and test with a balance question.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={META_MUSE_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            Open Meta Muse
          </a>
          <a href={APP_SETUP_URL} className={secondaryButtonClass}>
            Open AI Chat Payments
          </a>
        </div>
      </section>

      <section id="cursor" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Cursor / Windsurf
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open MCP settings in Cursor or Windsurf.</li>
          <li>Add a remote server named UPRAIL with the MCP URL.</li>
          <li>Approve the OAuth connection when prompted.</li>
          <li>Start a new chat and ask for your UPRAIL balance.</li>
        </ol>
        <UrlBox
          value={JSON.stringify({ mcpServers: { uprail: { url: MCP_ENDPOINT } } }, null, 2)}
        />
      </section>

      <section id="other" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Any other chat</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Add a remote MCP server with the URL above.</li>
          <li>Choose OAuth if your client asks how to authenticate.</li>
          <li>Approve the connection in UPRAIL.</li>
          <li>
            If your client only supports OpenAPI Actions, use the manual Bearer key flow described
            below.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Manual Bearer keys (OpenAPI, bots, older clients)
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Some clients cannot complete OAuth. For those, open AI Chat Payments and choose{' '}
          <strong>Use a manual Bearer key instead</strong>. The key is shown once, works with the
          REST API and OpenAPI Actions, and is still capped by the same USD limits.
        </p>
        <UrlBox value={OPENAPI_SPEC_URL} />
        <Callout tone="warn">
          <strong className="text-stone-900">Treat a Bearer key like cash.</strong> Anyone who has
          it can spend within its limits until you revoke it. Never put a Bearer key in a shared
          chat or public URL.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Disconnect or change limits
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Open AI Chat Payments and find the app under Connected AI Chats.</li>
          <li>Click Disconnect and confirm with your passkey.</li>
          <li>The app&apos;s tokens stop working immediately. Reconnecting requires a fresh approval.</li>
          <li>To change limits, disconnect and reconnect with the new amounts.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Connect, then test with $1
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Save the connector, then open a fresh conversation.</li>
          <li>Enable UPRAIL and ask a read-only question, such as “What is my UPRAIL balance?”</li>
          <li>Send $1 to a handle you control.</li>
          <li>Withdraw a small test amount to a wallet you control.</li>
          <li>Check both transactions in UPRAIL history before raising the connection limits.</li>
        </ol>
        <Callout>
          <strong className="text-stone-900">If the tools do not appear:</strong> start a fresh chat,
          confirm the connector is enabled, and check that your plan supports custom connectors. If a
          payment times out, check history before retrying.
        </Callout>
      </section>
    </article>
  );
}
