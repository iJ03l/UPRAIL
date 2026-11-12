import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

export default function CampaignsDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Playbook
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          How Projects Run a Campaign on UPRAIL
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          Run giveaways, community bounties, ambassador payouts, co-sponsored prize pools, or
          crowdfunded drops straight from your project&apos;s 𝕏 handle — with zero wallet collection
          spreadsheets and zero seed phrases to manage.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Step 1 — Set up your project account
        </h2>
        <ol className="space-y-2 text-sm text-stone-600 leading-relaxed list-decimal pl-5">
          <li>
            Go to{' '}
            <a className="text-stone-900 underline" href="https://app.uprail.world">
              app.uprail.world
            </a>{' '}
            and sign in with your official project 𝕏 account (e.g.{' '}
            <code className="font-mono text-[13px]">@yourproject</code>).
          </li>
          <li>
            Register your device Passkey (Face ID, Touch ID, or hardware key) when prompted and
            save your encrypted recovery codes somewhere safe.
          </li>
          <li>
            Turn on your public payment link from the Home screen if you also want fans, sponsors,
            or contributors to fund your campaign directly at{' '}
            <code className="font-mono text-[13px]">uprail.world/yourproject</code>.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Step 2 — Fund your campaign budget
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Pick whichever funding method fits your team:
        </p>
        <ul className="space-y-2 text-sm text-stone-600 leading-relaxed list-disc pl-5">
          <li>
            <strong className="text-stone-900">Deposit from any wallet:</strong> Click{' '}
            <strong>Receive</strong> and deposit USDC, USDT, NEAR, SOL, ETH, or BTC from 35+
            blockchains. You never need native NEAR for gas — UPRAIL sponsors every transaction fee.
          </li>
          <li>
            <strong className="text-stone-900">Crowdsource via a Circle:</strong> Open{' '}
            <strong>Circles</strong> and create a shared pool so partners or community sponsors
            can add funds together and earn live yield while the campaign is running.
          </li>
          <li>
            <strong className="text-stone-900">Route launchpad creator fees:</strong> Point your
            token launchpad royalties directly to{' '}
            <code className="font-mono text-[13px]">@yourproject</code> so trading fees fund your
            campaign budget automatically.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Step 3 — Choose how to distribute rewards
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          You never need to ask winners for wallet addresses in DMs. Reward people using their 𝕏
          handles across four campaign formats:
        </p>

        <div className="space-y-3">
          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <h3 className="text-base font-display font-extrabold text-stone-950">
              A. Instant Giveaways &amp; Bounties (Send to @handle)
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Open <strong>Send</strong>, type the winner&apos;s{' '}
              <code className="font-mono text-[13px]">@handle</code>, pick the token and amount, and
              confirm with your passkey. If they haven&apos;t joined UPRAIL yet, share the claim
              link publicly or by DM — they log in with 𝕏 and claim in one tap (or withdraw
              straight to any external wallet). Unclaimed prizes automatically refund to your
              project after 30 days.
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <h3 className="text-base font-display font-extrabold text-stone-950">
              B. Timelocked Prizes &amp; Holiday / Vesting Drops (Vault Gifts)
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Go to <strong>Circles → Gifts → Send Gift</strong>, choose an Earn vault (like{' '}
              <code className="font-mono text-[13px]">TLO</code>,{' '}
              <code className="font-mono text-[13px]">stNEAR</code>, or{' '}
              <code className="font-mono text-[13px]">gtUSDCp</code>), pick a future unlock date
              (for example Demo Day, a milestone date, or New Year&apos;s), and fund with{' '}
              <strong>0% gift fee</strong>. Share the live gift card link on 𝕏 — winners watch the
              prize earn yield until unlock day, and can unwrap it once the countdown ends.
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <h3 className="text-base font-display font-extrabold text-stone-950">
              C. Co-Sponsored Prize Pools &amp; Grant Rounds (Circles)
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Create a Circle on <strong>Circles → Create Circle</strong>, set a target goal and an
              Earn vault, add partner{' '}
              <code className="font-mono text-[13px]">@handles</code> with percentage splits, and
              share the invite link. Every sponsor adds their share with one passkey tap while the
              pool earns live APY. When the campaign closes, click <strong>Settle &amp; Payout</strong>{' '}
              to send the entire pool + yield straight to the winner&apos;s{' '}
              <code className="font-mono text-[13px]">@handle</code> (or <strong>Dissolve</strong>{' '}
              with contributors to refund pro-rata if cancelled).
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-1.5">
            <h3 className="text-base font-display font-extrabold text-stone-950">
              D. Request-Based Contributor Payouts
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Ask creators, moderators, or bounty hunters to open <strong>Request</strong> and send
              you a passkey-signed payment request for their milestone. Your team approves and
              settles approved requests with a single biometric tap — no manual wallet verification.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Step 4 — Optional: Let an AI agent help run payouts safely
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          If your community team uses Claude, ChatGPT, or Cursor, you can connect it under{' '}
          <strong>Agents</strong> with strict daily and per-payment USD caps approved by your
          passkey. Your assistant can pay small bounty winners automatically and queue larger
          batch prizes for one-tap Face ID approval from the founder.
        </p>
        <Callout>
          <strong className="text-stone-900">No lost campaign funds.</strong> Unclaimed instant{' '}
          <code className="font-mono text-[13px]">@handle</code> payouts return after 30 days,
          unclaimed Vault Gifts can be reclaimed by the sender 30 days after unlock, and multi-member
          Circles support pro-rata dissolve refunds back to each sponsor.
        </Callout>
      </section>
    </article>
  );
}
