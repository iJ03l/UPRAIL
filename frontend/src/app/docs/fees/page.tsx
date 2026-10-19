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
            protocol fee), claimable with your passkey at{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world/fees">
              app.uprail.world/fees
            </a>
            .
          </li>
        </ol>
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
            claimed the moment they link their X account and passkey.
          </Field>
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">Escrow must be pre-registered.</strong> NEP-141
          transfers to an unregistered account fail on-chain. UPRAIL registers the escrow account
          against each token <em>before</em> any fee is pushed, which is why the{' '}
          <code className="font-mono text-[13px]">token.launched</code> event exists.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Integration — for launchpads
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Two ways in. The <strong className="text-stone-900">zero-integration</strong> path needs no
          key, no signing and no approval — point the token&apos;s creator fees at escrow and name the
          recipient. The <strong className="text-stone-900">signed webhook</strong> is the accelerated
          path for launchpads that want verified delivery plus pre-registration on token launch.
        </p>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Zero-integration (automatic RPC detection — no key, no txHash required)
        </h3>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Point <strong className="text-stone-900">100% of the token&apos;s creator fees</strong> at{' '}
            <code className="font-mono text-[13px]">escrow.uprail.near</code>, permanently.
          </li>
          <li>
            Put one line in the token description:{' '}
            <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code> (or pass{' '}
            <code className="font-mono text-[13px]">handle</code> once during{' '}
            <code className="font-mono text-[13px]">/api/fees/prepare</code>).
          </li>
          <li>
            Call <code className="font-mono text-[13px]">POST /api/fees/prepare</code> once (or link
            the token on{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world/fees">
              app.uprail.world/fees
            </a>
            ) to register NEP-145 storage for <code className="font-mono text-[13px]">escrow.uprail.near</code>.
            From that moment on, UPRAIL <strong className="text-stone-900">automatically detects</strong>{' '}
            every incoming token transfer to <code className="font-mono text-[13px]">escrow.uprail.near</code>{' '}
            via NEAR RPC and routes it to <code className="font-mono text-[13px]">@handle</code> — no
            per-payout API call or <code className="font-mono text-[13px]">txHash</code> required.
          </li>
        </ol>
        <Endpoint verb="POST" path="/api/fees/prepare" auth="public" />
        <Code title="prepare">{`// request — handle is optional if included in token description
{ "token": "token.near", "handle": "@creator" }

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

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Signed webhook (accelerated)
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL issues a per-launchpad{' '}
          <strong className="text-stone-900">bearer partner key</strong> and a{' '}
          <strong className="text-stone-900">webhook secret</strong>; every request carries both, and
          the secret signs the raw body so fees can&apos;t be spoofed. It also lets you pre-register
          escrow the moment a token launches. Onboarding is by request — contact the team.
        </p>

        <Endpoint verb="POST" path="/api/fees/webhook" auth="Bearer + HMAC" />
        <p className="text-sm text-stone-600 leading-relaxed">
          Headers:
        </p>
        <Code title="Headers">{`Authorization: Bearer up_lp_<partner-key>
Content-Type: application/json
X-UPRAIL-Signature: t=<unix-seconds>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>`}</Code>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">Events</h3>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="token.launched" type="pre-register">
            Fired once when a token is created. UPRAIL registers the escrow account against the
            token so later fee pushes can&apos;t race the registration.
          </Field>
          <Field name="fee.pending" type="prepare">
            Fired before a fee is pushed. UPRAIL ensures escrow is registered and returns the address
            to send to plus whether the handle routes <code className="font-mono">direct</code> or to{' '}
            <code className="font-mono">escrow</code>.
          </Field>
          <Field name="fee.paid" type="report">
            Fired after the fee has been transferred. UPRAIL verifies the on-chain transaction and
            routes the fee to the handle.
          </Field>
        </div>

        <p className="text-sm text-stone-600 leading-relaxed pt-2">
          Every event carries a unique <code className="font-mono text-[13px]">eventId</code> (for
          retries) and the token as a NEP-141 contract. A fee is only credited after its{' '}
          <code className="font-mono text-[13px]">txHash</code> is verified on-chain, and crediting
          is idempotent by that hash — safe to retry.
        </p>

        <Code title="token.launched">{`{
  "event": "token.launched",
  "eventId": "evt_001",
  "token": "token.near"
}`}</Code>
        <Code title="fee.pending">{`{
  "event": "fee.pending",
  "eventId": "evt_002",
  "token": "token.near",
  "handle": "@creator"
}`}</Code>
        <Code title="fee.paid">{`{
  "event": "fee.paid",
  "eventId": "evt_003",
  "token": "token.near",
  "handle": "@creator",
  "amount": "125.0",
  "txHash": "…",
  "memo": "creator-fees"
}`}</Code>

        <p className="text-sm text-stone-600 leading-relaxed pt-2">
          All three respond <code className="font-mono text-[13px]">202 Accepted</code>.{' '}
          <code className="font-mono text-[13px]">fee.pending</code> returns the escrow address and
          mode; <code className="font-mono text-[13px]">fee.paid</code> returns the routed payment.
        </p>
        <Code title="fee.paid → 202">{`{
  "received": true,
  "eventId": "evt_003",
  "id": "pay_…",
  "asset": "token.near",
  "amount": "125.0",
  "routing": "direct",     // or "escrow"
  "status": "CLAIMED"      // or "ESCROWED"
}`}</Code>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          REST alternative
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          Prefer request/response over events? The same two steps are exposed as plain POSTs, both
          authenticated with the bearer partner key.
        </p>
        <Endpoint verb="POST" path="/api/fees/resolve" auth="Bearer partner key" />
        <Code title="resolve">{`// request
{ "token": "token.near", "handle": "@creator" }

// response
{
  "handle": "creator",
  "token": "token.near",
  "address": "escrow.uprail.near",
  "mode": "direct",     // or "escrow"
  "registered": true,
  "feePercent": 0.05,
  "minFeeUsd": 1
}`}</Code>
        <Endpoint verb="POST" path="/api/fees/ingest" auth="Bearer partner key" />
        <Code title="ingest → 201">{`// request
{ "token": "token.near", "handle": "@creator", "amount": "125.0", "txHash": "…" }

// response
{
  "id": "pay_…",
  "handle": "creator",
  "asset": "token.near",
  "amount": "118.75",   // net of the 5% protocol fee
  "fee": "6.25",
  "routing": "direct",
  "status": "CLAIMED"
}`}</Code>

        <Callout tone="warn">
          <strong className="text-stone-900">Dust guard.</strong> A fee whose USD value is known and
          below <code className="font-mono text-[13px]">minFeeUsd</code> is held rather than settled
          immediately, so escrow gas is never spent settling dust. It stays claimable and is credited
          on the next claim.
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
          Building a launchpad? The webhook above is deliberately generic — any launchpad that can
          make a signed HTTP request and a NEP-141 transfer can integrate.
        </p>
      </section>
    </article>
  );
}
