'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Robot,
  Plus,
  Key,
  Trash,
  Prohibit,
  CircleNotch,
  Copy,
  Check,
  X,
  Code,
  Warning,
  ArrowsClockwise,
  ChatText,
  Sparkle,
  TerminalWindow,
  Globe,
  Lightning,
  Compass,
  BookOpen,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useSearchParams } from '../lib/router';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { SkeletonList } from '../components/Skeleton';
import { Badge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import type { AgentKey } from '../types';

const MCP_ENDPOINT = 'https://api.uprail.world/api/mcp';
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

/** Authentic Anthropic Claude starburst mark */
const ClaudeLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M4.71 15.96L9.43 13.31L9.51 13.08L9.43 12.95H9.2L8.41 12.9L5.71 12.83L3.38 12.73L1.11 12.61L0.54 12.49L0 11.78L0.06 11.43L0.54 11.11L1.23 11.17L2.75 11.27L5.03 11.43L6.68 11.53L9.13 11.79H9.52L9.58 11.63L9.44 11.53L9.34 11.43L6.99 9.84L4.43 8.15L3.09 7.18L2.37 6.69L2 6.23L1.84 5.22L2.5 4.5L3.38 4.56L3.61 4.62L4.5 5.31L6.41 6.79L8.9 8.62L9.27 8.92L9.42 8.82L9.44 8.75L9.27 8.48L7.92 6.03L6.47 3.54L5.83 2.51L5.66 1.89C5.6 1.63 5.56 1.42 5.56 1.16L6.31 0.14L6.72 0L7.72 0.14L8.14 0.5L8.76 1.92L9.77 4.15L11.33 7.18L11.79 8.08L12.03 8.91L12.12 9.17H12.28V9.02L12.41 7.31L12.65 5.22L12.88 2.52L12.96 1.76L13.34 0.85L14.09 0.36L14.67 0.64L15.15 1.33L15.08 1.77L14.79 3.63L14.23 6.54L13.87 8.48H14.08L14.32 8.24L15.31 6.93L16.96 4.86L17.69 4.04L18.54 3.14L19.09 2.71H20.12L20.88 3.84L20.54 5.01L19.48 6.36L18.6 7.5L17.33 9.2L16.54 10.56L16.61 10.67L16.8 10.65L19.66 10.04L21.2 9.76L23.04 9.45L23.87 9.84L23.96 10.23L23.63 11.04L21.66 11.53L19.35 12L15.91 12.81L15.87 12.84L15.92 12.9L17.47 13.05L18.13 13.09H19.75L22.77 13.32L23.56 13.84L24 14.48L23.92 14.97L22.7 15.59L21.06 15.2L17.23 14.29L15.92 13.96H15.74V14.07L16.84 15.15L18.85 16.96L21.36 19.29L21.57 19.87L21.25 20.33L20.91 20.28L18.7 18.62L17.85 17.87L15.92 16.25H15.79V16.42L16.23 17.07L18.58 20.59L18.7 21.67L18.53 22.02L17.92 22.23L17.25 22.11L15.88 20.18L14.46 18.01L13.32 16.07L13.18 16.15L12.5 23.4L12.19 23.77L11.46 24L10.85 23.54L10.53 22.79L10.85 21.31L11.24 19.38L11.56 17.85L11.85 15.95L12.02 15.32L12.01 15.28L11.87 15.3L10.44 17.27L8.26 20.22L6.53 22.06L6.12 22.23L5.4 21.86L5.47 21.2L5.87 20.61L8.26 17.57L9.7 15.69L10.63 14.6L10.62 14.44H10.57L4.23 18.56L3.1 18.71L2.61 18.25L2.67 17.5L2.9 17.26L4.71 15.96Z"
      fill="#D97757"
    />
  </svg>
);

/** Authentic OpenAI / ChatGPT 6-loop knot mark */
const OpenAiLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);

