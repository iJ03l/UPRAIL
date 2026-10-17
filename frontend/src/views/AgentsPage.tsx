'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Plus,
  KeyRound,
  ShieldCheck,
  Trash2,
  Loader2,
  Copy,
  Check,
  X,
  Ban,
  Clock,
  Code2,
  AlertTriangle,
  RefreshCw,
  Zap,
  Hand,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import type { AgentKey, CreatedAgentKey, AgentApproval, AgentMode } from '../types';

const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';
const X402_ENDPOINT = 'https://api.uprail.world/api/x402/challenge';

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function policyLine(k: AgentKey): string {
  const parts: string[] = [];
  parts.push(k.asset ? `Only ${k.asset}` : 'Any asset');
  if (k.perTxLimit) parts.push(`≤ ${k.perTxLimit}/tx`);
  if (k.dailyLimit) parts.push(`≤ ${k.dailyLimit}/day`);
  if (k.allowlist?.length) parts.push(`${k.allowlist.length} allowed recipient${k.allowlist.length > 1 ? 's' : ''}`);
  else parts.push('Any recipient');
  return parts.join(' · ');
}

export const AgentsPage: React.FC = () => {
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [approvals, setApprovals] = useState<AgentApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AgentMode>('always_ask');
  const [asset, setAsset] = useState('');
  const [perTxLimit, setPerTxLimit] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [allowlist, setAllowlist] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [k, a] = await Promise.all([api.getAgentKeys(), api.getAgentApprovals()]);
      setKeys(k);
      setApprovals(a);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleCreate = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give your agent a name.');
      return;
    }
    setCreating(true);
    try {
      const assertion = await authorizeWithPasskey(`Create agent “${name.trim()}”`);
      const allow = allowlist
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.createAgentKey({
        name: name.trim(),
        mode,
        asset: asset.trim() || null,
        perTxLimit: perTxLimit.trim() || null,
        dailyLimit: dailyLimit.trim() || null,
        allowlist: allow.length ? allow : null,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        passkeyAssertion: assertion,
      });
      setCreated(res);
      setShowCreate(false);
      setName('');
      setAsset('');
      setPerTxLimit('');
      setDailyLimit('');
      setAllowlist('');
      setExpiresInDays('');
      setMode('always_ask');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create agent key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (k: AgentKey) => {
    if (!window.confirm(`Revoke “${k.name}”? Any agent using this key stops working immediately.`)) return;
    setBusyId(k.id);
    setError(null);
    try {
      const assertion = await authorizeWithPasskey(`Revoke agent “${k.name}”`);
      await api.revokeAgentKey(k.id, assertion);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke key');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecision = async (a: AgentApproval, decision: 'approve' | 'deny') => {
    setBusyId(a.id);
    setError(null);
    try {
      const label = `${decision === 'approve' ? 'Approve' : 'Deny'} ${a.payload.amount} ${a.payload.asset} to @${a.payload.recipientHandle}`;
      const assertion = await authorizeWithPasskey(label);
      await api.decideAgentApproval(a.id, decision, assertion);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to record decision');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-stone-900">
            <Bot className="w-5 h-5" />
            <h1 className="text-2xl font-display font-extrabold tracking-tight">Agents</h1>
          </div>
          <p className="mt-1 text-sm text-stone-500 max-w-xl">
            Authorize AI agents and apps to move funds from your vault under a scoped, revocable
            policy. Every payment settles through the same confidential rail as a human send.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer flex-shrink-0"
        >
          {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>{showCreate ? 'Cancel' : 'New Agent'}</span>
        </button>
      </div>

      {error && (
        <div className="flex items-start space-x-2 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="p-5 rounded-3xl bg-stone-50 border border-stone-200 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Research assistant"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Mode</span>
              <div className="grid grid-cols-2 gap-2">
                {(['always_ask', 'autonomous'] as AgentMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`py-2 rounded-xl text-xs font-mono font-bold border transition-colors cursor-pointer flex items-center justify-center space-x-1.5 ${
                      mode === m ? 'bg-black text-white border-black' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {m === 'always_ask' ? <Hand className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                    <span>{m === 'always_ask' ? 'Always Ask' : 'Autonomous'}</span>
                  </button>
                ))}
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Asset (optional)</span>
              <input
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                placeholder="USDC — blank = any asset"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Expires in days (optional)</span>
              <input
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="blank = never"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Per-transaction limit</span>
              <input
                value={perTxLimit}
                onChange={(e) => setPerTxLimit(e.target.value)}
                placeholder="e.g. 25"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">Daily limit</span>
              <input
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                placeholder="e.g. 100"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
            </label>
          </div>
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              Allowed recipients (optional)
            </span>
            <input
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              placeholder="@alice, @bob — blank = any recipient"
              className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
            />
          </label>
          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-stone-500 max-w-md">
              {mode === 'always_ask'
                ? 'Every payment waits for your on-device passkey approval.'
                : 'Payments within the limits above execute automatically; anything outside is denied.'}
            </p>
            <button
              onClick={handleCreate}
              disabled={creating || isAuthorizing}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
            >
              {creating || isAuthorizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              <span>Create with Passkey</span>
            </button>
          </div>
        </div>
      )}

      {/* Pending approvals */}
      {approvals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2 text-stone-900">
            <Clock className="w-4 h-4" />
            <h2 className="text-sm font-display font-bold uppercase tracking-wider">Pending Approvals</h2>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              {approvals.length}
            </span>
          </div>
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="p-4 rounded-2xl bg-white border border-stone-200 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-mono font-bold text-stone-950 truncate">
                    {a.payload.amount} {a.payload.asset} → @{a.payload.recipientHandle}
                  </div>
                  <div className="text-[11px] text-stone-500 font-mono truncate">
                    {a.payload.memo ? `“${a.payload.memo}” · ` : ''}expires {formatDate(a.expiresAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDecision(a, 'deny')}
                    disabled={busyId === a.id || isAuthorizing}
                    className="p-2 rounded-xl border border-stone-200 text-stone-500 hover:text-red-600 hover:border-red-200 transition-colors cursor-pointer disabled:opacity-50"
                    title="Deny"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDecision(a, 'approve')}
                    disabled={busyId === a.id || isAuthorizing}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>Approve</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900">
            <KeyRound className="w-4 h-4" />
            <h2 className="text-sm font-display font-bold uppercase tracking-wider">Agent Keys</h2>
          </div>
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center space-x-2 text-stone-400 text-sm font-mono py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading agents…</span>
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 rounded-3xl bg-stone-50 border border-dashed border-stone-200 text-center space-y-2">
            <Bot className="w-8 h-8 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500">No agents yet. Create one to let an app pay on your behalf.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => {
              const revoked = Boolean(k.revokedAt);
              const expired = k.expiresAt ? k.expiresAt < Date.now() : false;
              const dead = revoked || expired;
              return (
                <div
                  key={k.id}
                  className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                    dead ? 'bg-stone-50 border-stone-200 opacity-60' : 'bg-white border-stone-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-stone-950 truncate">{k.name}</span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                          k.mode === 'autonomous'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {k.mode === 'autonomous' ? 'AUTONOMOUS' : 'ALWAYS ASK'}
                      </span>
                      {revoked && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                          REVOKED
                        </span>
                      )}
                      {!revoked && expired && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                          EXPIRED
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-stone-500 font-mono truncate">
                      {k.keyPrefix}… · {policyLine(k)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone-400 font-mono">
                      Created {formatDate(k.createdAt)}
                      {k.lastUsedAt ? ` · Last used ${formatDate(k.lastUsedAt)}` : ' · Never used'}
                      {k.expiresAt ? ` · Expires ${formatDate(k.expiresAt)}` : ''}
                    </div>
                  </div>
                  {!dead && (
                    <button
                      onClick={() => handleRevoke(k)}
                      disabled={busyId === k.id || isAuthorizing}
                      className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-500 hover:text-red-600 hover:border-red-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
                    >
                      {busyId === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Integration docs */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-stone-900">
          <Code2 className="w-4 h-4" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wider">Connect an Agent</h2>
        </div>
        <div className="p-5 rounded-3xl bg-stone-950 text-stone-100 space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-bold">MCP endpoint (Streamable HTTP)</div>
            <CopyRow value={MCP_ENDPOINT} />
            <p className="text-xs text-stone-400 leading-relaxed">
              Point any MCP client at this URL with{' '}
              <code className="text-stone-200">Authorization: Bearer up_agent_…</code>. Tools:{' '}
              <code className="text-stone-200">pay_handle</code>,{' '}
              <code className="text-stone-200">get_balance</code>,{' '}
              <code className="text-stone-200">resolve_handle</code>,{' '}
              <code className="text-stone-200">create_payment_request</code>.
            </p>
          </div>
          <div className="space-y-2 pt-3 border-t border-stone-800">
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-bold">Charge for your API (x402 / MPP)</div>
            <CopyRow value={`POST ${X402_ENDPOINT}`} />
            <p className="text-xs text-stone-400 leading-relaxed">
              Mint a 402 payment challenge for any merchant handle, then verify and settle it once the
              payer deposits on any supported chain.
            </p>
          </div>
        </div>
      </div>

      {/* Created key modal */}
      {created && <CreatedKeyModal created={created} onClose={() => setCreated(null)} />}
    </div>
  );
};

const CopyRow: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-stone-900 border border-stone-800">
      <code className="text-xs font-mono text-stone-200 truncate">{value}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="p-1.5 rounded-lg text-stone-400 hover:text-white transition-colors cursor-pointer flex-shrink-0"
        title="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

const CreatedKeyModal: React.FC<{ created: CreatedAgentKey; onClose: () => void }> = ({ created, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 p-6 shadow-2xl space-y-4">
        <div className="flex items-center space-x-2 text-stone-900">
          <ShieldCheck className="w-5 h-5" />
          <h3 className="text-lg font-display font-extrabold">Agent key created</h3>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          Copy <strong>@{created.name}</strong>'s key now. It is shown once and cannot be recovered.
        </p>
        <div className="p-3 rounded-xl bg-stone-950 text-stone-100 font-mono text-xs break-all select-all">
          {created.key}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(created.key);
              setCopied(true);
              setAck(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy key'}</span>
          </button>
          <button
            onClick={onClose}
            disabled={!ack}
            className="flex-1 py-2.5 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            Done
          </button>
        </div>
        <div className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>This key can move funds within the policy you set. Store it somewhere safe.</span>
        </div>
      </div>
    </div>
  );
};
