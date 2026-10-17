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
          Launch a token on Nearly or JustHoot and point your creator fees at an X handle. UPRAIL
          routes those fees to the handle exactly like a normal send — delivered straight away if
          the handle is on UPRAIL, or escrowed until it signs up if it isn&apos;t.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">For creators</h2>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Launch your token on{' '}
            <a className="text-stone-900 underline" href="https://nearly.trade">
              Nearly
            </a>{' '}
            or{' '}
            <a className="text-stone-900 underline" href="https://justhoot.fun">
              JustHoot
            </a>
            .
          </li>
          <li>
            In the creator / fee-recipient field, enter your X handle (e.g.{' '}
            <code className="font-mono text-[13px]">@yourhandle</code>).
          </li>
          <li>
            That&apos;s it. Every creator fee the launchpad pays is routed to{' '}
            <code className="font-mono text-[13px]">@yourhandle</code> on UPRAIL.
          </li>
        </ol>
        <Callout>
          Because fees are paid in the launchpad&apos;s <strong className="text-stone-900">paired token</strong>,
          they arrive as that token. Hold it on UPRAIL or cash out to any chain from your vault.
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
            The handle has an UPRAIL identity, so the fee is delivered to its NEAR account.
          </Field>
          <Field name="unregistered handle" type="escrow">
            The handle hasn&apos;t signed up yet, so the fee is escrowed under that handle. It is
            claimed the moment they link their X account and passkey.
          </Field>
        </div>
        <p className="text-sm text-stone-600 leading-relaxed">
          Fees carry the same expiry and refund rules as any send, and no fees are taken on
          withdrawals.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Integration — for launchpads
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          A launchpad hands off each creator fee to UPRAIL with the paired token, the amount, and
          the X handle the creator nominated. UPRAIL resolves the handle and routes the fee.
        </p>
        <Endpoint verb="POST" path="/api/fees/ingest" auth="Bearer partner key" />
        <Code title="Request">{`{
  "launchpad": "nearly",
  "handle": "@creator",
  "asset": "nep141:token.near",
  "amount": "125.0",
  "txHash": "…",
  "memo": "creator-fees"
}`}</Code>
        <Code title="Response 201">{`{
  "id": "fee_…",
  "handle": "creator",
  "asset": "nep141:token.near",
  "amount": "125.0",
  "routing": "direct",     // or "escrow" when the handle is not yet on UPRAIL
  "status": "routed"
}`}</Code>
        <Callout>
          <strong className="text-stone-900">Partner keys.</strong> The ingest endpoint is
          authenticated with a per-launchpad key issued by UPRAIL; it is not a public endpoint.
          Contact the team to onboard a launchpad.
        </Callout>
      </section>

      <section className="space-y-3">
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
      </section>
    </article>
  );
}
