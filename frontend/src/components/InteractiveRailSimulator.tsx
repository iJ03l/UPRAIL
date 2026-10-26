'use client';

import React, { useState } from 'react';
import {
  Zap,
  ArrowRight,
  Fingerprint,
  Lock,
  EyeOff,
  Volume2,
  VolumeX,
  CheckCircle2,
} from 'lucide-react';
import { Link } from '../lib/router';

const PRESET_HANDLES = [
  { handle: 'satoshi', name: 'Satoshi', icon: '⚡' },
  { handle: 'illia', name: 'Illia', icon: '🔮' },
  { handle: 'mert', name: 'mert', icon: '🐦' },
];

const PRESET_AMOUNTS = ['100', '500', '1,000', '5,000'];

const PRESET_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', color: '#2775CA' },
  { symbol: 'NEAR', name: 'NEAR Protocol', color: '#00EC97' },
  { symbol: 'ETH', name: 'Ethereum', color: '#627EEA' },
];

export const InteractiveRailSimulator: React.FC = () => {
  const [handle, setHandle] = useState('illia');
  const [selectedToken, setSelectedToken] = useState(PRESET_TOKENS[0]);
  const [amount, setAmount] = useState('500');
  const [isFiring, setIsFiring] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [beamPct, setBeamPct] = useState(0);

  const playSynthesizedTone = (freq: number, duration: number) => {
    if (!audioEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // AudioContext unavailable
    }
  };

  const handlePulse = () => {
    if (isFiring) return;
    setIsFiring(true);
    setIsLocked(false);
    setBeamPct(0);

    playSynthesizedTone(360, 0.2);

    let p = 0;
    const interval = setInterval(() => {
      p += 5;
      setBeamPct(p);
      if (p === 50) {
        playSynthesizedTone(540, 0.15);
      }
      if (p >= 100) {
        clearInterval(interval);
        setIsFiring(false);
        setIsLocked(true);
        playSynthesizedTone(880, 0.35);
      }
    }, 35);
  };

  const cleanHandle = handle.replace(/^@/, '').trim() || 'illia';

  return (
    <div className="relative w-full border-y border-stone-200/90 bg-surface-subtle py-14 sm:py-20 md:py-24 overflow-hidden">
      {/* Full-width tactical tile grid background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-45"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(0, 0, 0, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 0, 0, 0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      {/* Full-width ambient burnt-orange & neon glow */}
      <div className="absolute top-0 right-0 w-[550px] h-[550px] bg-[#E05326]/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[550px] h-[550px] bg-[#39FF14]/6 rounded-full blur-3xl pointer-events-none" />

      {/* Centered content container */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
        {/* Header with audio toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-8 border-b border-stone-200/80 gap-4">
          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold">
              Interactive Tactile Beam
            </span>
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-display font-extrabold text-stone-950 mt-1 tracking-tight">
              Send Value Into The Shielded Shard
            </h3>
          </div>

          <button
            onClick={() => {
              setAudioEnabled(!audioEnabled);
              if (!audioEnabled) playSynthesizedTone(660, 0.15);
            }}
            className="self-start sm:self-auto flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white border border-stone-200 text-xs font-mono text-stone-600 hover:text-black hover:border-stone-400 shadow-2xs transition-all cursor-pointer"
          >
            {audioEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-[#E05326]" />
                <span className="font-semibold text-stone-900">Audio On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 text-stone-400" />
                <span>Muted</span>
              </>
            )}
          </button>
        </div>

        {/* Main Visual Arena */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8">
          {/* Left Column: Visual Selectors */}
          <div className="lg:col-span-5 space-y-6">
            {/* Target Handle */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-stone-500 mb-2 font-semibold">
                Destination 𝕏 Identity
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-[#E05326] text-base">
                  @
                </span>
                <input
                  type="text"
                  value={cleanHandle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle"
                  className="w-full pl-9 pr-4 py-3 bg-white border border-stone-200 focus:border-[#E05326] rounded-2xl text-stone-900 font-medium text-base sm:text-sm focus:outline-none transition-all shadow-2xs"
                />
              </div>

              {/* Quick preset handle chips */}
              <div className="flex flex-wrap gap-2 mt-2">
                {PRESET_HANDLES.map((p) => (
                  <button
                    key={p.handle}
                    onClick={() => {
                      setHandle(p.handle);
                      playSynthesizedTone(440, 0.08);
                    }}
                    className={`px-2.5 py-1 rounded-xl text-xs font-mono transition-all flex items-center space-x-1 border cursor-pointer ${
                      cleanHandle.toLowerCase() === p.handle
                        ? 'bg-[#E05326] text-white border-[#E05326] shadow-sm font-bold'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    <span>{p.icon}</span>
                    <span>@{p.handle}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Asset & Amount Selector */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-stone-500 mb-2 font-semibold">
                Asset & Amount
              </label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {PRESET_TOKENS.map((t) => (
                  <button
                    key={t.symbol}
                    onClick={() => {
                      setSelectedToken(t);
                      playSynthesizedTone(480, 0.08);
                    }}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                      selectedToken.symbol === t.symbol
                        ? 'border-[#E05326] bg-[#E05326]/5 shadow-sm'
                        : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                  >
                    <div className="font-mono text-xs font-bold text-stone-900">{t.symbol}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{t.name}</div>
                  </button>
                ))}
              </div>

              {/* Quick Amount Buttons */}
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => {
                      setAmount(amt);
                      playSynthesizedTone(520, 0.08);
                    }}
                    className={`py-2 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer ${
                      amount === amt
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Fire Intent Button */}
            <button
              onClick={handlePulse}
              disabled={isFiring}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-[#E05326] to-[#FF6B35] text-white font-display font-extrabold text-sm uppercase tracking-wider shadow-[0_10px_28px_rgba(224,83,38,0.35)] hover:shadow-[0_12px_36px_rgba(224,83,38,0.55)] hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2.5 cursor-pointer disabled:opacity-60"
            >
              <Zap className={`w-4 h-4 ${isFiring ? 'animate-bounce' : ''}`} />
              <span>{isFiring ? 'Firing Intent Beam...' : 'Pulse Confidential Beam'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Right Column: Visual Beam Pipeline & Outcome */}
          <div className="lg:col-span-7 flex flex-col justify-between bg-white rounded-3xl border border-stone-200 p-4 sm:p-6 md:p-8 relative overflow-hidden shadow-xs">
            {/* Laser Track Visualization */}
            <div className="space-y-2">
              <div className="flex justify-between text-[9px] sm:text-xs font-mono text-stone-500">
                <span>ORIGIN ACCOUNT</span>
                <span className="text-[#E05326] font-bold">ENCLAVE TRANSMISSION</span>
                <span>RECIPIENT DEVICE</span>
              </div>
              <div className="h-3 w-full bg-stone-100 border border-stone-200/80 rounded-full overflow-hidden relative shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-[#E05326] via-[#FF6B35] to-[#39FF14] transition-all duration-75 shadow-sm"
                  style={{ width: `${beamPct}%` }}
                />
              </div>
            </div>

            {/* Three Visual Pipeline Stage Capsules */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 my-6">
              {/* Stage 1 */}
              <div className="p-2.5 sm:p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center shadow-xs">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white border border-stone-200 flex items-center justify-center mx-auto mb-2 text-stone-700 font-mono font-bold text-xs">
                  01
                </div>
                <div className="text-[11px] sm:text-xs font-bold text-stone-900 leading-tight">Input Deposit</div>
                <div className="text-[9px] sm:text-[10px] text-stone-500 mt-0.5 font-mono">{amount} {selectedToken.symbol}</div>
              </div>

              {/* Stage 2 */}
              <div
                className={`p-2.5 sm:p-4 rounded-2xl border text-center transition-all shadow-xs ${
                  beamPct >= 50
                    ? 'bg-[#E05326]/10 border-[#E05326] text-[#E05326]'
                    : 'bg-stone-50 border-stone-200 text-stone-400'
                }`}
              >
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white border border-inherit flex items-center justify-center mx-auto mb-2">
                  <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <div className="text-[11px] sm:text-xs font-bold text-stone-900 leading-tight">TEE Shard</div>
                <div className="text-[9px] sm:text-[10px] mt-0.5 font-mono">Encrypted</div>
              </div>

              {/* Stage 3 */}
              <div
                className={`p-2.5 sm:p-4 rounded-2xl border text-center transition-all shadow-xs ${
                  isLocked
                    ? 'bg-[#39FF14]/15 border-[#062E0C] text-[#062E0C]'
                    : 'bg-stone-50 border-stone-200 text-stone-400'
                }`}
              >
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white border border-inherit flex items-center justify-center mx-auto mb-2">
                  <Fingerprint className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-700" />
                </div>
                <div className="text-[11px] sm:text-xs font-bold text-stone-900 leading-tight">UPRAIL Account</div>
                <div className="text-[9px] sm:text-[10px] mt-0.5 font-mono truncate">@{cleanHandle}</div>
              </div>
            </div>

            {/* The Visual Result: What the World Sees vs What You See */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {/* Public Blockchain Explorer View */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5 shadow-xs">
                <div className="flex items-center space-x-1.5 text-[11px] font-mono uppercase text-stone-500 font-bold">
                  <EyeOff className="w-3.5 h-3.5 text-stone-400" />
                  <span>What The World Sees</span>
                </div>
                <div className="text-xs font-mono text-stone-800 bg-white p-2.5 rounded-xl border border-stone-200">
                  <span className="text-stone-400">HANDLE:</span> NOT ON-CHAIN<br />
                  <span className="text-stone-400">PAID TO:</span> UPRAIL SUB-ACCOUNT<br />
                  <span className="text-stone-400">AMOUNTS:</span> VISIBLE ON-CHAIN
                </div>
              </div>

              {/* Recipient Private Vault View */}
              <div className="p-4 rounded-2xl bg-[#E05326]/5 border-2 border-[#E05326] space-y-1.5 shadow-xs">
                <div className="flex items-center space-x-1.5 text-[11px] font-mono uppercase text-[#E05326] font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#E05326]" />
                  <span>Recipient Account</span>
                </div>
                <div className="text-xs font-mono text-stone-900 bg-white p-2.5 rounded-xl border border-[#E05326]/20 font-medium">
                  <span className="text-stone-500">HOLDING:</span> +{amount} {selectedToken.symbol}<br />
                  <span className="text-stone-500">OWNER:</span> @{cleanHandle}<br />
                  <span className="text-stone-500">CONFIRM WITH:</span> Passkey<br />
                  <span className="text-emerald-700 font-bold">READY TO RECEIVE</span>
                </div>
              </div>
            </div>

            {/* Launch App Button */}
            <div className="mt-5 pt-4 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-stone-500 font-mono">
                Ready to send live assets to @{cleanHandle}?
              </span>
              <a
                href="https://app.uprail.world"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-4 py-2.5 sm:py-2 rounded-xl bg-black text-white text-xs font-display font-bold hover:bg-[#E05326] transition-colors shadow-xs"
              >
                <span>Execute on app.uprail.world</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
