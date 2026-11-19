import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

const VAULTS = [
  {
    symbol: 'gtUSDCp',
    name: 'Gauntlet USDC Prime (Morpho · Base)',
    apy: '~4.5% var. APY',
    min: '$25',
    principal: 'USD Stable',
    tier: 'Core',
  },
  {
    symbol: 'TLO',
    name: 'Taler USDC Vault (Ethereum)',
    apy: '~6.5% var. APY',
    min: '$10',
    principal: 'USD Stable',
    tier: 'Moderate',
  },
  {
    symbol: 'wstETH',
    name: 'Lido Wrapped Staked ETH (Ethereum)',
    apy: '~2.9% var. APY',
    min: '$15',
    principal: 'ETH Volatile',
    tier: 'Core Protocol',
  },
  {
    symbol: 'stNEAR',
    name: 'Meta Pool Staked NEAR (NEAR Native)',
    apy: '~4.8% var. APY',
    min: '$5',
    principal: 'NEAR Volatile',
    tier: 'Moderate',
  },
  {
    symbol: 'cNEAR',
    name: 'Assetize Compounding NEAR (NEAR Native)',
    apy: '~4.8% var. APY',
    min: '$5',
    principal: 'NEAR Volatile',
    tier: 'Elevated',
  },
  {
    symbol: 'kV-gtSOLb',
    name: 'Kamino Gauntlet SOL Balanced (Solana)',
    apy: '~4.7% var. APY',
    min: '$10',
    principal: 'SOL Volatile',
    tier: 'Elevated',
  },
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
          into whichever Earn pool you pick. Rates are <strong>variable and not guaranteed</strong>,
          and crypto-denominated vaults carry full token price volatility:
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {VAULTS.map((v) => (
            <div
              key={v.symbol}
              className="p-3.5 rounded-2xl border border-stone-200 bg-white flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-display font-extrabold text-stone-950">
                    {v.symbol}
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      v.principal === 'USD Stable'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {v.principal}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                    {v.tier}
                  </span>
                </div>
                <div className="text-xs text-stone-500 truncate mt-0.5">{v.name}</div>
              </div>
              <div className="text-right font-mono shrink-0">
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
          treasuries, or personal savings goals. Circles run in <strong>Passkey Self-Custody</strong>{' '}
          through the on-chain <code className="font-mono text-[13px]">circle.uprail.near</code>{' '}
          smart contract with signer-bound quotas.
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
            goal. (Requires Passkey Self-Custody.)
          </li>
          <li>
            <strong className="text-stone-900">Choose payout &amp; contributors:</strong> Enter the{' '}
            <code className="font-mono text-[13px]">@handle</code> that will receive the payout when
            settled. Keep yourself at <strong>100%</strong> for a solo savings goal, or add friends
            with percentage splits adding up to <strong>100%</strong> and share the invite link so
            co-members sign with their passkeys to activate the Circle.
          </li>
          <li>
            <strong className="text-stone-900">Add funds anytime (USDC, 0% entry fee):</strong>{' '}
            Tap <strong>Add Funds</strong> on your Circle ticket, choose{' '}
            <strong>USDC</strong> from your UPRAIL balance, enter an amount at or above the
            vault&apos;s USD minimum, and confirm with your passkey. If your USDC sits in
            Confidential Intents, UPRAIL swaps/unshields automatically into the Circle vault and
            compounds yield.
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
          or UPRAIL account yet. Creating a Gift requires Passkey Self-Custody and locks on{' '}
          <code className="font-mono text-[13px]">circle.uprail.near</code>.
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
            <strong className="text-stone-900">Fund &amp; lock with USDC (1% protocol fee):</strong>{' '}
            Enter a <strong>USDC</strong> amount from your UPRAIL balance (meeting the vault minimum)
            and confirm with your passkey. <strong>99%</strong> enters the compounding Earn vault on{' '}
            <code className="font-mono text-[13px]">circle.uprail.near</code> immediately after the
            1% creation fee.
          </li>
          <li>
            <strong className="text-stone-900">Share the gift link:</strong> Copy the gift link (
            <code className="font-mono text-[13px]">uprail.world/gift/...</code>) or post directly
            to 𝕏. Your recipient sees a custom gift card counting down to unlock day.
          </li>
          <li>
            <strong className="text-stone-900">How the recipient unwraps it:</strong> Once the unlock
            date arrives, the recipient signs into UPRAIL with their matching 𝕏 handle + Passkey and
            clicks <strong>Unwrap &amp; Claim to USDC</strong>. By default, UPRAIL automatically
            converts <strong>100%</strong> of the claimed vault shares and compounded yield into{' '}
            <strong>Confidential USDC</strong> straight in their account (falling back to vault
            shares only if conversion liquidity is unavailable).
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

      {/* Vault Risks, Audits & Fees */}
      <section id="risks" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Part 3 — Understanding Vault Risks, Audits &amp; Fees
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL Earn Vaults are non-custodial DeFi yield positions — not FDIC-insured bank
          accounts. Every vault is labeled across <strong>two independent dimensions</strong> so you
          can distinguish dollar price stability from protocol maturity:
        </p>

        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <div className="font-display font-extrabold text-stone-950 text-sm">
              1. Principal Stability
            </div>
            <p className="text-stone-600 leading-relaxed">
              <strong>USD Stable</strong> vaults (<code className="font-mono">gtUSDCp</code>,{' '}
              <code className="font-mono">TLO</code>) lend USDC to target dollar-denominated
              principal. <strong>Crypto Volatile</strong> vaults (
              <code className="font-mono">wstETH</code>, <code className="font-mono">stNEAR</code>,{' '}
              <code className="font-mono">cNEAR</code>, <code className="font-mono">kV-gtSOLb</code>
              ) convert your USDC into ETH, NEAR, or SOL — your USD value moves up and down with
              market prices and can end up worth less than deposited.
            </p>
          </div>
          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <div className="font-display font-extrabold text-stone-950 text-sm">
              2. Protocol &amp; Liquidity Risk Tier
            </div>
            <p className="text-stone-600 leading-relaxed">
              <strong>Core</strong> denotes deep-TVL, extensively audited protocols (Morpho Prime,
              Lido). <strong>Moderate</strong> denotes newer vaults, async redemptions, or past
              adjacent-chain incidents (Taler, Meta Pool). <strong>Elevated</strong> denotes thinner
              liquidity pools or stacked lending + volatile asset risks (Assetize cNEAR, Kamino
              Gauntlet SOL Balanced).
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2.5 text-xs text-stone-600 leading-relaxed">
          <div className="font-display font-extrabold text-stone-950 text-sm">
            The 4-Layer Risk Stack
          </div>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong className="text-stone-900">Underlying DeFi Protocol Risk:</strong> Smart
              contract bugs, lending bad debt during sharp crashes, oracle failures, validator
              slashing, or curator parameter changes. Displayed APYs are variable estimates and can
              drop (for example, NEAR staking rewards adjust downward under protocol inflation cuts
              like HSP-029).
            </li>
            <li>
              <strong className="text-stone-900">Cross-Chain Bridge &amp; Wrapper Risk:</strong>{' '}
              Non-NEAR vaults (<code className="font-mono">gtUSDCp</code>,{' '}
              <code className="font-mono">TLO</code>, <code className="font-mono">wstETH</code>,{' '}
              <code className="font-mono">kV-gtSOLb</code>) are held as bridged receipt tokens via
              NEAR Omni Bridge (<code className="font-mono">omft.near</code> /{' '}
              <code className="font-mono">omdep.near</code>) and NEAR Chain Signatures MPC.
            </li>
            <li>
              <strong className="text-stone-900">NEAR Intents &amp; 1Click Solver Liquidity:</strong>{' '}
              Entering and exiting vaults uses 1Click solver swaps rather than direct underlying
              redemption queues. During volatile markets, spreads can widen or exit quotes can be
              temporarily unavailable (unwrapping a Gift safely delivers the raw vault shares so you
              can stabilize later).
            </li>
            <li>
              <strong className="text-stone-900">
                UPRAIL Escrow Contract (<code className="font-mono">circle.uprail.near</code>):
              </strong>{' '}
              Enforces passkey-signed terms, timelocks, and quotas on-chain (verifiable at{' '}
              <code className="font-mono">/verify</code>), but is a custom Rust smart contract that
              has not yet completed an external third-party audit and currently retains an upgrade
              hook while a Full Access Key exists.
            </li>
          </ul>
        </div>

        <Callout tone="warn">
          <strong className="text-stone-900">Short-timelock fee break-even:</strong> Gifts charge a
          1% creation fee (Circles charge 1% on settlement payout, 0% on dissolve), plus 1Click
          entry/exit swap spreads. At ~4.5% variable APY, earning back a 1% fee takes roughly{' '}
          <strong>2.5–3 months</strong>. For very short lockups (a few days or weeks), fees and
          spreads will typically exceed accrued yield — consider a longer lockup or a direct Send
          instead.
        </Callout>
      </section>
    </article>
  );
}
