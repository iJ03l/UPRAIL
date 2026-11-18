import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function CoffeeDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Feature 3
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Buy Me a Coffee
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Give supporters and AI agents a single public link —{' '}
          <code className="font-mono text-[13px]">uprail.world/&lt;handle&gt;</code> — to send
          one-time tips from 35+ blockchains with zero login or UPRAIL account. Contributions settle
          into your private UPRAIL vault net of a 1% protocol fee.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">For creators</h2>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Sign in at{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world">
              app.uprail.world
            </a>{' '}
            and open the Buy Me a Coffee modal from the coin-pouch button in your Home Balance card.
          </li>
          <li>
            Toggle your public link on with one passkey verification (
            <code className="font-mono text-[13px]">POST /api/coffee/toggle</code>).
          </li>
          <li>
            Share <code className="font-mono text-[13px]">uprail.world/yourhandle</code> in your 𝕏
            bio, README, or livestream. You can pause or re-enable it anytime.
          </li>
        </ol>
        <Callout>
          <strong className="text-stone-900">No wallet address on your profile.</strong> Supporters
          never see your underlying NEAR vault or custodian address. Each tip generates a fresh,
          single-use 1Click deposit address that expires automatically after 2 hours if unused.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Token-first quoting &amp; FLEX_INPUT
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Contributors pick their asset first and enter exact token quantities directly (for
          example, <code className="font-mono text-[13px]">1 NEAR</code>,{' '}
          <code className="font-mono text-[13px]">5 USDC</code>, or{' '}
          <code className="font-mono text-[13px]">0.02 SOL</code>) instead of rounding awkward
          USD-converted decimals. The quote engine uses{' '}
          <code className="font-mono text-[13px]">FLEX_INPUT</code>:
        </p>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="amountToken" type="string | number">
            Preferred native token amount sent by the contributor (e.g.{' '}
            <code className="font-mono text-[12px]">&quot;1&quot;</code> for 1 NEAR). Enforces at
            least $1.00 USD equivalent.
          </Field>
          <Field name="amountUsd" type="number">
            Optional USD equivalent ($1–$10,000) used when <code className="font-mono text-[12px]">amountToken</code> is omitted (kept for automated agent callers).
          </Field>
          <Field name="FLEX_INPUT" type="quote mode">
            Accepts up to ~3% input variance (<code className="font-mono text-[12px]">minAmountIn</code>)
            so native L1 sweep deductions (such as NEAR&apos;s ~0.000495 NEAR implicit-account storage
            &amp; gas fee) settle cleanly instead of stalling in{' '}
            <code className="font-mono text-[12px]">INCOMPLETE_DEPOSIT</code>.
          </Field>
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">1% protocol fee · 99% to creator.</strong> Quotes
          settle in <code className="font-mono text-[13px]">USDC</code> (or{' '}
          <code className="font-mono text-[13px]">USDT</code> when tipping in USDT). If a deposit
          still arrives below the minimum threshold after the deadline, 1Click refunds it per the
          quote&apos;s refund path.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          For AI agents &amp; scripts (<code className="font-mono text-[16px]">uprail-coffee-v1</code>)
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Every active <code className="font-mono text-[13px]">uprail.world/&lt;handle&gt;</code>{' '}
          page is machine-readable with zero API key or OAuth required:
        </p>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Discover profile &amp; accepted tokens via{' '}
            <code className="font-mono text-[13px]">GET https://uprail.world/&lt;handle&gt;?format=json</code>{' '}
            (or send <code className="font-mono text-[13px]">Accept: application/json</code> /{' '}
            <code className="font-mono text-[13px]">Accept: text/markdown</code>). Global agent spec
            lives at{' '}
            <a className="text-stone-900 underline" href="https://uprail.world/llms.txt">
              uprail.world/llms.txt
            </a>
            .
          </li>
          <li>
            Request an ephemeral deposit address by{' '}
            <code className="font-mono text-[13px]">POST</code>ing directly to{' '}
            <code className="font-mono text-[13px]">https://uprail.world/&lt;handle&gt;</code> (or{' '}
            <code className="font-mono text-[13px]">https://api.uprail.world/api/coffee/donate</code>
            ).
          </li>
          <li>
            Send <code className="font-mono text-[13px]">amountToSend</code> on{' '}
            <code className="font-mono text-[13px]">originChain</code> to{' '}
            <code className="font-mono text-[13px]">depositAddress</code> (include{' '}
            <code className="font-mono text-[13px]">depositMemo</code> if returned), then poll{' '}
            <code className="font-mono text-[13px]">statusUrl</code> until{' '}
            <code className="font-mono text-[13px]">status === &quot;COMPLETED&quot;</code>.
          </li>
        </ol>

        <Code title="Create a one-time coffee deposit address (no auth)">
{`curl -sS -X POST https://uprail.world/uprailworld \\
  -H "Content-Type: application/json" \\
  -d '{
    "amountToken": "1",
    "originSymbol": "NEAR",
    "originChain": "near"
  }'

# Poll until COMPLETED:
curl -sS https://api.uprail.world/api/coffee/status/<donation_id>`}
        </Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">API reference</h2>
        <div className="rounded-2xl border border-stone-200 px-4 divide-y divide-stone-200/70">
          <div className="py-2">
            <Endpoint verb="GET" path="/api/coffee/me" auth="Session cookie" />
            <p className="text-xs text-stone-600 pb-2">
              Returns current creator toggle state, share URL, and recent completed coffee tips.
            </p>
          </div>
          <div className="py-2">
            <Endpoint verb="POST" path="/api/coffee/toggle" auth="Passkey Auth Required" />
            <p className="text-xs text-stone-600 pb-2">
              Enables or pauses <code className="font-mono text-[12px]">uprail.world/&lt;handle&gt;</code>. Accepts optional <code className="font-mono text-[12px]">{`{ "enabled": boolean }`}</code>.
            </p>
          </div>
          <div className="py-2">
            <Endpoint verb="GET" path="/api/coffee/profile/:handle" auth="Public" />
            <p className="text-xs text-stone-600 pb-2">
              Returns creator display info, <code className="font-mono text-[12px]">enabled</code> flag, and <code className="font-mono text-[12px]">uprail-coffee-v1</code> agent endpoints.
            </p>
          </div>
          <div className="py-2">
            <Endpoint verb="GET" path="/api/coffee/options" auth="Public" />
            <p className="text-xs text-stone-600 pb-2">
              Lists live supported origin tokens (USDC &amp; USDT pinned first) and chains with USD reference prices.
            </p>
          </div>
          <div className="py-2">
            <Endpoint verb="POST" path="/api/coffee/donate" auth="Public (30/min)" />
            <div className="text-xs text-stone-600 space-y-1 pb-2">
              <Field name="handle" type="string" required>Creator 𝕏 handle (without @)</Field>
              <Field name="amountToken" type="string | number">Exact token amount to send (e.g. &quot;1&quot;)</Field>
              <Field name="amountUsd" type="number">Alternative USD amount ($1–$10,000) when amountToken is omitted</Field>
              <Field name="originSymbol" type="string" required>Token symbol (e.g. &quot;NEAR&quot;, &quot;USDC&quot;, &quot;SOL&quot;)</Field>
              <Field name="originChain" type="string" required>Origin chain slug (e.g. &quot;near&quot;, &quot;base&quot;, &quot;sol&quot;)</Field>
              <Field name="originAsset" type="string">Optional explicit 1Click assetId override</Field>
              <Field name="targetSymbol" type="'USDC' | 'USDT'">Optional destination stablecoin preference</Field>
            </div>
          </div>
          <div className="py-2">
            <Endpoint verb="GET" path="/api/coffee/status/:id" auth="Public (120/min)" />
            <p className="text-xs text-stone-600 pb-2">
              Polls deposit progress (<code className="font-mono text-[12px]">WAITING_DEPOSIT</code>,{' '}
              <code className="font-mono text-[12px]">INCOMPLETE_DEPOSIT</code>,{' '}
              <code className="font-mono text-[12px]">PROCESSING</code>,{' '}
              <code className="font-mono text-[12px]">SETTLING</code>,{' '}
              <code className="font-mono text-[12px]">COMPLETED</code>,{' '}
              <code className="font-mono text-[12px]">EXPIRED</code>,{' '}
              <code className="font-mono text-[12px]">FAILED</code> — covering failed or refunded upstream swaps) and settles 99% to the creator privately once swap confirms.
            </p>
          </div>
          <div className="py-2">
            <Endpoint verb="POST" path="https://uprail.world/:handle" auth="Public (30/min)" />
            <p className="text-xs text-stone-600 pb-2">
              Direct agent shortcut accepting JSON (<code className="font-mono text-[12px]">amountToken</code> or <code className="font-mono text-[12px]">amountUsd</code>, <code className="font-mono text-[12px]">originSymbol</code>, <code className="font-mono text-[12px]">originChain</code>) and returning payment instructions + <code className="font-mono text-[12px]">statusUrl</code>.
            </p>
          </div>
        </div>
      </section>
    </article>
  );
}
