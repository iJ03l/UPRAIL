import React, { useState } from 'react';
import {
  Shield,
  Zap,
  Lock,
  ArrowRight,
  Fingerprint,
  Volume2,
  VolumeX,
  Copy,
  Check,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface PresetHandle {
  handle: string;
  name: string;
  avatar: string;
}

const PRESET_HANDLES: PresetHandle[] = [
  { handle: 'satoshi', name: 'Satoshi Nakamoto', avatar: '⚡' },
  { handle: 'vitalik', name: 'Vitalik Buterin', avatar: '🔮' },
  { handle: 'balajis', name: 'Balaji Srinivasan', avatar: '🌐' },
  { handle: 'jack', name: 'jack', avatar: '🐦' },
];

const PRESET_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', decimals: 6, defaultAmount: '500.00' },
  { symbol: 'NEAR', name: 'NEAR Protocol', decimals: 24, defaultAmount: '120.00' },
  { symbol: 'USDT', name: 'Tether USD', decimals: 6, defaultAmount: '250.00' },
  { symbol: 'ETH', name: 'Ethereum', decimals: 18, defaultAmount: '0.45' },
];

export const InteractiveRailSimulator: React.FC = () => {
  const [handle, setHandle] = useState('vitalik');
  const [selectedToken, setSelectedToken] = useState(PRESET_TOKENS[0]);
  const [amount, setAmount] = useState('500.00');
  const [isIgniting, setIsIgniting] = useState(false);
  const [isShielded, setIsShielded] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [beamProgress, setBeamProgress] = useState(0);

  // Synthesize gentle futuristic audio clicks using Web Audio API
  const playSynthesizedTone = (freq: number, duration: number, type: OscillatorType = 'sine') => {
    if (!audioEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // AudioContext unavailable or blocked
    }
  };

  const handleIgnite = () => {
    if (isIgniting) return;
    setIsIgniting(true);
    setIsShielded(false);
    setBeamProgress(0);

    playSynthesizedTone(330, 0.25, 'triangle');

    let p = 0;
    const interval = setInterval(() => {
      p += 4;
      setBeamProgress(p);
      if (p === 52) {
        playSynthesizedTone(520, 0.15, 'sine');
      }
      if (p >= 100) {
        clearInterval(interval);
        setIsIgniting(false);
        setIsShielded(true);
        playSynthesizedTone(880, 0.4, 'sine');
      }
    }, 40);
  };

  const cleanHandle = handle.replace(/^@/, '').trim();

  const sampleIntentPayload = {
    standard: 'nep413',
    intent: 'transfer',
    token: `nep141:${selectedToken.symbol.toLowerCase()}.omft.near`,
    amount: amount,
    recipient_x_handle: `@${cleanHandle || 'recipient'}`,
    confidentiality: 'advanced',
    shielded_shard: 'tee-enclave-v2.near',
    verifier: 'p256_webauthn_passkey',
    status: isShielded ? 'ESCROWED_CONFIDENTIAL' : 'AWAITING_IGNITION',
  };

  return (
    <div className="relative w-full rounded-3xl p-6 sm:p-10 bg-gradient-to-b from-[#181310] via-[#120E0C] to-[#0A0807] border border-[#2C221D] shadow-[0_20px_70px_rgba(0,0,0,0.8)] overflow-hidden">
      {/* Background ambient burnt orange glow */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#E05326]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-[#FF6B35]/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header with audio toggle */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-[#2C221D]">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#E05326]/10 border border-[#E05326]/30 text-[#E05326] text-xs font-mono font-medium tracking-wide uppercase mb-3">
            <span className="w-2 h-2 rounded-full bg-[#E05326] animate-pulse" />
            <span>Tactile Element: Live Confidential Rail Simulator</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-display font-extrabold text-white tracking-tight">
            Test the Confidential Beam
          </h3>
          <p className="text-sm text-[#C3B9B2] mt-1 max-w-xl">
            See how money travels across chains to an X handle without leaking sender, recipient, or balance to public explorers.
          </p>
        </div>

        <div className="flex items-center space-x-3 self-start md:self-auto">
          <button
            onClick={() => {
              setAudioEnabled(!audioEnabled);
              if (!audioEnabled) playSynthesizedTone(660, 0.2);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-[#1F1814] border border-[#2C221D] text-[#D8CEC5] hover:text-white hover:border-[#E05326]/50 transition-colors"
          >
            {audioEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-[#E05326]" />
                <span>Audio Synth On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                <span>Muted</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Interactive Controls & Schematic Grid */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8">
        {/* Left Column: Interactive Input Controls */}
        <div className="lg:col-span-5 space-y-6">
          {/* Target Handle Input */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#D8CEC5] mb-2">
              1. Choose Destination X Handle
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-[#E05326] text-base">
                @
              </span>
              <input
                type="text"
                value={cleanHandle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="username"
                className="w-full pl-9 pr-4 py-3 bg-[#0E0B09] border border-[#2C221D] focus:border-[#E05326] rounded-2xl text-white font-medium text-sm placeholder-stone-600 focus:outline-none transition-all shadow-inner"
              />
            </div>

            {/* Quick preset chips */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              {PRESET_HANDLES.map((p) => (
                <button
                  key={p.handle}
                  onClick={() => {
                    setHandle(p.handle);
                    playSynthesizedTone(440, 0.1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all flex items-center space-x-1 ${
                    cleanHandle.toLowerCase() === p.handle
                      ? 'bg-[#E05326] text-white font-bold shadow-[0_0_12px_rgba(224,83,38,0.5)]'
                      : 'bg-[#181310] text-[#C3B9B2] border border-[#2C221D] hover:border-[#E05326]/40 hover:text-white'
                  }`}
                >
                  <span>{p.avatar}</span>
                  <span>@{p.handle}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Asset & Amount Selector */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#D8CEC5] mb-2">
              2. Select Asset & Value
            </label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PRESET_TOKENS.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => {
                    setSelectedToken(t);
                    setAmount(t.defaultAmount);
                    playSynthesizedTone(480, 0.1);
                  }}
                  className={`py-2 px-1 rounded-xl text-xs font-mono font-bold transition-all text-center border ${
                    selectedToken.symbol === t.symbol
                      ? 'bg-[#E05326]/20 border-[#E05326] text-white shadow-[0_0_15px_rgba(224,83,38,0.3)]'
                      : 'bg-[#140F0D] border-[#2C221D] text-[#A69C95] hover:text-white hover:border-[#3D302A]'
                  }`}
                >
                  {t.symbol}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-3 bg-[#0E0B09] border border-[#2C221D] focus:border-[#E05326] rounded-2xl text-white font-mono text-base focus:outline-none transition-all"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-[#E05326] font-semibold">
                {selectedToken.symbol}
              </span>
            </div>
          </div>

          {/* Action Trigger Button */}
          <button
            onClick={handleIgnite}
            disabled={isIgniting}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-[#E05326] to-[#FF6B35] text-white font-display font-bold text-base tracking-wide uppercase shadow-[0_0_30px_rgba(224,83,38,0.45)] hover:shadow-[0_0_45px_rgba(224,83,38,0.7)] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center space-x-3 cursor-pointer group"
          >
            <Zap className={`w-5 h-5 ${isIgniting ? 'animate-spin' : 'group-hover:scale-110 transition-transform'}`} />
            <span>{isIgniting ? 'Shielding In Transit...' : 'Ignite Confidential Beam'}</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Right Column: Live Schematic Visualization */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-[#0E0B09] rounded-2xl border border-[#2C221D] p-5 sm:p-6 relative overflow-hidden">
          {/* Track Beam Laser Animation */}
          <div className="relative py-4">
            <div className="h-2 w-full bg-[#1A1411] rounded-full overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-[#FF6B35] via-[#E05326] to-[#FFFFFF] transition-all duration-75 shadow-[0_0_15px_#E05326]"
                style={{ width: `${beamProgress}%` }}
              />
            </div>
          </div>

          {/* 4 Schematic Architecture Nodes */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
            {/* Node 1 */}
            <div className="p-3.5 rounded-xl bg-[#15100D] border border-[#2C221D] text-center relative group">
              <div className="w-8 h-8 rounded-lg bg-[#E05326]/10 text-[#E05326] flex items-center justify-center mx-auto mb-2 font-mono text-xs font-bold">
                01
              </div>
              <div className="text-xs font-semibold text-white">Origin Deposit</div>
              <div className="text-[10px] text-[#A69C95] mt-0.5">Any Chain Swap</div>
            </div>

            {/* Node 2 */}
            <div className={`p-3.5 rounded-xl border text-center transition-all ${
              beamProgress >= 30 ? 'bg-[#E05326]/15 border-[#E05326] text-white shadow-[0_0_15px_rgba(224,83,38,0.25)]' : 'bg-[#15100D] border-[#2C221D]'
            }`}>
              <div className="w-8 h-8 rounded-lg bg-[#E05326]/20 text-[#E05326] flex items-center justify-center mx-auto mb-2">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">TEE Bridge</div>
              <div className="text-[10px] text-[#A69C95] mt-0.5">Hardware Enclave</div>
            </div>

            {/* Node 3 */}
            <div className={`p-3.5 rounded-xl border text-center transition-all ${
              beamProgress >= 65 ? 'bg-[#E05326]/15 border-[#E05326] text-white shadow-[0_0_15px_rgba(224,83,38,0.25)]' : 'bg-[#15100D] border-[#2C221D]'
            }`}>
              <div className="w-8 h-8 rounded-lg bg-[#E05326]/20 text-[#E05326] flex items-center justify-center mx-auto mb-2">
                <Shield className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">NEAR Escrow</div>
              <div className="text-[10px] text-[#A69C95] mt-0.5">Confidential Shard</div>
            </div>

            {/* Node 4 */}
            <div className={`p-3.5 rounded-xl border text-center transition-all ${
              isShielded ? 'bg-[#FFFFFF]/10 border-white text-white shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-[#15100D] border-[#2C221D]'
            }`}>
              <div className="w-8 h-8 rounded-lg bg-white/20 text-white flex items-center justify-center mx-auto mb-2">
                <Fingerprint className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-white">Passkey Claim</div>
              <div className="text-[10px] text-[#A69C95] mt-0.5">P-256 Biometric</div>
            </div>
          </div>

          {/* Cryptographic JSON Payload Terminal */}
          <div className="mt-2 bg-[#080605] rounded-xl border border-[#241B16] p-4 font-mono text-[11px] leading-relaxed relative">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E1612] text-xs text-[#8A7E76]">
              <span className="flex items-center space-x-1.5">
                <span className={`w-2 h-2 rounded-full ${isShielded ? 'bg-emerald-400' : 'bg-[#E05326]'}`} />
                <span>intent_envelope.json</span>
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(sampleIntentPayload, null, 2));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="hover:text-white transition-colors flex items-center space-x-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="text-[#E05326] overflow-x-auto selection:bg-[#E05326] selection:text-white">
              {JSON.stringify(sampleIntentPayload, null, 2)}
            </pre>
          </div>

          {/* Deep link CTA to live app */}
          <div className="mt-4 pt-4 border-t border-[#2C221D] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-xs text-[#D8CEC5]">
              <CheckCircle2 className="w-4 h-4 text-[#E05326]" />
              <span>Ready to execute with real assets?</span>
            </div>
            <Link
              to="/app"
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-[#F5F2EF] transition-all shadow-md"
            >
              <span>Launch app.uprail.world</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
