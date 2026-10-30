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
            The launchpad keeps its own fee receiver. When a payout is for your X handle, its
            adapter sends that fee to UPRAIL. You do not paste a wallet, and the handle does not
            have to be the launch creator.
          </li>
          <li>
            Every fee that then arrives is credited to{' '}
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
          <strong className="text-stone-900">The handle comes from the transaction.</strong> UPRAIL
          reads it from the payout memo. The API request cannot choose the handle or the
          destination wallet.
        </Callout>
        <Callout>
          <strong className="text-stone-900">Private by default.</strong> Creator fees settle over
          the same Confidential Intents rail as peer sends. If the token cannot be quoted privately,
          UPRAIL holds the fee in escrow instead of falling back to a public transfer. It is never
          paid out over a public rail.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Integration — for launchpads
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          The launchpad keeps its own fee receiver. <code className="font-mono text-[13px]">fee_to</code>{' '}
          and <code className="font-mono text-[13px]">dev_id</code> stay as they are. When a payout
          should reach an X handle, the keeper or contract uses the adapter in{' '}
          <code className="font-mono text-[13px]">adapters/launchpad</code>. There is no partner
          allowlist or API key.
        </p>

        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Send <code className="font-mono text-[13px]">ft_transfer</code> with exactly 1 yoctoNEAR
            attached. Never <code className="font-mono text-[13px]">ft_transfer_call</code>. Escrow
            is a plain account, and that call refunds.
          </li>
          <li>
            <code className="font-mono text-[13px]">receiver_id</code> is{' '}
            <code className="font-mono text-[13px]">escrow.uprail.near</code>. The memo is exactly{' '}
            <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code>.
          </li>
          <li>
            A NEAR fee is sent as wNEAR on <code className="font-mono text-[13px]">wrap.near</code>.
            A native transfer has no memo.
          </li>
          <li>
            After the transaction is final, call{' '}
            <code className="font-mono text-[13px]">POST /api/fees/adapter</code> with the hash.
            UPRAIL reads the handle from the memo, takes 5%, and credits the rest.
          </li>
        </ol>
        <Code title="adapter">{`ft_transfer on wrap.near, deposit 1 yoctoNEAR
{
  "receiver_id": "escrow.uprail.near",
  "amount": "1000000000000000000000000",
  "memo": "Fees to @alice via UPRAIL"
}

POST /api/fees/adapter
{ "txHash": "..." }

// 201
{
  "ok": true,
  "legs": [
    {
      "ok": true,
      "handle": "alice",
      "token": "wrap.near",
      "amount": "0.95",
      "fee": "0.05",
      "routing": "direct",
      "status": "CLAIMED"
    }
  ]
}`}</Code>

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
              The X-handle portion, by <code className="font-mono text-[13px]">ft_transfer</code>.
              Do not change the fee receiver, and do not pre-deduct the 5%.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Gas</span>
            <span className="text-stone-600">
              The launchpad pays the <code className="font-mono text-[13px]">ft_transfer</code>.
              UPRAIL pays the cost of crediting the handle.
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Integration fee</span>
            <span className="text-stone-600">None.</span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-stone-900">Settlement asset</span>
            <span className="text-stone-600">
              The token in the transfer. NEAR fees arrive as wNEAR. UPRAIL does not convert it.
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

        <Endpoint verb="POST" path="/api/fees/adapter" auth="public" />
        <p className="text-sm text-stone-600 leading-relaxed">
          Submitting the same hash again is a no-op. A memo that is not{' '}
          <code className="font-mono text-[13px]">Fees to @handle via UPRAIL</code> is ignored,
          including a launchpad&apos;s own role label. If the transfer never lands, nothing is
          credited: UPRAIL does not watch the launchpad&apos;s existing payout.
        </p>
        <Callout>
          <strong className="text-stone-900">Launchpads own the payout.</strong> The Creator fees
          page only receives. The adapter belongs in the launchpad keeper or contract.
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
          Nearly, JustHoot, and Intear keep their own fee receiver or DEX liquidity pools. Their keeper,
          distributor, or forwarder uses the adapter above only for the payout that should reach an X handle.
        </p>
        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="Nearly" type="keeper">
            Their keeper pays the creator with <code className="font-mono">push_creator_fees</code>,
            a native NEAR transfer. The adapter replaces that payout when the destination is an X
            handle: wrap the NEAR, <code className="font-mono">ft_transfer</code> it, then submit
            the hash. <code className="font-mono">fee_to</code> stays unchanged.
          </Field>
          <Field name="JustHoot v2" type="keeper">
            Their distributor already pays the dev in wNEAR. The adapter is that same{' '}
            <code className="font-mono">ft_transfer</code> with the UPRAIL memo instead of the dev
            account. <code className="font-mono">dev_id</code> stays unchanged.
          </Field>
          <Field name="Intear Launchpad" type="dex keeper / forwarder">
            Tokens launched under <code className="font-mono">*.launch.intear.near</code> trade on
            Intear DEX (<code className="font-mono">dex.intear.near</code>) using the Plach XYK engine.
            Trading fees accrue in the internal DEX ledger for{' '}
            <code className="font-mono">FeeReceiver::Account</code>. When claiming fees with{' '}
            <code className="font-mono">withdraw_fees</code>, forward the collected wNEAR or token
            via <code className="font-mono">ft_transfer</code> to{' '}
            <code className="font-mono">escrow.uprail.near</code> with the memo{' '}
            <code className="font-mono">Fees to @handle via UPRAIL</code>. Creator X handles are
            stored directly on-chain and verified via{' '}
            <code className="font-mono">launch.intear.near.get_launch_data</code>.
          </Field>
        </div>
      </section>
    </article>
  );
}
