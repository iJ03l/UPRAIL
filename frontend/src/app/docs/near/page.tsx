import React from 'react';
import { Callout } from '@/components/docs/DocsUI';

export default function NearcomDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          near.com Integration
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Universal Ingress &amp; 1-Tap Internal Withdrawal to near.com
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed max-w-2xl">
          UPRAIL provides a persistent public identity layer for near.com accounts, enabling anyone
          across 35+ chains to deposit directly to your X handle without ephemeral quote sessions.
          From your UPRAIL dashboard, withdraw any Intents-supported asset directly into your
          personal near.com internal balance with zero bridge fees.
        </p>
      </header>

      {/* Why UPRAIL + near.com */}
      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Overcoming the Rotating Address Barrier
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          On <strong className="text-stone-900">near.com</strong> (and cross-chain intent protocols
          like Defuse / 1Click), cross-chain deposit addresses are ephemeral, session-bound, and
          rotating. Only the account owner sitting at the terminal can generate a temporary quote to
          fund their account. You cannot put a permanent deposit address on your social profile,
          invoice, or AI agent config.
        </p>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL maps your X handle (<code className="font-mono text-stone-900">@handle</code>) to a
          deterministic vault on NEAR Intents (<code className="font-mono text-stone-900">intents.near</code>).
          Anyone can deposit from 35+ blockchains to your public handle at any time. Once deposited,
          you can route funds straight into your personal near.com wallet in one tap.
        </p>
      </section>

      {/* How to Find Your near.com Address */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          How to Find Your near.com Internal Address
        </h2>
        <ol className="space-y-3 text-sm text-stone-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              1
            </span>
            <span>
              Go to <a href="https://near.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-stone-900 underline">near.com</a> and log in to your wallet.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              2
            </span>
            <span>
              Open your <strong>Account Menu</strong> (profile icon in the top right or sidebar).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              3
            </span>
            <span>
              Click <strong>My address</strong> to view your wallet identifiers.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-mono font-bold text-white">
              4
            </span>
            <span>
              Copy your internal address (begins with <code className="font-mono text-stone-900 font-semibold">nearcom:0x...</code>, for example <code className="font-mono text-stone-900">nearcom:0xb137a2f1054b5de422a8df801613d6722701163c</code>).
            </span>
          </li>
        </ol>

        <Callout>
          <strong className="text-stone-900">Supported Formats:</strong> UPRAIL accepts{' '}
          <code className="font-mono text-stone-900">nearcom:0x...</code>, raw{' '}
          <code className="font-mono text-stone-900">0x...</code> (40 hex characters), 64-character
          hex implicit accounts, or named <code className="font-mono text-stone-900">.near</code> accounts.
          Internal UPRAIL contract addresses (<code className="font-mono text-stone-900">escrow.uprail.near</code>,{' '}
          <code className="font-mono text-stone-900">intents.near</code>) are rejected for safety.
        </Callout>
      </section>

      {/* Step-by-Step Setup & Withdrawal */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Setting Up and Withdrawing on UPRAIL
        </h2>
        
        <div className="space-y-4 text-sm text-stone-600 leading-relaxed">
          <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2">
            <h3 className="font-display font-bold text-stone-950 text-base">
              Step 1: Click Withdraw on the Dashboard
            </h3>
            <p>
              Navigate to <a href="/app" className="text-stone-900 underline font-semibold">Dashboard</a> and click the <strong>Withdraw</strong> button (<code className="font-mono text-stone-900">near.com</code>).
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2">
            <h3 className="font-display font-bold text-stone-950 text-base">
              Step 2: First-Time Setup (Passkey Gated)
            </h3>
            <p>
              When opening Withdraw for the first time, you will be prompted to paste your <code className="font-mono text-stone-900">near.com</code> internal address.
            </p>
            <p>
              Click <strong>Save &amp; Verify with Passkey</strong> and complete the biometric prompt (Touch ID, Face ID, or Windows Hello). Your destination is cryptographically verified and bound to your account.
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2">
            <h3 className="font-display font-bold text-stone-950 text-base">
              Step 3: Choose Asset &amp; Amount
            </h3>
            <p>
              Once configured, clicking Withdraw brings up your saved destination card, one-tap asset selection for all held/popular Intents assets (<code className="font-mono text-stone-900">USDC</code>, <code className="font-mono text-stone-900">NEAR</code>, <code className="font-mono text-stone-900">USDT</code>, <code className="font-mono text-stone-900">ETH</code>, <code className="font-mono text-stone-900">BTC</code>, <code className="font-mono text-stone-900">SOL</code>), and quick amount buttons (<code className="font-mono text-stone-900">25%</code>, <code className="font-mono text-stone-900">50%</code>, <code className="font-mono text-stone-900">MAX</code>).
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2">
            <h3 className="font-display font-bold text-stone-950 text-base">
              Step 4: Review Breakdown &amp; Confirm with Passkey
            </h3>
            <p>
              Click <strong>Review Withdrawal</strong> to open the confirmation breakdown modal displaying the exact asset, amount, destination, route, and fee (<strong className="text-emerald-700">100% Sponsored / $0.00</strong>).
            </p>
            <p>
              Click <strong>Confirm with Passkey</strong> to sign the transfer. The funds are routed privately within Confidential Intents and settle into your near.com balance.
            </p>
          </div>

          <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 space-y-2">
            <h3 className="font-display font-bold text-stone-950 text-base">
              Editing Your Destination
            </h3>
            <p>
              To change your withdrawal address at any time, click the <strong>Edit</strong> button next to your saved destination. Updating your address requires a fresh passkey challenge to protect against unauthorized modification.
            </p>
          </div>
        </div>
      </section>

      {/* Technical Routing Details */}
      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Technical Settlement &amp; Privacy Rail
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Transfers to near.com internal addresses are executed directly on the confidential rail:
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-stone-600 leading-relaxed font-sans">
          <li>
            <strong className="text-stone-900">Internal NEP-518 Routing:</strong> Strips the UI scheme (<code className="font-mono text-stone-900">nearcom:</code>) and executes a 1:1 <code className="font-mono text-stone-900">CONFIDENTIAL_INTENTS</code> transfer to <code className="font-mono text-stone-900">0x...</code> — signed directly via user WebAuthn <code className="font-mono text-stone-900">prepare</code> / <code className="font-mono text-stone-900">submit</code> for Passkey Self-Custody accounts (or <code className="font-mono text-stone-900">submitPrivateTransfer</code> for server-custody accounts).
          </li>
          <li>
            <strong className="text-stone-900">Zero Bridge Fees:</strong> Because the transfer remains internal to the NEAR Intents liquidity layer, no cross-chain bridge fees or slippage occur.
          </li>
          <li>
            <strong className="text-stone-900">Automated Shortfall Shielding:</strong> If assets are held in plain or public Intents balance, shortfalls are automatically shielded before executing the confidential transfer.
          </li>
        </ul>
      </section>
    </article>
  );
}
