import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

const VAULTS = [
  { symbol: 'stNEAR', name: 'Meta Pool Staked NEAR', apy: '9.2% est. APY', min: '$5' },
  { symbol: 'cNEAR', name: 'Compounding NEAR Vault', apy: '8.8% est. APY', min: '$5' },
  { symbol: 'kV-gtSOLb', name: 'Kamino Gauntlet SOL', apy: '8.1% est. APY', min: '$10' },
  { symbol: 'gtUSDCp', name: 'Gauntlet USDC Prime', apy: '7.4% est. APY', min: '$25' },
  { symbol: 'TLO', name: 'Taler USDC Vault', apy: '6.2% est. APY', min: '$10' },
  { symbol: 'wstETH', name: 'Lido Wrapped Staked ETH', apy: '3.4% est. APY', min: '$15' },
];

export default function CirclesDocsPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-600">
          Social Yield &amp; Gifting
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          How to Use Circles &amp; Vault Gifts
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Save together with friends, pool shared budgets that earn live compounding yield, or send
          timelocked Earn Vault gifts to any 𝕏 handle — all powered by NEAR Intents and gated by
          your passkey.
        </p>
      </header>

      {/* Supported Earn Vaults */}
      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Supported Earn Vaults
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Fund any Circle or Gift with USDC from your UPRAIL balance — it converts automatically
          into whichever Earn pool you pick:
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {VAULTS.map((v) => (
            <div
              key={v.symbol}
              className="p-3.5 rounded-2xl border border-stone-200 bg-white flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-display font-extrabold text-stone-950">
                  {v.symbol}
                </div>
                <div className="text-xs text-stone-500">{v.name}</div>
              </div>
              <div className="text-right font-mono">
                <div className="text-xs font-bold text-emerald-600">{v.apy}</div>
                <div className="text-[11px] text-stone-400">Min {v.min}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How to Use Circles */}
      <section id="circles" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Part 1 — How to create &amp; use a Circle
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          A Circle is a shared (or solo) Earn vault pool for rent, trips, group gifts, project
          treasuries, or personal savings goals. Every Circle gets its own isolated vault account on
          NEAR Intents.
        </p>

        <ol className="space-y-2.5 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            <strong className="text-stone-900">Open Circles:</strong> On your Dashboard (
            <a className="text-stone-900 underline" href="https://app.uprail.world">
              app.uprail.world
            </a>
            ), tap the <strong>Circles</strong> button (with the green leaf icon) right above{' '}
            <strong>Stabilize</strong>.
          </li>
          <li>
            <strong className="text-stone-900">Create your Circle:</strong> Tap{' '}
            <strong>Create Circle</strong>, enter a name (e.g. <em>Rent &amp; Housing</em> or{' '}
            <em>Tokyo Trip</em>), pick a purpose, choose an Earn Vault, and set your USD target
            goal.
          </li>
          <li>
            <strong className="text-stone-900">Choose payout &amp; contributors:</strong> Enter the{' '}
            <code className="font-mono text-[13px]">@handle</code> that will receive the payout when
            settled. Keep yourself at <strong>100%</strong> for a solo savings goal, or add friends
            with percentage splits adding up to <strong>100%</strong> and share the invite link.
          </li>
          <li>
            <strong className="text-stone-900">Add funds anytime:</strong> Tap{' '}
            <strong>Add Funds</strong> on your Circle ticket, select any asset in your UPRAIL
            balance, enter an amount at or above the vault&apos;s USD minimum, and confirm with your
            passkey. You can top up as many times as you like — shares go into the same Circle vault
            and compound automatically.
          </li>
          <li>
            <strong className="text-stone-900">Settle &amp; Payout (when ready):</strong> Only the
            Circle creator can tap <strong>Settle &amp; Payout</strong> with their passkey. This
            sends <strong>99%</strong> of the pool&apos;s live shares plus all accrued yield to the
            payout <code className="font-mono text-[13px]">@handle</code> (1% protocol fee on
            payout; payout recipient must have signed into UPRAIL at least once).
          </li>
          <li>
            <strong className="text-stone-900">Dissolve &amp; Refund (if plans change):</strong> Need
            to cancel? Every funded contributor signs <strong>Dissolve</strong> with their passkey.
            Once all have signed, UPRAIL refunds every member&apos;s exact share plus earned yield
            back to their account with <strong>0% fee</strong>.
          </li>
        </ol>

        <Callout>
          <strong className="text-stone-900">Unresponsive co-member safeguard:</strong> If someone in
          your multi-member Circle stops responding after a dissolve starts, a 7-day safeguard allows
          the Circle to dissolve and refund everyone&apos;s share pro-rata so funds never get
          stranded.
        </Callout>
      </section>

      {/* How to Gift an Earn Vault */}
      <section id="gift" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Part 2 — How to gift a Timelocked Earn Vault
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Send a birthday, Christmas, anniversary, or thank-you gift that grows with real DeFi
          yield until the day it unlocks — even if your recipient doesn&apos;t have a crypto wallet
          or UPRAIL account yet.
        </p>

        <ol className="space-y-2.5 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            <strong className="text-stone-900">Open the Gifts tab:</strong> Inside{' '}
            <strong>Circles</strong> (<code className="font-mono text-[13px]">/app/circles</code>),
            switch to the <strong>Gifts</strong> tab and tap <strong>Send Gift</strong>.
          </li>
          <li>
            <strong className="text-stone-900">Personalize the card:</strong> Type the
            recipient&apos;s <code className="font-mono text-[13px]">@handle</code>, pick an
            occasion (Birthday, Christmas, Anniversary, or Custom), write a personal note, and
            choose whether to show or hide the dollar amount before unlock.
          </li>
          <li>
            <strong className="text-stone-900">Pick a vault &amp; unlock date:</strong> Choose which
            Earn Vault they&apos;ll receive and set the exact date and time the gift unlocks.
          </li>
          <li>
            <strong className="text-stone-900">Fund &amp; lock (0% fee):</strong> Pick any asset in
            your UPRAIL balance (meeting the vault minimum) and confirm with your passkey. Your gift
            starts earning live yield inside its own dedicated custody vault immediately.
          </li>
          <li>
            <strong className="text-stone-900">Share the gift link:</strong> Copy the gift link (
            <code className="font-mono text-[13px]">uprail.world/gift/...</code>) or post directly
            to 𝕏. Your recipient sees a custom gift card counting down to unlock day.
          </li>
          <li>
            <strong className="text-stone-900">How the recipient unwraps it:</strong> Once the unlock
            date arrives, the recipient signs into UPRAIL with their matching 𝕏 handle + Passkey and
            clicks <strong>Unwrap &amp; Claim Vault + Yield</strong>. They receive{' '}
            <strong>100%</strong> of the vault shares and compounded yield straight into their
            account.
          </li>
        </ol>

        <Callout tone="warn">
          <strong className="text-stone-900">30-day recipient claim window + sender reclaim:</strong>{' '}
          The recipient has an exclusive 30-day window after the unlock date to unwrap the gift. If
          it still hasn&apos;t been claimed 30 days after unlock, a{' '}
          <strong>Reclaim Unclaimed</strong> button appears on your Sent Gift card so you can
          recover the vault shares + yield back to your account.
        </Callout>
      </section>
    </article>
  );
}
