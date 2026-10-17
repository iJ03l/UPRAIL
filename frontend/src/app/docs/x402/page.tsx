import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function X402DocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Feature 1
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          x402 / MPP
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Charge for any resource with a standards-shaped HTTP 402. UPRAIL mints the payment
          requirement, verifies the payment, and redeems it — you never run settlement. Payments
          settle over NEAR Intents under the <code className="font-mono text-[13px]">nearintents</code>{' '}
          method, expressed in x402 v2 headers.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Endpoints</h2>
        <Endpoint verb="POST" path="/api/x402/challenge" auth="public" />
        <Endpoint verb="POST" path="/api/x402/verify" auth="public · read-only" />
        <Endpoint verb="POST" path="/api/x402/settle" auth="public · single-use" />
        <Endpoint verb="GET" path="/api/x402/demo" auth="public · example paid resource" />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">1. Mint a challenge</h2>
        <Code title="POST /api/x402/challenge">{`{
  "recipientHandle": "@merchant",
  "asset": "USDC",
  "amount": "1.00",
  "resource": "https://api.example.com/premium",
  "description": "Premium dataset"
}`}</Code>
        <p className="text-sm text-stone-600 leading-relaxed">
          The <code className="font-mono text-[13px]">201</code> response returns the requirement,
          a ready-to-send header value, and the reference the payer must echo:
        </p>
        <Code title="Response 201">{`{
  "requirement": {
    "x402Version": 2,
    "resource": { "url": "…", "description": "Premium dataset", "mimeType": "application/json" },
    "accepts": [{
      "scheme": "exact",
      "network": "near:mainnet",
      "amount": "1000000",
      "asset": "USDC",
      "payTo": "…",
      "maxTimeoutSeconds": 900,
      "extra": { "method": "nearintents", "reference": "…" }
    }]
  },
  "paymentRequiredHeader": "<base64 PaymentRequired>",
  "reference": "…",
  "rail": "remote",
  "depositAddress": "…",
  "expiresAt": 1760000000000
}`}</Code>
        <Callout>
          Returning your own 402? Set the response header{' '}
          <code className="font-mono text-[13px]">PAYMENT-REQUIRED</code> to{' '}
          <code className="font-mono text-[13px]">paymentRequiredHeader</code> and the client will
          know how to pay.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">2. Verify and settle</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Once the payer has paid, submit the payment payload. You may send the full x402 envelope,
          or a flat credential (<code className="font-mono text-[13px]">reference</code> +{' '}
          <code className="font-mono text-[13px]">txHash</code>) that UPRAIL wraps for you.
        </p>
        <Endpoint verb="POST" path="/api/x402/verify" auth="read-only, does not consume" />
        <Code title="Response">{`{
  "isValid": true,
  "payer": "…",
  "transaction": "…",
  "amount": "1.00",
  "recipient": "@merchant",
  "rail": "remote"
}`}</Code>
        <Endpoint verb="POST" path="/api/x402/settle" auth="redeems once" />
        <p className="text-sm text-stone-600 leading-relaxed">
          Settle verifies and consumes the payment. On success it returns{' '}
          <code className="font-mono text-[13px]">200</code> plus a{' '}
          <code className="font-mono text-[13px]">PAYMENT-RESPONSE</code> header; on failure it
          returns <code className="font-mono text-[13px]">402</code> with a settlement body.
        </p>
        <Code title="Response headers">{`PAYMENT-RESPONSE: <base64 SettlementResponse>`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Settlement rails</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="remote" type="1Click · preferred">
            A single-use 1Click deposit address settles into the merchant&apos;s handle on any
            supported chain. UPRAIL verifies by polling the deposit. Used when the settlement
            service is configured.
          </Field>
          <Field name="local" type="NEAR escrow · fallback">
            The payer sends NEAR (native or NEP-141) to the escrow account with the challenge
            reference as the memo, then presents {'{'} reference, txHash, sender {'}'}. UPRAIL reads
            that single transaction by hash — no indexer. Used when the settlement service is
            unavailable.
          </Field>
        </div>
        <Callout tone="warn">
          On the <strong className="text-stone-900">local</strong> rail, always set the challenge
          reference as the transfer memo. Two same-amount payments to the shared escrow account are
          otherwise indistinguishable, and a mismatched memo is rejected.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Wire headers</h2>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="PAYMENT-REQUIRED" type="server → client">
            Base64 <code className="font-mono">PaymentRequired</code>. Also mirrored as{' '}
            <code className="font-mono">WWW-Authenticate: Payment</code> for MPP clients.
          </Field>
          <Field name="PAYMENT-SIGNATURE" type="client → server">
            Base64 <code className="font-mono">PaymentPayload</code>. MPP clients may instead send{' '}
            <code className="font-mono">Authorization: Payment …</code>, which is accepted.
          </Field>
          <Field name="PAYMENT-RESPONSE" type="server → client">
            Base64 <code className="font-mono">SettlementResponse</code>, emitted on settle.
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Amounts</h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Supply a human-readable <code className="font-mono text-[13px]">amount</code>; UPRAIL
          converts it to atomic units using the asset&apos;s decimals (NEAR 24, USDC/USDT 6, ETH/DAI
          18, BTC 8). Unknown assets default to 6 decimals — pass a symbol or{' '}
          <code className="font-mono text-[13px]">nep141:</code> contract for an exact scale.
        </p>
      </section>
    </article>
  );
}
