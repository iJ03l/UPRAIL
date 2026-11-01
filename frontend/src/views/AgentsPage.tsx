'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  Plus,
  KeyRound,
  ShieldCheck,
  Trash2,
  Ban,
  Loader2,
  Copy,
  Check,
  X,
  Code2,
  AlertTriangle,
  Construction,
  RefreshCw,
  MessageSquare,
  Sparkles,
  Terminal,
  Globe,
  Zap,
  Compass,
  BookOpen,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSearchParams } from '../lib/router';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { SkeletonList } from '../components/Skeleton';
import { Portal } from '../components/Portal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import type { AgentKey, CreatedAgentKey } from '../types';

const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';
const OPENAPI_SPEC_URL = 'https://api.uprail.world/api/agent/openapi.json';
const DOCS_SETUP_URL = 'https://docs.uprail.world/docs/agents';
const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/plugins';
const GROK_CONNECTORS_URL = 'https://grok.com/connectors';
const META_MUSE_URL = 'https://muse.ai/';

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

type PlatformId = 'claude' | 'openai' | 'grok' | 'metamuse' | 'cursor' | 'other';

interface ChatPlatform {
  id: PlatformId;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultName: string;
}

const CHAT_PLATFORMS: ChatPlatform[] = [
  {
    id: 'claude',
    label: 'Claude',
    blurb: 'Claude Web, Mobile & Desktop',
    icon: Sparkles,
    defaultName: 'Claude',
  },
  {
    id: 'openai',
    label: 'OpenAI / Dot',
    blurb: 'ChatGPT, OpenAI Dot & GPT Actions',
    icon: MessageSquare,
    defaultName: 'OpenAI Dot',
  },
  {
    id: 'grok',
    label: 'Grok Bot',
    blurb: 'Grok on 𝕏 & xAI Grok Assistant',
    icon: Zap,
    defaultName: 'Grok Bot',
  },
  {
    id: 'metamuse',
    label: 'Meta Muse',
    blurb: 'Meta Muse & Meta AI Assistant',
    icon: Compass,
    defaultName: 'Meta Muse',
  },
  {
    id: 'cursor',
    label: 'Cursor / Windsurf',
    blurb: 'Pay & check balance from IDE chat',
    icon: Terminal,
    defaultName: 'Cursor',
  },
  {
    id: 'other',
    label: 'Any Other AI Chat',
    blurb: 'Works with any MCP or OpenAPI chat',
    icon: Globe,
    defaultName: 'My AI Chat',
  },
];

function buildMcpJson(apiKey?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        uprail: {
          url: MCP_ENDPOINT,
          ...(apiKey
            ? {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                },
              }
            : {}),
        },
      },
    },
    null,
    2
  );
}

function buildClaudeInstallUrl(): string {
  return `${CLAUDE_CONNECTORS_URL}?modal=add-custom-connector&connectorName=UPRAIL&connectorUrl=${encodeURIComponent(
    MCP_ENDPOINT
  )}`;
}

function buildMuseSetupPrompt(): string {
  return [
    'Create a custom connector for UPRAIL using this remote MCP server:',
    'Name: UPRAIL',
    'Transport: Streamable HTTP',
    `URL: ${MCP_ENDPOINT}`,
    'Authentication: OAuth (open the URL and approve with Face ID).',
    'Then list the tools and ask for my UPRAIL balance.',
  ].join('\n');
}

function platformSettingsUrl(platform: PlatformId): string {
  switch (platform) {
    case 'claude':
      return CLAUDE_CONNECTORS_URL;
    case 'openai':
      return CHATGPT_CONNECTORS_URL;
    case 'grok':
      return GROK_CONNECTORS_URL;
    case 'metamuse':
      return META_MUSE_URL;
    case 'cursor':
      return 'https://cursor.com';
    default:
      return DOCS_SETUP_URL;
  }
}

