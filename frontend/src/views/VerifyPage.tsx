'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldWarning,
  MagnifyingGlass,
  Key,
  CheckCircle,
  XCircle,
  ArrowSquareOut,
  Copy,
  Check,
  ArrowRight,
  Record as RecordIcon,
  Gift,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { GlitchLogo } from '../components/GlitchLogo';
import { Badge } from '../components/Badge';
import { Link, useSearchParams } from '../lib/router';
import { useToast } from '../components/Toast';
import type { ContractVerifyResponse, PublicVerifyState } from '../types';

type VerifyTab = 'account' | 'contract';
type ContractKind = 'circle' | 'gift' | 'send';

function CopyChip({ value, label }: { value: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast(label ? `${label} copied` : 'Copied', 'success');
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-mono text-stone-600 cursor-pointer shrink-0"
      title={`Copy ${label || 'value'}`}
    >
      {copied ? (
        <Check weight="bold" className="w-3 h-3 text-emerald-600" />
      ) : (
        <Copy weight="fill" className="w-3 h-3" />
      )}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function StatusRow({
  label,
  value,
  ok,
  monoValue,
}: {
  label: string;
  value: string;
  ok?: boolean;
  monoValue?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200">
      <div className="flex items-center gap-2">
        {ok === true ? (
          <CheckCircle weight="fill" className="w-4 h-4 text-emerald-600 shrink-0" />
        ) : ok === false ? (
          <XCircle weight="fill" className="w-4 h-4 text-amber-600 shrink-0" />
        ) : (
          <Key weight="fill" className="w-4 h-4 text-stone-500 shrink-0" />
        )}
        <span className="text-xs font-mono text-stone-600">{label}</span>
      </div>
      <div className="flex items-center gap-2 max-w-full">
        <span
          className={`text-xs font-mono font-bold break-all ${
            ok === true
              ? 'text-emerald-700'
              : ok === false
              ? 'text-amber-700'
              : 'text-stone-900'
          }`}
        >
          {value}
        </span>
        {monoValue && <CopyChip value={monoValue} label={label} />}
      </div>
    </div>
  );
}

function AccountVerifyPanel({ result }: { result: PublicVerifyState & Record<string, any> }) {
  const nearAccount = result.nearAccount || result.accountId || '';
  const handle = result.handle || result.uprailRecord?.xHandle;
  const custodyMode = result.custodyMode || result.uprailRecord?.custodyMode;
  const selfCustody = result.selfCustody ?? result.selfCustodyVerifiedOnchain;
  const authByPred = result.authByPredecessorId ?? result.onchain?.isAuthByPredecessorEnabled;
  const onchainPublicKeys: string[] = result.onchainPublicKeys || result.onchain?.publicKeys || [];
  const serverKeyPresent = result.serverKeyPresentOnchain;
  const serverL1KeyPresent = result.serverL1KeyPresentOnchain ?? result.onchain?.serverL1KeyPresentOnchain;
  const nearBlocksUrl = `https://nearblocks.io/address/${encodeURIComponent(nearAccount)}`;
  const isSelfVerified = selfCustody === true && serverKeyPresent === false;

  return (
    <div className="space-y-4">
      <div
        className={`p-5 rounded-2xl border ${
          isSelfVerified
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : result.error
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-stone-50 border-stone-200'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isSelfVerified
                  ? 'bg-emerald-600 text-white'
                  : 'bg-stone-900 text-white'
              }`}
            >
              {isSelfVerified ? (
                <ShieldCheck weight="fill" className="w-5 h-5" />
              ) : (
                <ShieldWarning weight="fill" className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div>
              <h2 className="text-base font-display font-extrabold text-stone-950">
                {isSelfVerified
                  ? 'Self-Custody Active & Verified On-Chain'
                  : custodyMode === 'self'
                  ? 'Self-Custody Verification Status'
                  : 'Standard Managed Account'}
              </h2>
              <p className="text-xs font-mono text-stone-600 mt-0.5 break-all">
                {handle ? `@${handle} • ` : ''}
                {nearAccount}
              </p>
            </div>
          </div>

          {nearAccount && (
            <a
              href={nearBlocksUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-stone-200 hover:bg-stone-50 text-xs font-mono font-bold text-stone-800"
            >
              <span>Inspect on NearBlocks</span>
              <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {result.error && (
          <p className="mt-3 text-xs font-mono text-amber-800 bg-white/70 border border-amber-200 rounded-xl p-2.5">
            Note: {result.error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <StatusRow
          label="UPRAIL Account (NEAR)"
          value={nearAccount}
          monoValue={nearAccount}
        />
        <StatusRow
          label="Control Mode"
          value={
            custodyMode === 'self' || selfCustody
              ? 'Passkey Self-Custody (Only your keys can sign)'
              : custodyMode === 'server'
              ? 'Standard Managed Account'
              : 'External NEAR Account'
          }
          ok={custodyMode === 'self' || selfCustody ? true : undefined}
        />
        <StatusRow
          label="UPRAIL Server Signing Key (Intents)"
          value={
            serverKeyPresent === false
              ? 'REMOVED — UPRAIL cannot move or sign Intents funds'
              : serverKeyPresent === true
              ? 'PRESENT (Managed Account / Migration Pending)'
              : 'Unavailable'
          }
          ok={
            serverKeyPresent === false
              ? true
              : serverKeyPresent === true
              ? false
              : undefined
          }
        />
        {serverL1KeyPresent !== undefined && serverL1KeyPresent !== null && (
          <StatusRow
            label="UPRAIL Server Key (Wallet L1 Sub-Account)"
            value={
              serverL1KeyPresent === false
                ? 'REMOVED — Rotated to Your Offline Recovery Key'
                : 'PRESENT (Sweeps L1 token drops only; Intents stays locked)'
            }
            ok={serverL1KeyPresent === false}
          />
        )}
        <StatusRow
          label="Account Predecessor Lock (intents.near)"
          value={
            authByPred === false
              ? 'LOCKED — Passkey or Offline Recovery Key Required'
              : authByPred === true
              ? 'UNLOCKED — Predecessor Call Allowed'
              : 'Unavailable'
          }
          ok={
            authByPred === false
              ? true
              : authByPred === true
              ? false
              : undefined
          }
        />
      </div>

      {onchainPublicKeys.length > 0 && (
        <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
              Authorized Signing Keys ({onchainPublicKeys.length})
            </h3>
          </div>
          <div className="space-y-1.5">
            {onchainPublicKeys.map((pk) => {
              const roleLabel = pk.startsWith('p256:')
                ? 'Your Passkey'
                : result.backupPubkey && pk === result.backupPubkey
                ? 'Offline Recovery Key'
                : isSelfVerified
                ? 'Recovery Key'
                : 'Managed Key';
              return (
                <div
                  key={pk}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-stone-50 border border-stone-200"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-700">
                      {roleLabel}
                    </span>
                    <span className="text-xs font-mono text-stone-800 break-all">{pk}</span>
                  </div>
                  <CopyChip value={pk} label="Public key" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result.registeredPasskeys && result.registeredPasskeys.length > 0 && (
        <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-2">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
            Registered Device Passkeys ({result.registeredPasskeys.length})
          </h3>
          <div className="space-y-1.5">
            {result.registeredPasskeys.map((pk, idx) => (
              <div
                key={`${pk.nearP256Pubkey || 'pk'}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono"
              >
                <span className="text-stone-800 break-all">
                  {pk.nearP256Pubkey || 'Pending key binding'}
                </span>
                <span className="text-[11px] text-stone-500">
                  {pk.onchainAddedAt
                    ? `Registered ${new Date(pk.onchainAddedAt).toLocaleDateString()}`
                    : 'Pending on-chain add'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContractVerifyPanel({ result }: { result: ContractVerifyResponse }) {
  const onchain = (result.onchain || null) as Record<string, any> | null;
  const config = (result.config || null) as Record<string, any> | null;
  const members = Array.isArray(onchain?.members) ? (onchain.members as Array<Record<string, any>>) : [];

  return (
    <div className="space-y-4">
      <div
        className={`p-5 rounded-2xl border ${
          result.foundOnchain
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                result.foundOnchain
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-600 text-white'
              }`}
            >
              {result.foundOnchain ? (
                <ShieldCheck weight="fill" className="w-5 h-5" />
              ) : (
                <ShieldWarning weight="fill" className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-display font-extrabold text-stone-950">
                {result.foundOnchain
                  ? `${result.kind === 'send' ? 'Unclaimed Send' : result.kind === 'gift' ? 'Vault Gift' : 'Circle'} Verified On-Chain`
                  : `No Record Found on ${result.contractId || 'circle.uprail.near'}`}
              </h2>
              <p className="text-xs font-mono text-stone-600 mt-0.5">
                ID: {result.id}
                {result.contractId ? ` • Contract: ${result.contractId}` : ''}
              </p>
            </div>
          </div>

          {result.contractId && (
            <a
              href={`https://nearblocks.io/address/${encodeURIComponent(result.contractId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-stone-200 hover:bg-stone-50 text-xs font-mono font-bold text-stone-800"
            >
              <span>Inspect Contract</span>
              <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {onchain && (
        <div className="grid grid-cols-1 gap-2.5">
          <StatusRow
            label="On-Chain Status"
            value={String(onchain.status || 'UNKNOWN')}
            ok={true}
          />
          {onchain.asset && (
            <StatusRow
              label="Bound Asset"
              value={
                onchain.asset.token_id
                  ? `intents:${onchain.asset.token_id}`
                  : `nep141:${onchain.asset.contract_id}`
              }
              monoValue={String(onchain.asset.token_id || onchain.asset.contract_id || '')}
            />
          )}
          {onchain.sender_account_id && (
            <StatusRow
              label="Sender Account & Bound Pubkey"
              value={`${onchain.sender_account_id}${
                onchain.sender_pubkey ? ` (${onchain.sender_pubkey})` : ''
              }`}
              monoValue={String(onchain.sender_pubkey || onchain.sender_account_id)}
              ok={Boolean(onchain.sender_pubkey)}
            />
          )}
          {onchain.recipient_pubkey && (
            <StatusRow
              label="Recipient Bound Pubkey"
              value={String(onchain.recipient_pubkey)}
              monoValue={String(onchain.recipient_pubkey)}
              ok={true}
            />
          )}
          {onchain.payout_account_id && (
            <StatusRow
              label="Circle Payout Account"
              value={String(onchain.payout_account_id)}
              monoValue={String(onchain.payout_account_id)}
            />
          )}
          {onchain.amount && (
            <StatusRow
              label="Escrowed Atomic Amount"
              value={String(onchain.amount)}
              monoValue={String(onchain.amount)}
            />
          )}
          {onchain.total_contributed && (
            <StatusRow
              label="Total Contributed Atomic Amount"
              value={`${onchain.total_contributed} / Target ${onchain.target_amount}`}
            />
          )}
          {typeof onchain.unlock_at_ms === 'number' && (
            <StatusRow
              label="Timelock Unlock Time"
              value={new Date(onchain.unlock_at_ms).toLocaleString()}
            />
          )}
          {typeof onchain.reclaim_after_ms === 'number' && (
            <StatusRow
              label="Sender Reclaim After"
              value={new Date(onchain.reclaim_after_ms).toLocaleString()}
            />
          )}
          {typeof onchain.refund_after_ms === 'number' && (
            <StatusRow
              label="Unclaimed Refund Deadline"
              value={new Date(onchain.refund_after_ms).toLocaleString()}
            />
          )}
        </div>
      )}

      {members.length > 0 && (
        <div className="p-4 rounded-2xl border border-stone-200 bg-white space-y-2.5">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600">
            Bound Circle Signers ({members.length})
          </h3>
          <div className="space-y-2">
            {members.map((m, idx) => (
              <div
                key={`${m.account_id}-${idx}`}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1 text-xs font-mono"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-stone-900">{String(m.account_id)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-700">
                      {(Number(m.share_bps || 0) / 100).toFixed(2)}%
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-bold ${
                        m.agreed
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                          : 'bg-amber-50 border border-amber-200 text-amber-700'
                      }`}
                    >
                      {m.agreed ? 'Joined' : 'Invited'}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-stone-500 break-all">
                  Bound Pubkey: {String(m.pubkey)}
                </div>
                <div className="text-[11px] text-stone-600">
                  Contributed: {String(m.contributed)} • Dissolve signed:{' '}
                  {m.dissolve_signed ? 'Yes' : 'No'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {config && (
        <details className="p-4 rounded-2xl border border-stone-200 bg-white">
          <summary className="text-xs font-mono font-bold uppercase tracking-wider text-stone-600 cursor-pointer">
            Contract Configuration &amp; Raw State
          </summary>
          <pre className="mt-3 p-3 rounded-xl bg-stone-950 text-stone-100 text-[11px] font-mono overflow-x-auto">
            {JSON.stringify({ contractId: result.contractId, config, onchain }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export const VerifyPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialKind = searchParams.get('kind');
  const initialId = searchParams.get('id') || '';
  const initialQ = searchParams.get('q') || '';

  const validInitialKind: ContractKind | null =
    initialKind === 'circle' || initialKind === 'gift' || initialKind === 'send'
      ? initialKind
      : null;

  const [activeTab, setActiveTab] = useState<VerifyTab>(
    validInitialKind && initialId ? 'contract' : 'account'
  );
  const [accountQuery, setAccountQuery] = useState(initialQ);
  const [contractKind, setContractKind] = useState<ContractKind>(validInitialKind || 'circle');
  const [contractId, setContractId] = useState(initialId);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountResult, setAccountResult] = useState<PublicVerifyState | null>(null);
  const [contractResult, setContractResult] = useState<ContractVerifyResponse | null>(null);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('uprail_theme');
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle(
        'dark',
        savedTheme === 'dark' || ((!savedTheme || savedTheme === 'system') && prefersDark)
      );
    } catch {}
  }, []);

  const updateUrlQuery = (params: Record<string, string>) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = new URLSearchParams(params).toString();
    window.history.replaceState({}, '', url.toString());
  };

  const runAccountLookup = useCallback(async (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.verifyPublicCustody(clean);
      setAccountResult(data);
      updateUrlQuery({ q: clean });
    } catch (err: any) {
      setAccountResult(null);
      setError(err?.message || 'Account verification lookup failed.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runContractLookup = useCallback(async (kind: ContractKind, id: string) => {
    const cleanId = id.trim();
    if (!cleanId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.verifyContractObject(kind, cleanId);
      setContractResult(data);
      updateUrlQuery({ kind, id: cleanId });
    } catch (err: any) {
      setContractResult(null);
      setError(err?.message || 'Smart contract lookup failed.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (validInitialKind && initialId) {
      void runContractLookup(validInitialKind, initialId);
    } else if (initialQ) {
      void runAccountLookup(initialQ);
    }
  }, [validInitialKind, initialId, initialQ, runContractLookup, runAccountLookup]);

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runAccountLookup(accountQuery);
  };

  const handleContractSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runContractLookup(contractKind, contractId);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col justify-between p-4 sm:p-8">
      <header className="max-w-3xl w-full mx-auto flex items-center justify-between gap-3">
        <GlitchLogo href="/app" size="md" />
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-stone-200 bg-white hover:bg-stone-100 text-xs font-mono font-bold text-stone-800 transition-colors"
        >
          <span>Open UPRAIL App</span>
          <ArrowRight weight="bold" className="w-3.5 h-3.5" />
        </Link>
      </header>

      <main className="max-w-3xl w-full mx-auto my-8 space-y-6">
        <div className="bg-white border border-stone-200 rounded-3xl shadow-sm p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <Badge tone="ok" icon={<ShieldCheck weight="fill" className="w-3 h-3" />}>
              Account &amp; Escrow Check
            </Badge>
            <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 tracking-tight">
              Verify Account Ownership &amp; Escrows
            </h1>
            <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
              Check live on NEAR that only your passkey and offline recovery key control your
              account (<code className="font-mono">intents.near</code>), or inspect any Circle,
              Vault Gift, or unclaimed transfer on <code className="font-mono">circle.uprail.near</code>.
            </p>
          </div>

          <div className="inline-flex p-1 rounded-xl bg-stone-100 border border-stone-200 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setActiveTab('account');
                setError(null);
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
                activeTab === 'account'
                  ? 'bg-stone-950 text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Account Ownership
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('contract');
                setError(null);
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
                activeTab === 'contract'
                  ? 'bg-stone-950 text-white shadow-2xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Circles, Gifts &amp; Sends
            </button>
          </div>

          {activeTab === 'account' ? (
            <form onSubmit={handleAccountSubmit} className="space-y-3">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600">
                X @handle or NEAR Account ID
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  placeholder="e.g. @xy63ry0rx or u_0a7f020b1386a20e.escrow.uprail.near"
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-stone-300 text-sm font-mono focus:outline-none focus:border-stone-900"
                />
                <button
                  type="submit"
                  disabled={isLoading || !accountQuery.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40"
                >
                  <MagnifyingGlass weight="bold" className="w-4 h-4" />
                  <span>{isLoading ? 'Checking RPC...' : 'Verify Account'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleContractSubmit} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { kind: 'circle' as const, label: 'Circle', icon: RecordIcon },
                  { kind: 'gift' as const, label: 'Earn Gift', icon: Gift },
                  { kind: 'send' as const, label: 'Send Escrow', icon: PaperPlaneTilt },
                ].map(({ kind, label, icon: Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setContractKind(kind)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-display font-bold cursor-pointer transition-all ${
                      contractKind === kind
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                        : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  placeholder={`Enter ${contractKind} ID`}
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-stone-300 text-sm font-mono focus:outline-none focus:border-stone-900"
                />
                <button
                  type="submit"
                  disabled={isLoading || !contractId.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40"
                >
                  <MagnifyingGlass weight="bold" className="w-4 h-4" />
                  <span>{isLoading ? 'Querying Contract...' : 'Verify On-Chain'}</span>
                </button>
              </div>
            </form>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-mono text-red-700">
              {error}
            </div>
          )}

          {activeTab === 'account' && accountResult && (
            <AccountVerifyPanel result={accountResult} />
          )}

          {activeTab === 'contract' && contractResult && (
            <ContractVerifyPanel result={contractResult} />
          )}
        </div>
      </main>

      <footer className="text-center text-[11px] font-mono text-stone-500">
        Powered by UPRAIL &bull; Verifiable Passkey Custody on NEAR Intents
      </footer>
    </div>
  );
};
