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
            <a className="text-stone-900 underline" href="#launchpads">
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
          <strong className="text-stone-900">Recipients are verified on-chain.</strong> UPRAIL
          reads the token&apos;s live fee recipient before accepting a handle. The caller can
          choose the handle, but never the destination wallet.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Integration — for launchpads
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          There is no partner allowlist or API key. Any launchpad can register its own tokens by
          signing a NEP-413 message from the token&apos;s <strong className="text-stone-900">parent account</strong>{' '}
          (for example <code className="font-mono text-[13px]">launchpad.justhoot.near</code> signs
          for <code className="font-mono text-[13px]">*.launchpad.justhoot.near</code>).
        </p>

        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Set the creator fee recipient to{' '}
            <code className="font-mono text-[13px]">escrow.uprail.near</code>.
          </li>
          <li>
            After the launch finalizes, build the registration payload and sign its canonical hash
            with an access key controlled by the launchpad on the token&apos;s parent account.
          </li>
          <li>
            Call <code className="font-mono text-[13px]">POST /api/launchpads/register</code>.
            UPRAIL verifies the signature, the on-chain fee recipient, and binds token → handle.
            The response includes the claim URL to show the creator.
          </li>
          <li>
            If your token contract accrues fees internally, add a generic{' '}
            <code className="font-mono text-[13px]">claim</code> config. UPRAIL claims them into
            escrow and routes them to the creator.
          </li>
          <li>
            Share the returned <code className="font-mono text-[13px]">claimUrl</code> with the
            creator. It opens their Creator fees tab and renders a personalized preview card with
            that token&apos;s pending total. Each token gets its own link and card.
          </li>
        </ol>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Fees for launchpads
        </h3>
        <div className="rounded-2xl border border-stone-200 divide-y divide-stone-200 text-sm">
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">UPRAIL protocol fee</span>
            <span className="text-stone-600">
              5% of gross routed creator fees, deducted when the fee is routed.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">What the launchpad sends</span>
            <span className="text-stone-600">
              100% of creator fees to <code className="font-mono text-[13px]">escrow.uprail.near</code>.
              Do not pre-deduct the 5%; UPRAIL deducts it once.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Gas</span>
            <span className="text-stone-600">
              Launchpads pay their normal launch and fee-transfer costs. UPRAIL escrow pays its
              own registration, claim, and routing gas.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Integration fee</span>
            <span className="text-stone-600">None.</span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Settlement asset</span>
            <span className="text-stone-600">
              The launchpad&apos;s paired token. UPRAIL does not convert it.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Dust</span>
            <span className="text-stone-600">
              Net fees below <code className="font-mono text-[13px]">$1</code> are held in escrow
              and credited later; they are not lost.
            </span>
          </div>
        </div>
        <Callout>
          <strong className="text-stone-900">Example:</strong> a 1,000 TOKEN creator fee sent to
          escrow results in 50 TOKEN of protocol fee and 950 TOKEN credited to the creator.
        </Callout>

        <Endpoint verb="GET" path="/api/launchpads/config" auth="public" />
        <Code title="config">{`{
  "escrowAccount": "escrow.uprail.near",
  "registration": {
    "method": "POST",
    "path": "/api/launchpads/register",
    "auth": "NEP-413 signature from an access key on the token parent account",
    "proofRecipient": "uprail.near",
    "proofTtlSeconds": 300
  },
  "verificationKinds": ["token_config", "factory"],
  "claimKinds": ["token_claim"]
}`}</Code>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Registration proof
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          The signed message is{' '}
          <code className="font-mono text-[13px]">
            UPRAIL launchpad registration\n&lt;sha256(canonical-json(payload))&gt;
          </code>
          , where canonical JSON sorts object keys recursively. Sign it as NEP-413 with recipient{' '}
          <code className="font-mono text-[13px]">uprail.near</code>, a 32-byte nonce, and an{' '}
          <code className="font-mono text-[13px]">issuedAt</code> within 5 minutes. The key must be
          an access key on the token&apos;s parent account; full-access and function-call keys both
          work, so use a dedicated launchpad key. Nonces are single-use for 10 minutes, so retries
          must generate a fresh nonce and signature.
        </p>
        <Code title="register">{`POST /api/launchpads/register

{
  "token": "alice.launchpad.near",
  "handle": "@alice",
  "launchpad": { "id": "custom", "name": "Custom Launchpad" },
  "verification": {
    "kind": "token_config",
    "method": "get_config",
    "paths": [["creator_id"], ["fee_to"], ["owner_id"]]
  },
  "claim": {
    "kind": "token_claim",
    "owedMethod": "get_owed_fees",
    "accountArg": "account_id",
    "owedTokenPath": ["token"],
    "owedQuotePath": ["quote"],
    "claimMethod": "claim_owed_fees",
    "quoteContract": "wrap.near"
  },
  "issuedAt": 1800000000000,
  "proof": {
    "signerId": "launchpad.near",
    "publicKey": "ed25519:…",
    "signature": "base64…",
    "nonce": "base64…",
    "recipient": "uprail.near"
  }
}

// 201
{
  "token": "alice.launchpad.near",
  "handle": "alice",
  "launchpad": "custom",
  "verifiedFeeTo": "escrow.uprail.near",
  "claimUrl": "https://app.uprail.world/claim?view=fees&handle=alice&asset=nep141:alice.launchpad.near&v=...&k=...",
  "created": true
}`}</Code>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Claim link and preview card
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          The returned link is specific to one creator handle and one token asset. Opening it
          takes them to their Creator fees tab; the same URL serves a preview card to X, Discord,
          Telegram and other link-preview crawlers. The card shows that asset&apos;s pending total
          and fee count, generated from live escrowed creator fees — so it grows as more fees for
          that token arrive. If the creator earns fees in several tokens, share each token&apos;s
          link separately so each preview shows only its own total. The{' '}
          <code className="font-mono text-[13px]">k</code>{' '}
          parameter authorizes that handle + asset preview, so share the complete URL rather than
          editing it.
        </p>
        <Callout>
          <strong className="text-stone-900">Social cache:</strong> platforms cache previews per
          exact URL. Use the latest <code className="font-mono text-[13px]">claimUrl</code> from a
          fresh registration when re-sharing after the total changes, or append a new{' '}
          <code className="font-mono text-[13px]">v</code> value to force a re-crawl.
        </Callout>

        <p className="text-sm text-stone-600 leading-relaxed">
          Verification supports two generic forms:{' '}
          <code className="font-mono text-[13px]">token_config</code> reads configured paths from
          the token contract, and <code className="font-mono text-[13px]">factory</code> looks up a
          launch id and fee recipient on a factory contract. Claim configs are optional and only
          needed when fees accrue inside the token.
        </p>

        <Endpoint verb="POST" path="/api/launchpads/claim" auth="public" />
        <Code title="claim">{`POST /api/launchpads/claim
{ "token": "alice.launchpad.near" }

// 200
{ "token": "alice.launchpad.near", "claimed": true, "pending": false, "txHash": "…" }`}</Code>

        <Callout>
          <strong className="text-stone-900">Handle corrections.</strong> A launchpad may correct a
          mistaken handle until the first fee is routed. After that, the binding is locked so an
          operator cannot redirect a creator&apos;s accrued fees.
        </Callout>

        <h3 className="text-base font-display font-extrabold text-stone-950 pt-2">
          Zero-integration fallback
        </h3>
        <p className="text-sm text-stone-600 leading-relaxed">
          A launchpad that cannot call the registration endpoint can still use the description path.
          Point creator fees at <code className="font-mono text-[13px]">escrow.uprail.near</code>,
          add <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code> to the token
          description, and call{' '}
          <code className="font-mono text-[13px]">POST /api/fees/prepare</code> once to register
          escrow storage. UPRAIL then discovers fee transfers over NEAR RPC.
        </p>
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
        <Endpoint verb="POST" path="/api/fees/route" auth="public" />

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
        <p className="text-sm text-stone-600 leading-relaxed">
          Any launchpad whose tokens are subaccounts of an account it controls can integrate. No
          deployment or allowlist change is required on UPRAIL.
        </p>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="Nearly" type="factory">
            Uses <code className="font-mono">get_launch_by_token</code> +{' '}
            <code className="font-mono">get_fee_to</code>; configure a{' '}
            <code className="font-mono">factory</code> verification.
          </Field>
          <Field name="JustHoot" type="token_config">
            Tokens live under <code className="font-mono">*.launchpad.justhoot.near</code>; configure
            a <code className="font-mono">token_config</code> verification and the generic claim
            method.
          </Field>
        </div>
        <Callout tone="warn">
          <strong className="text-stone-900">JustHoot ownership.</strong> Current JustHoot tokens
          expose the fee recipient as <code className="font-mono text-[13px]">owner_id</code>, so
          pointing fees at escrow also makes escrow the token owner. If JustHoot exposes a separate
          creator-fee field, use that instead.
        </Callout>
        <p className="text-sm text-stone-600 leading-relaxed">
          Building a launchpad? Issue tokens under your own account, point creator fees at escrow,
          and register with a signed proof. The fallback description path remains available for
          launches that already shipped.
        </p>
      </section>
    </article>
  );
}
