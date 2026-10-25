import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

const APP_SETUP_URL = 'https://app.uprail.world/app/agents';
const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/plugins';
const GROK_CONNECTORS_URL = 'https://grok.com/connectors';
const META_MUSE_URL = 'https://muse.ai/';

const buttonClass =
  'inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-white transition-colors hover:bg-stone-800';
const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-xs font-display font-bold uppercase tracking-wider text-stone-900 transition-colors hover:border-stone-900';

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
          UPRAIL connects to your AI chat as a remote MCP connector. Create a key in the UPRAIL app,
          then follow the steps for your chat below. Claude and Cursor can open with the connection
          prefilled; other chats open the right settings page and copy what you need. The connector
          can check balances, send to X handles, generate deposit addresses, and withdraw to wallet
          addresses within your key limits.
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
            </a>
            , choose your chat, and create a key with a low per-transaction and daily USD limit.
          </li>
          <li>Confirm the key with your passkey. The secret is shown once.</li>
          <li>Use the setup action on the key screen, then test with $1 before raising limits.</li>
        </ol>
        <a href={APP_SETUP_URL} className={buttonClass}>
          Create an AI chat key
        </a>
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
          and withdrawals, and every key can use every tool.
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">Claude</h2>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700">
            Prefilled install
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create a Claude key in UPRAIL. The key screen shows an Add to Claude button.</li>
          <li>
            Click it. Claude opens the Add custom connector dialog with the UPRAIL name and URL
            already filled in.
          </li>
          <li>Review the details and click Connect.</li>
          <li>Start a fresh Claude conversation and enable UPRAIL.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={`${APP_SETUP_URL}?platform=claude`} className={buttonClass}>
            Create Claude key
          </a>
          <a
            href={CLAUDE_CONNECTORS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            Open Claude connectors
          </a>
        </div>
        <Callout>
          The install link prefills the form but never bypasses Claude&apos;s review. You still
          confirm the connector inside Claude.
        </Callout>
      </section>

      <section id="chatgpt" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">
            ChatGPT / OpenAI Dot
          </h2>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
            Manual connector
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create an OpenAI / ChatGPT key in UPRAIL.</li>
          <li>On the key screen, click Copy URL &amp; open ChatGPT connectors.</li>
          <li>In ChatGPT, go to Settings → Connectors → Add custom connector.</li>
          <li>Paste the URL from your clipboard, save, and start a fresh chat.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={`${APP_SETUP_URL}?platform=openai`} className={buttonClass}>
            Create OpenAI key
          </a>
          <a
            href={CHATGPT_CONNECTORS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            Open ChatGPT connectors
          </a>
        </div>
        <Callout>
          Custom connectors require a paid ChatGPT plan and the developer-mode connector setting.
          OpenAI Dot uses the same connector once it is added to your account.
        </Callout>
      </section>

      <section id="grok" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">Grok</h2>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
            Manual connector
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create a Grok key in UPRAIL.</li>
          <li>On the key screen, click Copy URL &amp; open Grok connectors.</li>
          <li>Choose New Connector → Custom.</li>
          <li>Paste the URL, connect, then start a fresh Grok conversation.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={`${APP_SETUP_URL}?platform=grok`} className={buttonClass}>
            Create Grok key
          </a>
          <a
            href={GROK_CONNECTORS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            Open Grok connectors
          </a>
        </div>
        <Callout>
          Grok discovers the UPRAIL tools after you connect. If your Grok workspace hides custom
          connectors, ask your workspace admin to enable them.
        </Callout>
      </section>

      <section id="meta-muse" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">Meta Muse</h2>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
            Setup prompt
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create a Meta Muse key in UPRAIL.</li>
          <li>On the key screen, click Copy setup prompt &amp; open Muse.</li>
          <li>Paste the prompt into your Muse chat and send it.</li>
          <li>Muse creates the UPRAIL custom connector. Approve it, then ask for your balance.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={`${APP_SETUP_URL}?platform=metamuse`} className={buttonClass}>
            Create Muse key
          </a>
          <a
            href={META_MUSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            Open Meta Muse
          </a>
        </div>
        <Callout>
          The prompt contains your key. Use a dedicated low-limit key for Muse, and revoke it if the
          conversation is shared.
        </Callout>
      </section>

      <section id="cursor" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-display font-extrabold text-stone-950">
            Cursor / Windsurf
          </h2>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700">
            Prefilled install
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create a Cursor key in UPRAIL.</li>
          <li>On the key screen, click Open in Cursor.</li>
          <li>Cursor prompts you to install the UPRAIL MCP server. Approve it.</li>
          <li>Start a new Cursor chat and ask for your UPRAIL balance.</li>
        </ol>
        <p className="text-sm text-stone-600 leading-relaxed">
          Windsurf users should copy the MCP config from the key screen&apos;s Advanced setup and
          add it as a remote server.
        </p>
        <a href={`${APP_SETUP_URL}?platform=cursor`} className={buttonClass}>
          Create Cursor key
        </a>
      </section>

      <section id="other" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Any other chat</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Create a key for your chat in UPRAIL.</li>
          <li>Copy the connector URL from the key screen.</li>
          <li>Add it as a remote MCP server in your chat.</li>
          <li>If your client asks for an OpenAPI Action instead, use the import URL under Advanced setup.</li>
        </ol>
        <a href={`${APP_SETUP_URL}?platform=other`} className={buttonClass}>
          Create a key for another chat
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Connect, then test with $1
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 leading-relaxed">
          <li>Save the connector in the chat, then open a fresh conversation.</li>
          <li>Enable UPRAIL and ask a read-only question, such as “What is my UPRAIL balance?”</li>
          <li>Send $1 to a handle you control.</li>
          <li>Withdraw a small test amount to a wallet you control.</li>
          <li>Check both transactions in UPRAIL history before raising the key limits.</li>
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
