import React from 'react';
import { Callout, Code, Method, Endpoint, Field } from '@/components/docs/DocsUI';
import {
  Bot,
  Key,
  ShieldCheck,
  ArrowRight,
  Zap,
  Coins,
  Users,
  Lock,
  CheckCircle2,
  Terminal,
  ExternalLink,
  ArrowDownLeft,
  ArrowUpRight,
  Cpu,
  Layers,
  Sparkles,
  Radio,
} from 'lucide-react';

export default function DocsOverviewPage() {
  return (
    <article className="space-y-12">
      {/* ── 1. Hero & Spec Header ────────────────────────────────────────── */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600 bg-orange-50 dark:bg-orange-950/40 px-2.5 py-1 rounded-full border border-orange-200 dark:border-orange-800">
            System Specification &amp; Developer Guide
          </span>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 uppercase tracking-wider">
            v2.4 Confidential Rail
          </span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-display font-black tracking-tight text-stone-950 leading-[1.08]">
          The Confidential Value Railway for 𝕏
        </h1>

        <p className="text-base sm:text-lg text-stone-600 leading-relaxed max-w-2xl font-sans">
          UPRAIL allows humans, autonomous AI agents, and launchpads to stream assets to 𝕏 identities
          on NEAR Confidential Intents. Zero onchain handle links. Zero seed phrases. 100% hardware biometric
          authorization.
        </p>

        {/* Quick Specs Pill Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-2">
          {[
            { label: 'Multi-Chain Scale', val: '35+ Blockchains' },
            { label: 'Settlement Engine', val: 'NEAR Intents' },
            { label: 'Auth Factor', val: 'FIDO2 Passkeys' },
            { label: 'Agent Protocol', val: '13 MCP Tools' },
            { label: 'Calldata Privacy', val: 'Zero Leaks' },
          ].map((pill) => (
            <div
              key={pill.label}
              className="p-3 rounded-2xl bg-stone-50 border border-stone-200 text-left space-y-0.5"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
                {pill.label}
              </div>
              <div className="text-xs font-mono font-bold text-stone-900">{pill.val}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── 2. Architectural Conduit Schematic ────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-extrabold text-stone-950 flex items-center space-x-2">
            <Layers className="w-5 h-5 text-orange-600" />
            <span>Architecture Blueprint</span>
          </h2>
          <span className="text-[11px] font-mono text-stone-400">Zero-Link Topology</span>
        </div>

        <div className="p-5 sm:p-6 rounded-3xl bg-stone-950 text-white border border-stone-800 space-y-4 font-mono text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Ingress Column */}
            <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 space-y-2">
              <div className="flex items-center justify-between text-orange-400 font-bold text-[10px] uppercase tracking-wider">
                <span>01. Ingress</span>
                <Radio className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
              </div>
              <div className="text-sm font-bold text-white font-display">Client Surfaces</div>
              <ul className="text-stone-400 space-y-1 text-[11px]">
                <li>• Web App (Touch ID / Face ID)</li>
                <li>• Autonomous AI (Claude, Grok, Cursor)</li>
                <li>• Launchpads (Nearly, JustHoot, Intear)</li>
                <li>• P2P Payment Requests</li>
              </ul>
            </div>

            {/* Privacy & Blinding Column */}
            <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 space-y-2">
              <div className="flex items-center justify-between text-emerald-400 font-bold text-[10px] uppercase tracking-wider">
                <span>02. Blinded Layer</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-white font-display">Confidential Rail</div>
              <ul className="text-stone-400 space-y-1 text-[11px]">
                <li>• Salted Handle Resolution</li>
                <li>• Calldata Blinded Transfers</li>
                <li>• Single-use WebAuthn TX nonces</li>
                <li>• Shielded Defuse Balance Vaults</li>
              </ul>
            </div>

            {/* Egress Column */}
            <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 space-y-2">
              <div className="flex items-center justify-between text-blue-400 font-bold text-[10px] uppercase tracking-wider">
                <span>03. Settlement</span>
                <Lock className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-sm font-bold text-white font-display">Egress &amp; Custody</div>
              <ul className="text-stone-400 space-y-1 text-[11px]">
                <li>• 1-Tap Biometric Claim</li>
                <li>• near.com Zero Bridge Rail</li>
                <li>• Direct Multichain Withdrawal</li>
                <li>• Voluntary Settlement Discretion</li>
              </ul>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800 text-[11px] text-stone-400 flex items-center justify-between">
            <span>Security Invariant: 𝕏 handles and personal public keys are never co-located on public blockchain state.</span>
            <span className="text-emerald-400 font-bold">100% FAIL-CLOSED</span>
          </div>
        </div>
      </section>

      {/* ── 3. The 4 Primary Rails ───────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Primary Operating Rails</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Rail 1: AI Agents */}
          <a
            href="/docs/agents"
            className="group block p-6 rounded-3xl border border-stone-200 hover:border-stone-900 transition-all space-y-3 bg-white shadow-xs hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200 uppercase tracking-wider">
                Post-Frontend Rail
              </span>
              <Bot className="w-4 h-4 text-stone-400 group-hover:text-orange-600 transition-colors" />
            </div>
            <h3 className="text-lg font-display font-extrabold text-stone-950 group-hover:text-black">
              AI Agents &amp; Model Context Protocol (MCP)
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Equip Claude, ChatGPT, Grok, Meta Muse, or Cursor with 13 financial tools via RFC 8414
              OAuth 2.1 &amp; MCP. Enable your assistant to query balances, execute confidential sends,
              request payments, and verify receipts within user-enforced cryptographic spend limits.
            </p>
            <div className="text-[11px] font-mono font-bold text-stone-500 group-hover:text-stone-900 flex items-center space-x-1 pt-1">
              <span>Explore MCP &amp; Agent guides</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </a>

          {/* Rail 2: Payment Requests */}
          <a
            href="#payment-requests"
            className="group block p-6 rounded-3xl border border-stone-200 hover:border-stone-900 transition-all space-y-3 bg-white shadow-xs hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase tracking-wider">
                Confidential P2P
              </span>
              <ArrowDownLeft className="w-4 h-4 text-stone-400 group-hover:text-emerald-600 transition-colors" />
            </div>
            <h3 className="text-lg font-display font-extrabold text-stone-950 group-hover:text-black">
              UPRAIL Payment Requests
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Request funds from any 𝕏 user—registered or new. Generates a polite shareable link and
              custom OpenGraph card. The recipient can accept and send or decline in a single biometric
              tap. No crypto wallet or seed phrase needed.
            </p>
            <div className="text-[11px] font-mono font-bold text-stone-500 group-hover:text-stone-900 flex items-center space-x-1 pt-1">
              <span>View request workflow &amp; specs</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </a>

          {/* Rail 3: near.com Sovereign Gateway */}
          <a
            href="/docs/near"
            className="group block p-6 rounded-3xl border border-stone-200 hover:border-stone-900 transition-all space-y-3 bg-white shadow-xs hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 uppercase tracking-wider">
                Sovereign Gateway
              </span>
              <Coins className="w-4 h-4 text-stone-400 group-hover:text-purple-600 transition-colors" />
            </div>
            <h3 className="text-lg font-display font-extrabold text-stone-950 group-hover:text-black">
              near.com Sovereign Rail
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Bind your personal near.com sovereign address (<code className="text-xs font-mono">nearcom:0x...</code>)
              to your passkey. Deposit and withdraw between NEAR Intents confidential balances and your
              near.com holding account with zero bridge fees.
            </p>
            <div className="text-[11px] font-mono font-bold text-stone-500 group-hover:text-stone-900 flex items-center space-x-1 pt-1">
              <span>Read near.com setup guide</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </a>

          {/* Rail 4: Launchpad Creator Fees */}
          <a
            href="/docs/fees"
            className="group block p-6 rounded-3xl border border-stone-200 hover:border-stone-900 transition-all space-y-3 bg-white shadow-xs hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 uppercase tracking-wider">
                Auto RPC Royalties
              </span>
              <Zap className="w-4 h-4 text-stone-400 group-hover:text-blue-600 transition-colors" />
            </div>
            <h3 className="text-lg font-display font-extrabold text-stone-950 group-hover:text-black">
              Launchpad Creator Fees
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Token launchpads (Nearly, JustHoot, Intear) designate 𝕏 handles as royalty recipients.
              Protocol fees are credited automatically to the creator's confidential balance, claimable
              with hardware biometrics.
            </p>
            <div className="text-[11px] font-mono font-bold text-stone-500 group-hover:text-stone-900 flex items-center space-x-1 pt-1">
              <span>Read launchpad integration specs</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </a>
        </div>
      </section>

      {/* ── 4. Deep Dive: UPRAIL Payment Requests Specification ───────────── */}
      <section id="payment-requests" className="space-y-6 pt-4 border-t border-stone-200">
        <div className="space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-600">
            Core Capability
          </div>
          <h2 className="text-2xl sm:text-3xl font-display font-black text-stone-950">
            Payment Requests: Voluntary P2P Settlement
          </h2>
          <p className="text-sm sm:text-base text-stone-600 leading-relaxed max-w-2xl">
            Payment Requests allow any user or AI agent to request money from another user through
            their 𝕏 handle. Unlike legacy crypto payment requests, UPRAIL enforces a strict voluntary
            model with zero custodial risk and complete spam prevention.
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-xs text-stone-950">Unregistered Onboarding</div>
            <p className="text-xs text-stone-600">
              Target users do not need an account to view a request. They can sign in with 𝕏 and accept
              or decline in one tap.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-xs text-stone-950">Zero Auto-Debits</div>
            <p className="text-xs text-stone-600">
              Payment is 100% voluntary. The recipient always retains full discretion with dedicated
              Accept and Decline options.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-xs text-stone-950">Anti-Spam &amp; Blocklist</div>
            <p className="text-xs text-stone-600">
              Hourly rate limits (10/hr), 24h duplicate prevention, and one-tap handle blocking ensure
              clean communication.
            </p>
          </div>
        </div>

        {/* API Endpoint Reference for Payment Requests */}
        <div className="space-y-3">
          <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-stone-900">
            Request API Endpoints
          </h3>
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 divide-y divide-stone-200/60">
            <Endpoint verb="POST" path="/api/requests" auth="Passkey Auth Required" />
            <div className="py-2 text-xs text-stone-600 space-y-1">
              <Field name="requestedHandle" type="string" required>Target 𝕏 handle without @</Field>
              <Field name="amount" type="string" required>Token amount (e.g. "10")</Field>
              <Field name="asset" type="string" required>Token symbol (e.g. "USDC", "NEAR")</Field>
              <Field name="memo" type="string">Optional reason shown to recipient (max 280 chars)</Field>
              <Field name="expiresInDays" type="number">Duration before automatic expiration (1-30 days)</Field>
            </div>

            <Endpoint verb="GET" path="/api/requests/:id" auth="Public (No Auth)" />
            <div className="py-2 text-xs text-stone-600">
              Returns request metadata, requester 𝕏 avatar, sanitized clean token amounts, and recipient registration status.
            </div>

            <Endpoint verb="POST" path="/api/requests/:id/accept" auth="Passkey Auth Required" />
            <div className="py-2 text-xs text-stone-600">
              Verifies the recipient's biometric passkey, transfers the requested amount on NEAR Intents, and marks the request completed.
            </div>

            <Endpoint verb="POST" path="/api/requests/:id/decline" auth="Session Required" />
            <div className="py-2 text-xs text-stone-600">
              Allows the recipient to decline the request with an optional memo.
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Code Quickstart: MCP, API & Passkeys ──────────────────────── */}
      <section className="space-y-4 pt-4 border-t border-stone-200">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-extrabold text-stone-950 flex items-center space-x-2">
            <Terminal className="w-5 h-5 text-stone-900" />
            <span>Developer Quickstart Snippets</span>
          </h2>
          <span className="text-[11px] font-mono text-stone-400">cURL &amp; MCP Spec</span>
        </div>

        <div className="space-y-4">
          {/* Snippet 1: AI Agent MCP Tool */}
          <Code title="1. MCP Agent Configuration (Claude / Cursor / Grok)">
{`// claude_desktop_config.json
{
  "mcpServers": {
    "uprail": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch", "https://api.uprail.world/api/mcp"]
    }
  }
}

// Available MCP Tools include:
// - uprail_request_payment: Request money from any 𝕏 handle
// - uprail_send_payment: Send confidential payment within spend limit
// - uprail_list_incoming_requests: Review pending payment requests
// - uprail_accept_payment_request: Settle a request
// - uprail_decline_payment_request: Decline an unwanted request
// - uprail_list_contacts: Retrieve "People You Pay" address book`}
          </Code>

          {/* Snippet 2: cURL Payment Request Creation */}
          <Code title="2. Create Payment Request via HTTP API">
{`curl -X POST https://api.uprail.world/api/requests \\
  -H "Content-Type: application/json" \\
  -H "Cookie: uprail_session=..." \\
  -d '{
    "requestedHandle": "alice",
    "amount": "50",
    "asset": "USDC",
    "memo": "Dinner reimbursement",
    "expiresInDays": 7,
    "passkeyAssertion": { ... }
  }'`}
          </Code>
        </div>
      </section>

      {/* ── 6. Cryptographic Invariants & Safety ─────────────────────────── */}
      <section className="space-y-4 pt-4 border-t border-stone-200">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Cryptographic Invariants &amp; Security Guarantees
        </h2>
        <div className="grid sm:grid-cols-2 gap-4 text-xs font-sans">
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-stone-900 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Zero Calldata Linkage</span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              𝕏 handles and personal public keys are never co-located on public blockchain state.
              Public block explorers cannot associate an account address with a social identity.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-stone-900 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Hardware-Backed Nonces</span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              Every fund movement requires a single-use WebAuthn challenge. Signatures are verified
              cryptographically against the device's secure enclave (Secure Processor / TPM).
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-stone-900 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Agentic Spend Caps</span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              Autonomous AI agents transacting via MCP operate under strict, user-governed USD limits.
              If an agent exceeds the threshold, the rail fails closed until authorized by biometric tap.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="font-display font-bold text-stone-900 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Deterministic Solvers</span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              All multi-chain swaps and settlements execute through decentralized Defuse solvers
              with cryptographically signed quotes, ensuring zero slippage exploits or frontrunning.
            </p>
          </div>
        </div>

        <Callout>
          <strong className="text-stone-900">Explore Further:</strong> Connect your AI assistant via{' '}
          <a className="text-stone-900 underline font-bold" href="/docs/agents">
            AI Agents &amp; MCP
          </a>
          , link your sovereign vault in the{' '}
          <a className="text-stone-900 underline font-bold" href="/docs/near">
            near.com Integration Guide
          </a>
          , or route meme royalties via{' '}
          <a className="text-stone-900 underline font-bold" href="/docs/fees">
            Creator Fees
          </a>
          .
        </Callout>
      </section>
    </article>
  );
}
