import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Check,
  QrCode,
  Shield,
  Info,
} from 'lucide-react';

const RECEIVE_CHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', icon: '⟠', explorer: 'Etherscan' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', icon: '◎', explorer: 'Solscan' },
  { id: 'base', name: 'Base', symbol: 'BASE', icon: '🔵', explorer: 'Basescan' },
  { id: 'near', name: 'NEAR', symbol: 'NEAR', icon: 'Ⓝ', explorer: 'Nearblocks' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ARB', icon: '🔷', explorer: 'Arbiscan' },
  { id: 'robinhood', name: 'Robinhood', symbol: 'HOOD', icon: '🪶', explorer: 'Robinhood Crypto' },
];

export const ReceivePage: React.FC = () => {
  const [selectedChain, setSelectedChain] = useState(RECEIVE_CHAINS[0]);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(true);

  const intentAddress =
    selectedChain.id === 'solana'
      ? 'UPRaiL7xK9nB5tE2wM1pQ4v8yJ3zD6sF0a'
      : selectedChain.id === 'near'
      ? 'escrow.uprail.near'
      : '0x71a2B89eC0d4E95F63B72eF10a12c345E6789a1b';

  const handleCopy = () => {
    navigator.clipboard.writeText(intentAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full space-y-6">
      {/* Back Link */}
      <Link
        to="/app"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-stone-500 hover:text-black transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Home</span>
      </Link>

      {/* Page Title */}
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Receive from any chain
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Deposit tokens from any wallet or exchange. NEAR Intents automatically swaps and shields it into your passkey vault.
        </p>
      </div>

      {/* Main Card */}
      <div className="rounded-3xl p-6 sm:p-8 shadow-sm bg-white border border-stone-200 space-y-6 relative">

        {/* Chain Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block">
            Select Source Network
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {RECEIVE_CHAINS.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedChain(c)}
                className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                  selectedChain.id === c.id
                    ? 'bg-black text-white border-black font-bold shadow-xs'
                    : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <div className="text-base">{c.icon}</div>
                <div className="text-[11px] mt-1 font-mono truncate">{c.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Intent Address & QR code */}
        <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-stone-800 font-mono">
              {selectedChain.name} Intent Gateway
            </span>
            <span className="text-stone-700 font-mono font-bold flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5" />
              <span>Auto-Shielded</span>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={intentAddress}
              className="flex-1 bg-white rounded-xl px-3.5 py-3 text-xs text-stone-900 font-mono border border-stone-200 focus:outline-none select-all"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* QR Code */}
          {showQr && (
            <div className="p-4 bg-white rounded-2xl border border-stone-200 flex flex-col items-center justify-center animate-fade-in">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                  intentAddress
                )}`}
                alt="Deposit QR"
                className="w-36 h-36 object-contain"
              />
              <span className="text-[11px] text-stone-500 font-mono mt-2">
                Scan with mobile wallet to send {selectedChain.name} assets
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-stone-500 pt-1">
            <button
              onClick={() => setShowQr(!showQr)}
              className="text-stone-900 hover:underline font-mono font-bold flex items-center space-x-1 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>{showQr ? 'Hide QR Code' : 'Show QR Code'}</span>
            </button>
            <span className="font-mono text-[11px]">Settles in ~3 seconds</span>
          </div>
        </div>

        {/* How It Works Explainer */}
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 font-bold text-stone-900">
            <Info className="w-3.5 h-3.5 text-stone-900" />
            <span>How Intents Work</span>
          </div>
          <p>
            Send tokens from Robinhood, Coinbase, Binance, Phantom, MetaMask, or any exchange. NEAR Intents detects the incoming deposit, executes a cross-chain solver settlement, and locks the balance into your device-bound passkey vault.
          </p>
        </div>
      </div>
    </div>
  );
};
