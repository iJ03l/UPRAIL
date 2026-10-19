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
  Code2,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Sparkles,
  Terminal,
  Globe,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import type { AgentKey, CreatedAgentKey } from '../types';

const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';
const OPENAPI_SPEC_URL = 'https://api.uprail.world/api/agent/openapi.json';

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ChatPlatform {
  id: 'claude' | 'chatgpt' | 'cursor' | 'other';
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultName: string;
}

const CHAT_PLATFORMS: ChatPlatform[] = [
  {
    id: 'claude',
    label: 'Claude',
    blurb: 'Claude Desktop, Web & Mobile via MCP',
    icon: Sparkles,
    defaultName: 'Claude',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    blurb: 'ChatGPT Actions (OpenAPI) or MCP',
    icon: MessageSquare,
    defaultName: 'ChatGPT',
  },
  {
    id: 'cursor',
    label: 'Cursor / Windsurf',
    blurb: 'Pay & check balance from your IDE chat',
    icon: Terminal,
    defaultName: 'Cursor',
  },
  {
    id: 'other',
    label: 'Any Other AI Chat',
    blurb: 'Works with any MCP or REST AI assistant',
    icon: Globe,
    defaultName: 'My AI Chat',
  },
];

function buildMcpJson(apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        uprail: {
          url: MCP_ENDPOINT,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      },
    },
    null,
    2
  );
}