export const AgentsPage: React.FC = () => {
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const appliedPlatformParam = useRef<string | null>(null);
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AgentKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentKey | null>(null);

  // Create form state
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>('claude');
  const [name, setName] = useState('Claude');
  const [perTxLimit, setPerTxLimit] = useState('25');
  const [dailyLimit, setDailyLimit] = useState('100');
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [creating, setCreating] = useState(false);

  const selectPlatform = (p: ChatPlatform) => {
    setSelectedPlatform(p.id);
    setName(p.defaultName);
  };

  useEffect(() => {
    const requested = searchParams.get('platform');
    if (!requested || appliedPlatformParam.current === requested) return;
    const platform = CHAT_PLATFORMS.find((p) => p.id === requested);
    if (!platform) return;
    appliedPlatformParam.current = requested;
    setSelectedPlatform(platform.id);
    setName(platform.defaultName);
    setShowConnect(true);
    setShowCreate(false);
    const timer = window.setTimeout(() => {
      document.getElementById('connect-ai-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

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
      setError('Give your AI chat connection a name (e.g. Grok Bot, OpenAI Dot, Meta Muse, Claude).');
      return;
    }
    const perTxNum = parseFloat(perTxLimit);
    const dailyNum = parseFloat(dailyLimit);
    if (!Number.isFinite(perTxNum) || perTxNum <= 0 || !Number.isFinite(dailyNum) || dailyNum <= 0) {
      setError('Enter positive USD limits for both per-transaction and daily spend.');
      return;
    }
    if (perTxNum > dailyNum) {
      setError('Max per payment cannot exceed your daily spend limit.');
      return;
    }

    setShowCreateConfirm(true);
  };

  const performCreate = async () => {
    setShowCreateConfirm(false);
    const trimmedName = name.trim();
    const perTxNum = parseFloat(perTxLimit);
    const dailyNum = parseFloat(dailyLimit);
    setCreating(true);
    try {
      const assertion = await authorizeWithPasskey(`Create manual Bearer key “${trimmedName}”`);
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
      setError(err.message || 'Failed to create manual Bearer key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = (k: AgentKey) => {
    setRevokeTarget(k);
  };

  const performRevoke = async () => {
    if (!revokeTarget) return;
    const k = revokeTarget;
    setRevokeTarget(null);
    setBusyId(k.id);
    setError(null);
    try {
      const action = k.authMethod === 'oauth' ? 'Disconnect' : 'Revoke';
      const assertion = await authorizeWithPasskey(`${action} “${k.name}”`);
      await api.revokeAgentKey(k.id, assertion);
      toast(k.authMethod === 'oauth' ? `“${k.name}” disconnected` : `“${k.name}” revoked`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke key');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (k: AgentKey) => {
    setDeleteTarget(k);
  };

  const performDelete = async () => {
    if (!deleteTarget) return;
    const k = deleteTarget;
    setDeleteTarget(null);
    setBusyId(k.id);
    setError(null);
    try {
      const assertion = await authorizeWithPasskey(`Delete connection “${k.name}”`);
      await api.deleteAgentKey(k.id, assertion);
      toast(`“${k.name}” deleted`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to delete key');
    } finally {
      setBusyId(null);
    }
  };

  const activePlatformObj = CHAT_PLATFORMS.find((p) => p.id === selectedPlatform) || CHAT_PLATFORMS[0];
  const ActivePlatformIcon = activePlatformObj.icon;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center space-x-2 text-stone-900">
            <Bot className="w-5 h-5" />
            <h1 className="text-xl sm:text-2xl font-display font-extrabold tracking-tight">AI Chat Payments</h1>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-stone-500 max-w-xl">
            Send, receive, withdraw, and check payments directly from Claude, OpenAI Dot / ChatGPT,
            Grok Bot, Meta Muse, Cursor, or any AI chat. Connect with OAuth + Face ID, protected by
            strict USD spend limits and revocable in one tap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <a
            href={DOCS_SETUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-display font-bold uppercase tracking-wider transition-colors flex-shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Setup docs</span>
          </a>
          <button
            onClick={() => {
              setShowConnect((v) => !v);
              setShowCreate(false);
            }}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer flex-shrink-0"
          >
            {showConnect ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{showConnect ? 'Close' : 'Connect AI Chat'}</span>
          </button>
        </div>
      </div>

      <div className="flex items-start space-x-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
        <Construction className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <span className="font-bold">Under construction.</span> AI chat payments are not fully
          functional yet and may change or fail while we finish the integration.
        </span>
      </div>

      {error && (
        <div className="flex items-start space-x-2 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* OAuth connect panel */}
      {showConnect && (
        <div
          id="connect-ai-chat"
          className="p-5 rounded-3xl bg-stone-50 border border-stone-200 space-y-5 scroll-mt-24"
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 text-stone-900">
                <ActivePlatformIcon className="w-4 h-4" />
                <h2 className="text-sm font-display font-bold uppercase tracking-wider">
                  Connect {activePlatformObj.label}
                </h2>
              </div>
              <p className="mt-1 text-xs text-stone-500 max-w-xl">
                Add UPRAIL as a custom remote MCP connector. Your AI app opens UPRAIL for a
                Face ID approval — there is no secret key to copy.
              </p>
            </div>
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 self-start">
              OAUTH 2.1
            </span>
          </div>

          <div className="space-y-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              1. Pick your AI chat app
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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

          <div className="rounded-2xl bg-stone-950 text-stone-100 p-4 space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                2. Remote MCP server URL
              </div>
              <CopyRow value={MCP_ENDPOINT} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3 text-[11px] leading-relaxed">
              <div className="rounded-xl bg-stone-900 border border-stone-800 p-2.5">
                <span className="block font-bold text-white">Add connector</span>
                <span className="text-stone-400">
                  In {activePlatformObj.label}, choose a custom or remote MCP connector.
                </span>
              </div>
              <div className="rounded-xl bg-stone-900 border border-stone-800 p-2.5">
                <span className="block font-bold text-white">Paste the URL</span>
                <span className="text-stone-400">
                  Leave authentication empty; OAuth discovery starts automatically.
                </span>
              </div>
              <div className="rounded-xl bg-stone-900 border border-stone-800 p-2.5">
                <span className="block font-bold text-white">Approve once</span>
                <span className="text-stone-400">
                  Set limits and a 1–365 day duration, then confirm with Face ID.
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={platformSettingsUrl(activePlatformObj.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <ActivePlatformIcon className="w-3.5 h-3.5" />
              <span>Open {activePlatformObj.label}</span>
            </a>
            {activePlatformObj.id === 'claude' && (
              <a
                href={buildClaudeInstallUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Prefill Claude connector</span>
              </a>
            )}
            <button
              onClick={() => {
                navigator.clipboard.writeText(MCP_ENDPOINT);
                toast('MCP server URL copied');
              }}
              className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy URL</span>
            </button>
            {activePlatformObj.id === 'cursor' && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildMcpJson());
                  toast('MCP config copied');
                }}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Copy MCP config</span>
              </button>
            )}
            {activePlatformObj.id === 'metamuse' && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildMuseSetupPrompt());
                  toast('Setup prompt copied');
                }}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Copy setup prompt</span>
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-stone-200">
            <p className="text-[11px] text-stone-500 max-w-lg">
              Tokens stay scoped to this app and can be disconnected in one tap. Manual Bearer keys
              are still available for OpenAPI Actions, bots, and older clients.
            </p>
            <button
              onClick={() => {
                setShowConnect(false);
                setShowCreate(true);
              }}
              className="text-[11px] font-mono font-bold text-stone-600 hover:text-stone-950 transition-colors cursor-pointer flex-shrink-0"
            >
              Use a manual Bearer key instead →
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div
          id="create-agent-key"
          className="p-5 rounded-3xl bg-stone-50 border border-stone-200 space-y-5 scroll-mt-24"
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <div className="flex items-center space-x-2 text-stone-900">
                <KeyRound className="w-4 h-4" />
                <h2 className="text-sm font-display font-bold uppercase tracking-wider">
                  Advanced: manual Bearer key
                </h2>
              </div>
              <p className="mt-1 text-xs text-stone-500 max-w-xl">
                Use this only for OpenAPI Actions, bots, or clients without OAuth support. OAuth is
                safer because the secret never leaves UPRAIL.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setShowConnect(true);
              }}
              className="text-[11px] font-mono font-bold text-stone-600 hover:text-stone-950 transition-colors cursor-pointer self-start"
            >
              Use OAuth instead →
            </button>
          </div>

          <div className="space-y-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              1. Pick your AI chat app
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                placeholder="e.g. Grok Bot, OpenAI Dot, Meta Muse, Claude"
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
              <span>Create Bearer key with passkey</span>
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
                Pick your AI chat below to connect it with OAuth and Face ID. No secret key to copy.
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
                      setShowConnect(true);
                      setShowCreate(false);
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
              const isOAuth = k.authMethod === 'oauth';
              const revoked = Boolean(k.revokedAt);
              const expired = k.expiresAt ? k.expiresAt < Date.now() : false;
              const status =
                k.connectionStatus || (revoked ? 'revoked' : expired ? 'expired' : 'active');
              const dead = status !== 'active';
              const dailyLimitNum = k.dailyLimit ? parseFloat(k.dailyLimit) || 0 : 0;
              const perTxLimitNum = k.perTxLimit ? parseFloat(k.perTxLimit) || 0 : 0;
              const spentToday = k.spentToday ?? 0;
              const spendPct = dailyLimitNum > 0 ? Math.min(1, spentToday / dailyLimitNum) : 0;
              const spendTone =
                spendPct >= 1 ? 'bg-red-500' : spendPct >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <div
                  key={k.id}
                  className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 ${
                    dead ? 'bg-stone-50 border-stone-200 opacity-60' : 'bg-white border-stone-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-stone-950 truncate">{k.name}</span>
                      {!dead && (
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                            isOAuth
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-sky-50 text-sky-700 border-sky-200'
                          }`}
                        >
                          {isOAuth ? 'OAUTH' : 'BEARER'}
                        </span>
                      )}
                      {status === 'revoked' && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                          REVOKED
                        </span>
                      )}
                      {status === 'expired' && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                          EXPIRED
                        </span>
                      )}
                      {status === 'disconnected' && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          REAUTHORIZE
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-stone-500 font-mono truncate">
                      {isOAuth
                        ? `OAuth · ${k.oauthClientName || 'AI app'}`
                        : `${k.keyPrefix}…`}{' '}
                      · Max ${perTxLimitNum || 25}/transaction · Max ${dailyLimitNum || 100}/day
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone-400 font-mono">
                      {isOAuth
                        ? `Connected ${formatDate(k.oauthConnectedAt || k.createdAt)}`
                        : `Created ${formatDate(k.createdAt)}`}
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!dead && (
                      <button
                        onClick={() => handleRevoke(k)}
                        disabled={busyId === k.id || isAuthorizing}
                        className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-500 hover:text-red-600 hover:border-red-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {busyId === k.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Ban className="w-3.5 h-3.5" />
                        )}
                        <span>{isOAuth ? 'Disconnect' : 'Revoke'}</span>
                      </button>
                    )}
                    {dead && (
                      <button
                        onClick={() => handleDelete(k)}
                        disabled={busyId === k.id || isAuthorizing}
                        className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {busyId === k.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Setup & Example Prompts */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-stone-900">
          <Code2 className="w-4 h-4" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wider">How to connect</h2>
        </div>

        <div className="p-5 rounded-3xl bg-stone-950 text-stone-100 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-stone-900 border border-stone-800 p-3 space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                Step 1
              </div>
              <div className="text-xs font-bold text-white">Pick your chat</div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Choose Claude, ChatGPT, Grok, Meta Muse, Cursor, or another chat above. No secret key
                is created.
              </p>
            </div>
            <div className="rounded-2xl bg-stone-900 border border-stone-800 p-3 space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                Step 2
              </div>
              <div className="text-xs font-bold text-white">Add the MCP URL</div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Paste <span className="font-mono text-stone-200">{MCP_ENDPOINT}</span> as a custom
                remote MCP connector. OAuth discovery handles authentication.
              </p>
            </div>
            <div className="rounded-2xl bg-stone-900 border border-stone-800 p-3 space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                Step 3
              </div>
              <div className="text-xs font-bold text-white">Approve with Face ID</div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                UPRAIL opens once to approve limits. Start a fresh chat, ask for your balance, then
                test with $1.
              </p>
            </div>
          </div>

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
            <a
              href={DOCS_SETUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 text-[11px] font-mono font-bold text-stone-300 hover:text-white transition-colors"
            >
              <BookOpen className="w-3 h-3" />
              <span>Per-chat setup guide &amp; troubleshooting →</span>
            </a>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showCreateConfirm}
        onCancel={() => setShowCreateConfirm(false)}
        onConfirm={() => void performCreate()}
        tone="financial"
        title="Create manual Bearer key"
        description="This key is for OpenAPI Actions, bots, or clients that cannot complete OAuth. It can move money within the limits below."
        confirmLabel="Create Bearer key"
        warning="Anyone with this key can spend up to these limits until you revoke it. The key is shown only once. For AI chats, use OAuth instead."
        details={[
          { label: 'Name', value: name.trim() || '—', mono: false, emphasis: true },
          { label: 'App', value: activePlatformObj.label, mono: false },
          { label: 'Max per payment', value: `$${perTxLimit || '0'}` },
          { label: 'Daily limit', value: `$${dailyLimit || '0'}` },
          { label: 'Expires', value: expiresInDays ? `${expiresInDays} days` : 'Never', mono: false },
        ]}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void performDelete()}
        tone="danger"
        title="Delete connection"
        description={
          deleteTarget
            ? `Permanently remove “${deleteTarget.name}” and its spend history from this account.`
            : undefined
        }
        confirmLabel="Delete permanently"
        warning="This cannot be undone. The connection is already revoked or expired; deleting only removes its record."
        details={[
          { label: 'Name', value: deleteTarget?.name || '—', mono: false, emphasis: true },
          {
            label: deleteTarget?.authMethod === 'oauth' ? 'Connection' : 'Key',
            value:
              deleteTarget?.authMethod === 'oauth'
                ? deleteTarget.oauthClientName || 'OAuth app'
                : `${deleteTarget?.keyPrefix || ''}…`,
          },
        ]}
      />

      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void performRevoke()}
        tone="danger"
        title={revokeTarget?.authMethod === 'oauth' ? 'Disconnect AI app' : 'Revoke AI chat key'}
        description={
          revokeTarget
            ? revokeTarget.authMethod === 'oauth'
              ? `“${revokeTarget.oauthClientName || revokeTarget.name}” loses access immediately and must be authorized again to reconnect.`
              : `Any AI chat using “${revokeTarget.name}” loses access immediately.`
            : undefined
        }
        confirmLabel={revokeTarget?.authMethod === 'oauth' ? 'Disconnect app' : 'Revoke key'}
        warning={
          revokeTarget?.authMethod === 'oauth'
            ? 'The app’s OAuth tokens stop working immediately. Reconnecting requires a fresh Face ID approval.'
            : 'This cannot be undone. You would need to create a new key and reconnect the AI chat.'
        }
        details={[
          { label: 'Name', value: revokeTarget?.name || '—', mono: false, emphasis: true },
          {
            label: revokeTarget?.authMethod === 'oauth' ? 'Connection' : 'Key',
            value:
              revokeTarget?.authMethod === 'oauth'
                ? revokeTarget.oauthClientName || 'OAuth app'
                : `${revokeTarget?.keyPrefix || ''}…`,
          },
        ]}
      />

      {/* Created key modal */}
      {created && (
        <CreatedKeyModal created={created} onClose={() => setCreated(null)} />
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
  onClose: () => void;
}> = ({ created, onClose }) => {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState(false);
  const [ack, setAck] = useState(false);

  const mcpJson = buildMcpJson(created.key);

  const copy = (value: string, message: string) => {
    navigator.clipboard.writeText(value);
    setAck(true);
    toast(message);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <div className="relative w-full max-w-lg rounded-3xl bg-white border border-stone-200 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center space-x-2 text-stone-900">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-display font-extrabold">{created.name} key is ready</h3>
          </div>
          <p className="text-xs text-stone-600 leading-relaxed">
            This is a manual Bearer key for OpenAPI Actions, bots, or clients without OAuth support.
            For Claude, ChatGPT, Grok, and other MCP apps, use{' '}
            <strong>Connect AI Chat</strong> instead — it never exposes a secret.
          </p>

          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 font-bold">
              1. Your secret Bearer key
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
              <span>{copiedKey ? 'Key copied' : 'Copy secret key'}</span>
            </button>
          </div>

          <div className="space-y-2 pt-2 border-t border-stone-200">
            <div className="flex items-center space-x-1.5">
              <KeyRound className="w-3.5 h-3.5 text-stone-500" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 font-bold">
                2. Manual setup
              </span>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-bold">
              MCP config with Bearer key
            </div>
            <CopyBlock value={mcpJson} />
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-bold">
              OAuth MCP URL (recommended, no key)
            </div>
            <CopyRow value={MCP_ENDPOINT} />
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-bold">
              OpenAPI import URL
            </div>
            <CopyRow value={OPENAPI_SPEC_URL} />
            <button
              onClick={() => copy(mcpJson, 'MCP config copied')}
              className="w-full flex items-center justify-center space-x-2 py-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy MCP config</span>
            </button>
          </div>

          <div className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Capped at <strong>${created.perTxLimit}/transaction</strong> and{' '}
              <strong>${created.dailyLimit}/day</strong>. This key is shown only once. Revoke it
              anytime from this page.
            </span>
          </div>

          <a
            href={DOCS_SETUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center space-x-1.5 text-[11px] font-mono font-bold text-stone-500 hover:text-stone-900 transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            <span>Setup guide &amp; troubleshooting →</span>
          </a>

          <button
            onClick={onClose}
            disabled={!ack}
            className="w-full py-2.5 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            {ack ? 'Done' : 'Copy your key above to continue'}
          </button>
        </div>
      </div>
    </Portal>
  );
};