/** Authentic xAI Grok orbital slash mark */
const GrokLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M9.27 15.2L19.05 5.42c.46-.46 1.24-.22 1.37.41.45 2.09.24 4.38-.68 6.51-1.42 3.29-4.63 5.56-8.21 5.89-1.91.18-3.71-.21-5.26-1.02L3.2 20.28H1.05l4.46-4.46a8.91 8.91 0 0 1-.91-5.58C5.15 5.88 8.7 2.38 13.07 1.9c1.73-.19 3.38.12 4.82.82l-1.9 1.9a6.48 6.48 0 0 0-3.68-.5c-2.98.41-5.34 2.87-5.67 5.86-.2 1.85.39 3.57 1.5 4.83l1.13.39zm3.48-.34a6.44 6.44 0 0 0 4.91-4.88c.26-1.14.21-2.26-.1-3.28l-7.55 7.55c.86.45 1.79.68 2.74.61z" />
  </svg>
);

/** Authentic Meta infinity loop mark */
const MetaLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M17.52 5C15.4 5 13.73 6.37 12.22 8.53C10.82 6.51 9.09 5 6.64 5C3.28 5 1 7.77 1 11.78C1 15.63 3.23 18.2 6.08 18.2C8.16 18.2 9.93 16.82 11.83 13.84C11.83 13.84 12.82 12.21 13.25 11.5C13.75 12.31 14.48 13.48 14.48 13.48C16.32 16.48 18.06 18.2 20.2 18.2C22.84 18.2 24 15.54 24 11.7C24 7.66 21.2 5 17.52 5ZM6.17 15.6C4.47 15.6 3.55 14.07 3.55 11.73C3.55 9.15 4.82 7.56 6.66 7.56C8.12 7.56 9.31 8.59 10.67 10.75C9.24 13.12 7.77 15.6 6.17 15.6ZM19.95 15.6C18.67 15.6 17.44 14.37 15.89 11.87C15.48 11.21 14.79 10.08 14.28 9.27C15.39 7.98 16.43 7.56 17.56 7.56C19.64 7.56 21.43 9.21 21.43 11.78C21.43 14.12 20.99 15.6 19.95 15.6Z"
      fill="#0081FB"
    />
  </svg>
);

/** Authentic Cursor 3D isometric cube mark */
const CursorLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M11.999 1.5L2.75 6.84v10.32l9.249 5.34 9.251-5.34V6.84L11.999 1.5zm6.96 5.56L12 11.08 5.04 7.06 12 3.04l6.96 4.02zM4.5 8.77l6.75 3.9v7.8L4.5 16.57v-7.8zm8.25 11.7v-7.8l6.75-3.9v7.8l-6.75 3.9z" />
  </svg>
);

