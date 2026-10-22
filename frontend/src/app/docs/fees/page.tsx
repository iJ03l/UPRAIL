import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function FeesDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Feature 2
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Creator fees
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Launchpads pay their creators in the launchpad&apos;s paired token. Point those fees at an
          X handle instead of a raw wallet: UPRAIL routes each fee to the handle exactly like a
          normal send — delivered straight away if the handle is on UPRAIL, or escrowed under the
          handle until it signs up.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">For creators</h2>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Launch your token on a supported launchpad (see{' '}
            <a className="text-stone-900 underline" href="https://docs.uprail.world/fees#launchpads">
              below
            </a>
            ).
          </li>
          <li>
            In the creator / fee-recipient field, enter your X handle (e.g.{' '}
            <code className="font-mono text-[13px]">@yourhandle</code>).
          </li>
          <li>
            That&apos;s it. Every creator fee the launchpad pays is credited to{' '}
            <code className="font-mono text-[13px]">@yourhandle</code> on UPRAIL (net of the 5%
            protocol fee), ready to collect with your passkey at{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world/claim?view=fees">
              Creator fees in your UPRAIL account
            </a>
            .
          </li>
        </ol>
        <Callout>
          <strong className="text-stone-900">Receiving is passive.</strong> The Creator fees tab
          only lists fees a launchpad has already sent to your handle. You never paste a token
          contract, copy an escrow address, or run a sync from that page.
        </Callout>
        <Callout>
          Because fees are paid in the launchpad&apos;s <strong className="text-stone-900">paired token</strong>,
          they arrive as that token. The standard <strong className="text-stone-900">5% protocol fee</strong>{' '}
          is carved out at source, exactly like a peer send; the rest is yours to hold on UPRAIL or
          cash out to any chain from your vault.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">How routing works</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Routing reuses the same primitive as <code className="font-mono text-[13px]">send</code>.
          The recipient is always an X handle, never a raw address:
        </p>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="registered handle" type="direct">
            The handle has an UPRAIL identity, so the fee is credited to its account instantly.
          </Field>
          <Field name="unregistered handle" type="escrow">
            The handle hasn&apos;t signed up yet, so the fee is escrowed under that handle. It is
            received the moment they link their X account and passkey.
          </Field>
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">Escrow must be pre-registered.</strong> NEP-141
          transfers to an unregistered account fail on-chain. UPRAIL registers the escrow account
          against each token <em>before</em> any fee is pushed, which is why{' '}
          <code className="font-mono text-[13px]">POST /api/fees/prepare</code> exists.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Integration — for launchpads
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          There is one path: <strong className="text-stone-900">zero-integration</strong>. No API
          key, signing, or approval is required — point the token&apos;s creator fees at escrow and
          name the recipient in the token description.
        </p>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Automatic RPC detection — no key, no txHash required
        </h3>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Point <strong className="text-stone-900">100% of the token&apos;s creator fees</strong> at{' '}
            <code className="font-mono text-[13px]">escrow.uprail.near</code>, permanently.
          </li>
          <li>
            Put one line in the token description:{' '}
            <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code>. This is the
            only recipient source; UPRAIL never accepts a caller-supplied handle.
          </li>
          <li>
            Call <code className="font-mono text-[13px]">POST /api/fees/prepare</code> once to
            register NEP-145 storage for <code className="font-mono text-[13px]">escrow.uprail.near</code>.
            From that moment on, UPRAIL <strong className="text-stone-900">automatically detects</strong>{' '}
            every incoming token transfer to <code className="font-mono text-[13px]">escrow.uprail.near</code>{' '}
            via NEAR RPC and routes it to <code className="font-mono text-[13px]">@handle</code> — no
            per-payout API call or <code className="font-mono text-[13px]">txHash</code> required.
          </li>
        </ol>
        <Endpoint verb="POST" path="/api/fees/prepare" auth="public" />
        <Code title="prepare">{`// request — the recipient comes from the token description
{ "token": "token.near" }

// response
{
  "token": "token.near",
  "handle": "creator",
  "address": "escrow.uprail.near",
  "registered": true,
  "autoSync": true,
  "feePercent": 0.05,
  "minFeeUsd": 1
}`}</Code>
        <Endpoint verb="POST" path="/api/fees/sync" auth="public" />
        <Code title="sync (optional instant trigger)">{`// request — omit txHash; UPRAIL reads escrow's live on-chain balance via RPC
{ "token": "token.near" }

// response
{
  "ok": true,
  "synced": true,
  "token": "token.near",
  "handle": "creator",
  "id": "fee_…",
  "asset": "nep141:token.near",
  "amount": "118.75",   // net of the 5% protocol fee
  "fee": "6.25",
  "routing": "direct",  // or "escrow"
  "status": "CLAIMED"
}`}</Code>
        <Endpoint verb="POST" path="/api/fees/route" auth="public" />
        <Code title="route → 201 (txHash optional)">{`// request — txHash is optional; omit it to auto-sync live RPC balance delta
{ "token": "token.near", "txHash": "…" }

// response
{
  "id": "fee_…",
  "handle": "creator",
  "asset": "nep141:token.near",
  "amount": "118.75",   // net of the 5% protocol fee
  "fee": "6.25",
  "routing": "direct",  // or "escrow"
  "status": "CLAIMED"
}`}</Code>

        <Callout>
          <strong className="text-stone-900">Launchpads own the setup.</strong> The claim page is
          receiver-only. Integration belongs in the launch flow or backend, not in a receiver&apos;s
          wallet.
        </Callout>

        <Callout tone="warn">
          <strong className="text-stone-900">Dust guard.</strong> A fee whose USD value is known and
          below <code className="font-mono text-[13px]">minFeeUsd</code> is held rather than settled
          immediately, so escrow gas is never spent settling dust. It stays available and is credited
          the next time you collect.
        </Callout>
      </section>

      <section id="launchpads" className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Supported launchpads</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="Nearly" type="nearly.trade">
            NEAR-native launchpad. Creator fees are paid in the paired token and split between the
            creator and referral.
          </Field>
          <Field name="JustHoot" type="justhoot.fun">
            NEAR-native launchpad. Tokens live under{' '}
            <code className="font-mono">*.launchpad.justhoot.near</code>; creator rewards accrue to
            the nominated recipient.
          </Field>
        </div>
        <p className="text-sm text-stone-600 leading-relaxed">
          Building a launchpad? No API integration is needed — pay creator fees to{' '}
          <code className="font-mono text-[13px]">escrow.uprail.near</code> and put{' '}
          <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code> in the token
          description. When a creator picks an X account as the fee recipient, record that handle
          there so UPRAIL can verify it on-chain.
        </p>
      </section>
    </article>
  );
}