export const AgentsPage: React.FC = () => {
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [guideTab, setGuideTab] = useState<'mcp' | 'chatgpt'>('mcp');

  // Create form state
  const [selectedPlatform, setSelectedPlatform] = useState<ChatPlatform['id']>('claude');
  const [name, setName] = useState('Claude');
  const [perTxLimit, setPerTxLimit] = useState('25');
  const [dailyLimit, setDailyLimit] = useState('100');
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [creating, setCreating] = useState(false);

  const selectPlatform = (p: ChatPlatform) => {
    setSelectedPlatform(p.id);
    setName(p.defaultName);
    if (p.id === 'chatgpt') setGuideTab('chatgpt');
    else setGuideTab('mcp');
  };

  const refresh = useCallback(async () => {
    try {
      const k = await api.getAgentKeys();
      setKeys(k);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load AI chat keys');
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give your AI chat connection a name (e.g. Claude or ChatGPT).');
      return;
    }
    const perTxNum = parseFloat(perTxLimit);
    const dailyNum = parseFloat(dailyLimit);
    if (!Number.isFinite(perTxNum) || perTxNum <= 0 || !Number.isFinite(dailyNum) || dailyNum <= 0) {
      setError('Enter positive USD limits for both per-payment and daily spend.');
      return;
    }
    if (perTxNum > dailyNum) {
      setError('Max per payment cannot exceed your daily spend limit.');
      return;
    }

    setCreating(true);
    try {
      const assertion = await authorizeWithPasskey(`Connect AI chat “${trimmedName}”`);
      const res = await api.createAgentKey({
        name: trimmedName,
        perTxLimit: String(perTxNum),
        dailyLimit: String(dailyNum),
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        passkeyAssertion: assertion,
      });
      setCreated(res);
      setShowCreate(false);
      toast(`Key created for ${res.name}`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create AI chat key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (k: AgentKey) => {
    if (!window.confirm(`Revoke “${k.name}”? Any AI chat using this key loses access immediately.`)) return;
    setBusyId(k.id);
    setError(null);
    try {
      const assertion = await authorizeWithPasskey(`Revoke AI chat key “${k.name}”`);
      await api.revokeAgentKey(k.id, assertion);
      toast(`“${k.name}” revoked`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke key');
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
            <h1 className="text-2xl font-display font-extrabold tracking-tight">AI Chat Payments</h1>
          </div>
          <p className="mt-1 text-sm text-stone-500 max-w-xl">
            Send, receive, and check payments directly from ChatGPT, Claude, Cursor, or any AI chat.
            Protected by strict USD spend limits and revocable in one tap.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer flex-shrink-0"
        >
          {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>{showCreate ? 'Cancel' : 'Connect AI Chat'}</span>
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
        <div className="p-5 rounded-3xl bg-stone-50 border border-stone-200 space-y-5">
          <div className="space-y-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              1. Pick your AI chat app
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CHAT_PLATFORMS.map((p) => {
                const active = selectedPlatform === p.id;
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPlatform(p)}
                    className={`text-left p-3 rounded-2xl border transition-colors cursor-pointer ${
                      active
                        ? 'border-stone-900 bg-white shadow-xs'
                        : 'border-stone-200 bg-white hover:border-stone-400'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-stone-900' : 'text-stone-500'}`} />
                      <span className="text-xs font-bold text-stone-900 truncate">{p.label}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-stone-500">{p.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Claude or ChatGPT"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                Key expires in days (optional)
              </span>
              <input
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="90 (blank = never)"
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                Max per payment ($ USD)
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-stone-400">$</span>
                <input
                  value={perTxLimit}
                  onChange={(e) => setPerTxLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="25"
                  className="w-full pl-7 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                Daily spend limit ($ USD)
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-stone-400">$</span>
                <input
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="100"
                  className="w-full pl-7 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-sm font-mono focus:outline-none focus:border-stone-900"
                />
              </div>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-stone-500 max-w-md">
              Payments inside your USD limits execute immediately from chat; any attempt above{' '}
              <span className="font-mono font-bold text-stone-700">${perTxLimit || '25'}/tx</span> or{' '}
              <span className="font-mono font-bold text-stone-700">${dailyLimit || '100'}/day</span> is
              automatically blocked.
            </p>
            <button
              onClick={handleCreate}
              disabled={creating || isAuthorizing}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
            >
              {creating || isAuthorizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              <span>Create Key with Passkey</span>
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900">
            <KeyRound className="w-4 h-4" />
            <h2 className="text-sm font-display font-bold uppercase tracking-wider">Connected AI Chats</h2>
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
          <SkeletonList rows={2} />
        ) : keys.length === 0 ? (
          <div className="p-8 rounded-3xl bg-stone-50 border border-dashed border-stone-200 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white border border-stone-200 flex items-center justify-center mx-auto">
              <Bot className="w-5 h-5 text-stone-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-stone-900">No AI chats connected yet</p>
              <p className="text-xs text-stone-500 max-w-sm mx-auto">
                Pick your AI chat below to generate a Passkey-authorized key with built-in USD spend limits.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {CHAT_PLATFORMS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      selectPlatform(p);
                      setShowCreate(true);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-xs font-bold text-stone-900 transition-colors cursor-pointer"
                  >
                    <Icon className="w-3.5 h-3.5 text-stone-500" />
                    <span>Connect {p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => {
              const revoked = Boolean(k.revokedAt);
              const expired = k.expiresAt ? k.expiresAt < Date.now() : false;
              const dead = revoked || expired;
              const dailyLimitNum = k.dailyLimit ? parseFloat(k.dailyLimit) || 0 : 0;
              const perTxLimitNum = k.perTxLimit ? parseFloat(k.perTxLimit) || 0 : 0;
              const spentToday = k.spentToday ?? 0;
              const spendPct = dailyLimitNum > 0 ? Math.min(1, spentToday / dailyLimitNum) : 0;
              const spendTone =
                spendPct >= 1 ? 'bg-red-500' : spendPct >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
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
                      {!dead && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ACTIVE
                        </span>
                      )}
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
                      {k.keyPrefix}… · Max ${perTxLimitNum || 25}/payment · Max ${dailyLimitNum || 100}/day
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone-400 font-mono">
                      Created {formatDate(k.createdAt)}
                      {k.lastUsedAt ? ` · Last used ${formatDate(k.lastUsedAt)}` : ' · Never used'}
                      {k.expiresAt ? ` · Expires ${formatDate(k.expiresAt)}` : ''}
                    </div>
                    {dailyLimitNum > 0 && (
                      <div className="mt-2 max-w-[16rem]">
                        <div className="flex items-center justify-between text-[10px] font-mono text-stone-500">
                          <span>Today&apos;s spend (USD)</span>
                          <span className="tabular-nums">
                            ${spentToday.toFixed(2)} / ${dailyLimitNum.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${spendTone} transition-[width] duration-300`}
                            style={{ width: `${spendPct * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {!dead && (
                    <button
                      onClick={() => handleRevoke(k)}
                      disabled={busyId === k.id || isAuthorizing}
                      className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-500 hover:text-red-600 hover:border-red-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
                    >
                      {busyId === k.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Setup & Example Prompts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900">
            <Code2 className="w-4 h-4" />
            <h2 className="text-sm font-display font-bold uppercase tracking-wider">Easy Setup Guide</h2>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-stone-100 border border-stone-200">
            <button
              type="button"
              onClick={() => setGuideTab('mcp')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                guideTab === 'mcp' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              Claude / Cursor (MCP)
            </button>
            <button
              type="button"
              onClick={() => setGuideTab('chatgpt')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                guideTab === 'chatgpt' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              ChatGPT Actions
            </button>
          </div>
        </div>

        <div className="p-5 rounded-3xl bg-stone-950 text-stone-100 space-y-4">
          {guideTab === 'mcp' ? (
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 font-bold">
                Add to Claude Desktop, Cursor, Windsurf, or any MCP Client
              </div>
              <CopyBlock value={buildMcpJson('up_agent_YOUR_KEY_HERE')} />
              <p className="text-xs text-stone-400 leading-relaxed">
                Or connect directly to <code className="text-stone-200">{MCP_ENDPOINT}</code> with header{' '}
                <code className="text-stone-200">Authorization: Bearer up_agent_…</code>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 font-bold">
                Import into ChatGPT (Custom GPT → Actions → Import from URL)
              </div>
              <CopyRow value={OPENAPI_SPEC_URL} />
              <p className="text-xs text-stone-400 leading-relaxed">
                1. In ChatGPT, open <strong>Configure → Actions → Create new action</strong>.<br />
                2. Click <strong>Import from URL</strong> and paste the URL above.<br />
                3. Set <strong>Authentication</strong> to <strong>API Key (Bearer)</strong> and paste your{' '}
                <code className="text-stone-200">up_agent_…</code> key.
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-stone-800 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-bold">
              What you can say in chat
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs font-mono text-stone-300">
              <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800">
                &ldquo;Send 10 USDC to @alice for coffee&rdquo;
              </div>
              <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800">
                &ldquo;Give me a Base USDC address to receive $50&rdquo;
              </div>
              <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800">
                &ldquo;Check my UPRAIL balance and recent payments&rdquo;
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Created key modal */}
      {created && (
        <CreatedKeyModal
          created={created}
          defaultTab={selectedPlatform === 'chatgpt' ? 'chatgpt' : 'mcp'}
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
};

const CopyRow: React.FC<{ value: string }> = ({ value }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-stone-900 border border-stone-800">
      <code className="text-xs font-mono text-stone-200 truncate">{value}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          toast('Copied to clipboard');
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

const CopyBlock: React.FC<{ value: string }> = ({ value }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl bg-stone-900 border border-stone-800 p-3">
      <pre className="text-[11px] font-mono text-stone-200 overflow-x-auto leading-relaxed pr-8">{value}</pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          toast('Copied config to clipboard');
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-stone-400 hover:text-white bg-stone-800/80 transition-colors cursor-pointer"
        title="Copy JSON"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

const CreatedKeyModal: React.FC<{
  created: CreatedAgentKey;
  defaultTab: 'mcp' | 'chatgpt';
  onClose: () => void;
}> = ({ created, defaultTab, onClose }) => {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [tab, setTab] = useState<'mcp' | 'chatgpt'>(defaultTab);
  const [ack, setAck] = useState(false);

  const mcpJson = buildMcpJson(created.key);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-lg rounded-3xl bg-white border border-stone-200 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center space-x-2 text-stone-900">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h3 className="text-lg font-display font-extrabold">{created.name} is ready to connect</h3>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          Copy your secret key or ready-made config below. For security, this key is shown{' '}
          <strong>only once</strong>.
        </p>

        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 font-bold">
            1. Your Secret AI Chat Key
          </span>
          <div className="p-3 rounded-xl bg-stone-950 text-stone-100 font-mono text-xs break-all select-all">
            {created.key}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(created.key);
              setCopiedKey(true);
              setAck(true);
              toast('Secret key copied');
              setTimeout(() => setCopiedKey(false), 1500);
            }}
            className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedKey ? 'Key Copied' : 'Copy Secret Key'}</span>
          </button>
        </div>

        <div className="space-y-2 pt-2 border-t border-stone-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              2. Quick Setup
            </span>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-stone-100 border border-stone-200">
              <button
                type="button"
                onClick={() => setTab('mcp')}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold cursor-pointer ${
                  tab === 'mcp' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500'
                }`}
              >
                Claude / Cursor (MCP)
              </button>
              <button
                type="button"
                onClick={() => setTab('chatgpt')}
                className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold cursor-pointer ${
                  tab === 'chatgpt' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500'
                }`}
              >
                ChatGPT
              </button>
            </div>
          </div>

          {tab === 'mcp' ? (
            <div className="space-y-2">
              <pre className="p-3 rounded-xl bg-stone-950 text-stone-100 font-mono text-[11px] overflow-x-auto leading-relaxed">
                {mcpJson}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(mcpJson);
                  setCopiedConfig(true);
                  setAck(true);
                  toast('MCP config copied');
                  setTimeout(() => setCopiedConfig(false), 1500);
                }}
                className="w-full flex items-center justify-center space-x-2 py-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
              >
                {copiedConfig ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedConfig ? 'MCP Config Copied' : 'Copy Ready-to-Paste MCP JSON'}</span>
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs text-stone-700">
              <p>
                1. In ChatGPT Custom GPT → <strong>Actions → Import from URL</strong>:
              </p>
              <CopyRow value={OPENAPI_SPEC_URL} />
              <p>
                2. Choose <strong>Authentication → API Key → Bearer</strong> and paste the secret key above.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Capped at <strong>${created.perTxLimit}/payment</strong> and{' '}
            <strong>${created.dailyLimit}/day</strong>. You can revoke this key anytime.
          </span>
        </div>

        <button
          onClick={onClose}
          disabled={!ack}
          className="w-full py-2.5 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
        >
          {ack ? 'Done' : 'Copy your key above to continue'}
        </button>
      </div>
    </div>
  );
};