const CHAT_PLATFORMS: ChatPlatform[] = [
  {
    id: 'claude',
    label: 'Claude',
    blurb: 'Claude Web, Mobile & Desktop',
    icon: ClaudeLogo,
    defaultName: 'Claude',
  },
  {
    id: 'openai',
    label: 'OpenAI / ChatGPT',
    blurb: 'ChatGPT, OpenAI Dot & GPT Actions',
    icon: OpenAiLogo,
    defaultName: 'OpenAI Dot',
  },
  {
    id: 'grok',
    label: 'Grok Bot',
    blurb: 'Grok on 𝕏 & xAI Grok Assistant',
    icon: GrokLogo,
    defaultName: 'Grok Bot',
  },
  {
    id: 'metamuse',
    label: 'Meta Muse',
    blurb: 'Meta Muse & Meta AI Assistant',
    icon: MetaLogo,
    defaultName: 'Meta Muse',
  },
  {
    id: 'cursor',
    label: 'Cursor / Windsurf',
    blurb: 'Pay & check balance from IDE chat',
    icon: CursorLogo,
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

function buildMcpJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        uprail: {
          url: MCP_ENDPOINT,
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

function resolveSessionPlatform(k: AgentKey): ChatPlatform | null {
  const hay = `${k.name || ''} ${k.oauthClientName || ''}`.toLowerCase();
  if (hay.includes('claude') || hay.includes('anthropic')) return CHAT_PLATFORMS[0];
  if (hay.includes('openai') || hay.includes('chatgpt') || hay.includes('dot')) return CHAT_PLATFORMS[1];
  if (hay.includes('grok') || hay.includes('xai')) return CHAT_PLATFORMS[2];
  if (hay.includes('muse') || hay.includes('meta')) return CHAT_PLATFORMS[3];
  if (hay.includes('cursor') || hay.includes('windsurf')) return CHAT_PLATFORMS[4];
  return null;
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
  const [showConnect, setShowConnect] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AgentKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentKey | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>('claude');

  const [pocket, setPocket] = useState<{
    pocketAccount: string | null;
    mainAccount: string;
    balances: Array<{
      assetId: string;
      symbol: string;
      name: string;
      decimals: number;
      amount: string;
      amountFormatted: string;
      priceUsd: number | null;
      amountUsd: number | null;
    }>;
    totalUsd: number;
    custodyMode: 'server' | 'self';
  } | null>(null);
  const [pocketAsset, setPocketAsset] = useState<'USDC' | 'USDT' | 'NEAR'>('USDC');
  const [pocketAmount, setPocketAmount] = useState('10');
  const [pocketBusy, setPocketBusy] = useState<null | 'fund' | 'reclaim'>(null);
  const [pocketStatusMsg, setPocketStatusMsg] = useState<string | null>(null);

  const selectPlatform = (p: ChatPlatform) => {
    setSelectedPlatform(p.id);
  };

  useEffect(() => {
    const requested = searchParams.get('platform');
    if (!requested || appliedPlatformParam.current === requested) return;
    const platform = CHAT_PLATFORMS.find((p) => p.id === requested);
    if (!platform) return;
    appliedPlatformParam.current = requested;
    setSelectedPlatform(platform.id);
    setShowConnect(true);
    const timer = window.setTimeout(() => {
      document.getElementById('connect-ai-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  const refresh = useCallback(async () => {
    try {
      const [k, p] = await Promise.all([
        api.getAgentKeys(),
        api.getAgentPocket().catch(() => null),
      ]);
      setKeys(k);
      if (p) setPocket(p);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load AI chat sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleFundPocket = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = pocketAmount.trim();
    if (!amt || Number(amt) <= 0) {
      setError('Enter a positive amount to load into your Agent Allowance.');
      return;
    }
    setPocketBusy('fund');
    setPocketStatusMsg('Preparing passkey signature…');
    setError(null);
    try {
      await api.fundAgentPocketSelfCustody(
        { asset: pocketAsset, amount: amt },
        (_stage, msg) => setPocketStatusMsg(msg)
      );
      toast(`Loaded ${amt} ${pocketAsset} into Agent Allowance`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to load Agent Allowance');
    } finally {
      setPocketBusy(null);
      setPocketStatusMsg(null);
    }
  };

  const handleReclaimPocket = async () => {
    setPocketBusy('reclaim');
    setPocketStatusMsg('Confirm with passkey to return funds…');
    setError(null);
    try {
      const assertion = await authorizeWithPasskey('Return Agent Allowance funds to main vault');
      const res = await api.reclaimAgentPocket(assertion);
      if (res.reclaimed) {
        toast('Returned Agent Allowance funds to your main UPRAIL vault');
      } else {
        toast('No balance remaining in Agent Allowance');
      }
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to return Agent Allowance');
    } finally {
      setPocketBusy(null);
      setPocketStatusMsg(null);
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
      const res = await api.revokeAgentKey(k.id, assertion);
      const baseMsg = k.authMethod === 'oauth' ? `“${k.name}” disconnected` : `“${k.name}” revoked`;
      toast(res?.pocketReclaimed ? `${baseMsg} — Agent Allowance returned to main vault` : baseMsg);
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
            <Robot weight="fill" className="w-5 h-5" />
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
            <BookOpen weight="fill" className="w-3.5 h-3.5" />
            <span>Setup docs</span>
          </a>
          <button
            onClick={() => setShowConnect((v) => !v)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer flex-shrink-0"
          >
            {showConnect ? <X weight="bold" className="w-3.5 h-3.5" /> : <Plus weight="bold" className="w-3.5 h-3.5" />}
            <span>{showConnect ? 'Close' : 'Connect AI Chat'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start space-x-2 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <Warning weight="fill" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Agent Allowance Pocket (Zero-prompt AI chat spending for Self-Custody) */}
      {pocket && pocket.custodyMode === 'self' && (
        <div className="p-5 rounded-3xl bg-white border border-stone-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center flex-wrap gap-2 text-stone-950">
                <Lightning weight="fill" className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-display font-bold uppercase tracking-wider">
                  Agent Allowance Pocket
                </h2>
              </div>
              <p className="text-xs text-stone-500 max-w-2xl leading-relaxed">
                Pre-load USDC, USDT, or NEAR here for instant AI chat sends &amp; withdrawals inside
                your spend caps with no passkey popup. These funds still count in your main UPRAIL
                balance and pull back automatically when you spend anywhere else.
              </p>
            </div>
            <div className="sm:text-right flex-shrink-0">
              <span className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
                Loaded Allowance
              </span>
              <span className="text-xl font-display font-extrabold text-stone-950 tabular-nums">
                ${(pocket.totalUsd ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          {pocket.balances.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {pocket.balances.map((b) => (
                <span
                  key={b.assetId}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono text-stone-800"
                >
                  <span className="font-bold tabular-nums">{b.amountFormatted}</span>
                  <span className="text-stone-500">{b.symbol}</span>
                </span>
              ))}
            </div>
          )}

          {pocketStatusMsg && (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono text-stone-700">
              <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-stone-600 flex-shrink-0" />
              <span>{pocketStatusMsg}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <form onSubmit={handleFundPocket} className="flex flex-wrap items-center gap-2">
              <select
                value={pocketAsset}
                onChange={(e) => setPocketAsset(e.target.value as 'USDC' | 'USDT' | 'NEAR')}
                disabled={Boolean(pocketBusy)}
                className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs font-mono font-bold text-stone-900 focus:outline-none focus:border-stone-900"
              >
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="NEAR">NEAR</option>
              </select>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={pocketAmount}
                onChange={(e) => setPocketAmount(e.target.value)}
                disabled={Boolean(pocketBusy)}
                placeholder="10"
                className="w-24 px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:border-stone-900"
              />
              <button
                type="submit"
                disabled={Boolean(pocketBusy) || isAuthorizing}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
              >
                {pocketBusy === 'fund' ? (
                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus weight="bold" className="w-3.5 h-3.5" />
                )}
                <span>Load Allowance</span>
              </button>
            </form>

            {pocket.balances.length > 0 && (
              <button
                type="button"
                onClick={handleReclaimPocket}
                disabled={Boolean(pocketBusy) || isAuthorizing}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
              >
                {pocketBusy === 'reclaim' ? (
                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowsClockwise weight="bold" className="w-3.5 h-3.5" />
                )}
                <span>Return to Main Vault</span>
              </button>
            )}
          </div>
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
            <Badge tone="ok" className="self-start">
              OAuth 2.1
            </Badge>
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

          <div className="rounded-2xl bg-stone-950 text-stone-100 p-4 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
              2. Remote MCP server URL
            </div>
            <CopyRow value={MCP_ENDPOINT} />
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
              <ArrowSquareOut weight="fill" className="w-3 h-3 opacity-70" />
            </a>
            {activePlatformObj.id === 'claude' && (
              <a
                href={buildClaudeInstallUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-400 text-stone-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <ClaudeLogo className="w-3.5 h-3.5" />
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
              <Copy weight="fill" className="w-3.5 h-3.5" />
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
                <TerminalWindow weight="fill" className="w-3.5 h-3.5" />
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
                <Compass weight="fill" className="w-3.5 h-3.5" />
                <span>Copy setup prompt</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900">
            <Key weight="fill" className="w-4 h-4" />
            <h2 className="text-sm font-display font-bold uppercase tracking-wider">Connected AI Chats</h2>
          </div>
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Refresh"
          >
            <ArrowsClockwise weight="bold" className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <SkeletonList rows={2} />
        ) : keys.length === 0 ? (
          <div className="p-8 rounded-3xl bg-stone-50 border border-dashed border-stone-200 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white border border-stone-200 flex items-center justify-center mx-auto">
              <Robot weight="fill" className="w-5 h-5 text-stone-400" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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
              const matchedPlatform = resolveSessionPlatform(k);
              const SessionIcon = matchedPlatform?.icon || Robot;

              return (
                <div
                  key={k.id}
                  className={`rounded-3xl border p-4 sm:p-5 flex flex-col justify-between gap-4 transition-all ${
                    dead
                      ? 'bg-stone-50/80 border-stone-200 opacity-70'
                      : 'bg-white border-stone-200 shadow-xs hover:shadow-sm hover:border-stone-300'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                          dead
                            ? 'bg-stone-200 text-stone-500'
                            : 'bg-stone-950 text-white shadow-2xs'
                        }`}
                      >
                        <SessionIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-display font-extrabold text-stone-950 truncate">
                          {k.name}
                        </h3>
                        <p className="text-[11px] font-mono text-stone-500 truncate">
                          {isOAuth
                            ? k.oauthClientName || 'OAuth 2.1 Session'
                            : `Key ${k.keyPrefix}…`}
                        </p>
                      </div>
                    </div>

                    <div className="flex-shrink-0">
                      {!dead && (
                        <Badge
                          tone="ok"
                          icon={<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        >
                          Active
                        </Badge>
                      )}
                      {status === 'revoked' && <Badge tone="neutral">Revoked</Badge>}
                      {status === 'expired' && <Badge tone="neutral">Expired</Badge>}
                      {status === 'disconnected' && <Badge tone="warn">Reauthorize</Badge>}
                    </div>
                  </div>

                  {/* Card Spend Caps Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl bg-stone-50 border border-stone-200/80 px-3 py-2.5">
                      <span className="block text-[10px] font-mono uppercase tracking-wider text-stone-400">
                        Per Payment
                      </span>
                      <span className="text-sm font-mono font-bold text-stone-950 tabular-nums">
                        ${perTxLimitNum || 25}
                      </span>
                    </div>
                    <div className="rounded-2xl bg-stone-50 border border-stone-200/80 px-3 py-2.5">
                      <span className="block text-[10px] font-mono uppercase tracking-wider text-stone-400">
                        Daily Cap
                      </span>
                      <span className="text-sm font-mono font-bold text-stone-950 tabular-nums">
                        ${dailyLimitNum || 100}
                      </span>
                    </div>
                  </div>

                  {/* Daily Spend Bar */}
                  {dailyLimitNum > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono text-stone-500">
                        <span>Today&apos;s spend</span>
                        <span className="font-bold text-stone-800 tabular-nums">
                          ${spentToday.toFixed(2)} / ${dailyLimitNum.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${spendTone} transition-[width] duration-300`}
                          style={{ width: `${spendPct * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Card Footer */}
                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-mono text-stone-400 leading-relaxed min-w-0 truncate">
                      <span>
                        {isOAuth
                          ? `Connected ${formatDate(k.oauthConnectedAt || k.createdAt)}`
                          : `Created ${formatDate(k.createdAt)}`}
                      </span>
                      <span className="mx-1">·</span>
                      <span>
                        {k.lastUsedAt ? `Used ${formatDate(k.lastUsedAt)}` : 'Unused'}
                      </span>
                      {k.expiresAt && (
                        <>
                          <span className="mx-1">·</span>
                          <span>Exp {formatDate(k.expiresAt)}</span>
                        </>
                      )}
                    </div>

                    {!dead ? (
                      <button
                        onClick={() => handleRevoke(k)}
                        disabled={busyId === k.id || isAuthorizing}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50/50 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
                      >
                        {busyId === k.id ? (
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Prohibit weight="fill" className="w-3.5 h-3.5" />
                        )}
                        <span>{isOAuth ? 'Disconnect' : 'Revoke'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(k)}
                        disabled={busyId === k.id || isAuthorizing}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
                      >
                        {busyId === k.id ? (
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash weight="fill" className="w-3.5 h-3.5" />
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
          <Code weight="bold" className="w-4 h-4" />
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
              <BookOpen weight="fill" className="w-3 h-3" />
              <span>Per-chat setup guide &amp; troubleshooting →</span>
            </a>
          </div>
        </div>
      </div>

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
        {copied ? <Check weight="bold" className="w-3.5 h-3.5" /> : <Copy weight="fill" className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};
