import React, { useState, useEffect } from 'react';
import {
  Radio,
  Smartphone,
  Bot,
  Eye,
  Shield,
  Fingerprint,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

export const MoneyFlowSchematic: React.FC = () => {
  const [packetProgress, setPacketProgress] = useState<number>(0);

  // Smooth continuous packet loop
  useEffect(() => {
    let animId: number;
    let start = performance.now();

    const loop = (now: number) => {
      const elapsed = (now - start) / 1000;
      // 3.6 second loop
      const pct = (elapsed % 3.6) / 3.6;
      setPacketProgress(pct);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleReplay = () => {
    setPacketProgress(0);
  };

  // Triangle vertex coordinates in 400x350 SVG space:
  // Point 1 (Top / Apex): (200, 70) -> @mert
  // Point 2 (Bottom Right): (320, 260) -> Routing (Bots / NEAR Intents)
  // Point 3 (Bottom Left): (80, 260) -> Recipient (@alex / @illia)
  const getPacketCoord = (t: number) => {
    if (t < 0.45) {
      // Leg 1: Top (200, 70) -> Bottom Right (320, 260)
      const s = t / 0.45;
      return {
        x: 200 + s * (320 - 200),
        y: 70 + s * (260 - 70),
      };
    } else if (t < 0.90) {
      // Leg 2: Bottom Right (320, 260) -> Bottom Left (80, 260)
      const s = (t - 0.45) / 0.45;
      return {
        x: 320 - s * (320 - 80),
        y: 260,
      };
    } else {
      // Settle at Recipient
      return {
        x: 80,
        y: 260,
      };
    }
  };

  const pos = getPacketCoord(packetProgress);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 text-stone-900">
      {/* Header (Clean Monochrome) */}
      <div className="flex items-end justify-between border-b border-stone-200 pb-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-[10px] font-mono text-stone-700 font-bold mb-1.5">
            <Radio className="w-3 h-3" />
            <span>HOW MONEY MOVES</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
            Public Leak vs. UPRAIL
          </h2>
        </div>

        <button
          type="button"
          onClick={handleReplay}
          className="p-2 rounded-xl border border-stone-200 hover:border-black bg-white text-stone-600 hover:text-black transition-colors cursor-pointer"
          title="Replay animation"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 
        Side-by-Side Triangles with Dotted Lines and Icons at Each Point.
        Completely monochrome: zero colors, zero gradients.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ============================================================ */}
        {/* TRIANGLE 1: NORMAL BLOCKCHAINS (PUBLIC LEAK) */}
        {/* ============================================================ */}
        <div className="rounded-3xl border border-stone-200 bg-white p-5 sm:p-6 space-y-3">
          {/* Header Tag */}
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <span className="font-display font-bold text-sm text-stone-950">
              Normal Blockchains
            </span>
            <span className="text-[10px] font-mono font-bold text-stone-800 bg-stone-100 border border-stone-300 px-2 py-0.5 rounded-full flex items-center space-x-1">
              <AlertTriangle className="w-3 h-3" />
              <span>PUBLIC LEAK</span>
            </span>
          </div>

          {/* SVG Triangle with Dotted Lines & Icons at Points */}
          <div className="relative w-full aspect-[4/3] flex items-center justify-center">
            <svg
              viewBox="0 0 400 350"
              className="w-full h-full select-none overflow-visible"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Dotted Triangle Perimeter */}
              <polygon
                points="200,70 320,260 80,260"
                fill="none"
                stroke="#1C1917"
                strokeWidth="2"
                strokeDasharray="6 6"
              />

              {/* Sub-label along top-right dotted leg */}
              <text
                x="275"
                y="155"
                textAnchor="middle"
                transform="rotate(57 275 155)"
                fill="#78716C"
                fontSize="8"
                fontFamily="monospace"
              >
                mempool stream ➔
              </text>

              {/* Sub-label along bottom dotted leg */}
              <text
                x="200"
                y="278"
                textAnchor="middle"
                fill="#78716C"
                fontSize="8"
                fontFamily="monospace"
              >
                index ➔
              </text>

              {/* Animated Money Packet Moving along Dotted Legs */}
              <g transform={`translate(${pos.x}, ${pos.y})`}>
                <circle r="12" fill="#1C1917" stroke="#FFFFFF" strokeWidth="2" />
                <text
                  textAnchor="middle"
                  dy="3.5"
                  fill="#FFFFFF"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  $500
                </text>

                {/* Packet Tag */}
                <g transform="translate(0, -20)">
                  <rect
                    x="-42"
                    y="-8"
                    width="84"
                    height="16"
                    rx="8"
                    fill="#FFFFFF"
                    stroke="#1C1917"
                    strokeWidth="1"
                  />
                  <text
                    textAnchor="middle"
                    dy="2.5"
                    fill="#1C1917"
                    fontSize="7"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    LEAK: 0x71a2...
                  </text>
                </g>
              </g>

              {/* POINT 1: Apex (Top) - @mert (Sender) */}
              <g transform="translate(200, 70)">
                <circle r="22" fill="#FFFFFF" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-stone-900">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="-30"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  @mert
                </text>
                <text
                  x="0"
                  y="-20"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Sends $500
                </text>
              </g>

              {/* POINT 2: Bottom Right - MEV Bots (Snooper) */}
              <g transform="translate(320, 260)">
                <circle r="22" fill="#FFFFFF" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-stone-900">
                    <Bot className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="36"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  MEV Bots
                </text>
                <text
                  x="0"
                  y="46"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Sniff Mempool
                </text>
              </g>

              {/* POINT 3: Bottom Left - @alex (Exposed Recipient) */}
              <g transform="translate(80, 260)">
                <circle r="22" fill="#FFFFFF" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-stone-900">
                    <Eye className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="36"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  @alex
                </text>
                <text
                  x="0"
                  y="46"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Balance Exposed
                </text>
              </g>
            </svg>
          </div>

          <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-[11px] font-mono text-stone-600 text-center">
            Zero Privacy: Anyone on 𝕏 can look up Alex and see his total crypto net worth.
          </div>
        </div>

        {/* ============================================================ */}
        {/* TRIANGLE 2: UPRAIL (CONFIDENTIAL SETTLEMENT) */}
        {/* ============================================================ */}
        <div className="rounded-3xl border-2 border-stone-950 bg-white p-5 sm:p-6 space-y-3">
          {/* Header Tag */}
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <span className="font-display font-bold text-sm text-stone-950">
              UPRAIL Rails
            </span>
            <span className="text-[10px] font-mono font-bold text-white bg-stone-950 px-2 py-0.5 rounded-full flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-white" />
              <span>CONFIDENTIAL</span>
            </span>
          </div>

          {/* SVG Triangle with Dotted Lines & Icons at Points */}
          <div className="relative w-full aspect-[4/3] flex items-center justify-center">
            <svg
              viewBox="0 0 400 350"
              className="w-full h-full select-none overflow-visible"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Dotted Triangle Perimeter */}
              <polygon
                points="200,70 320,260 80,260"
                fill="none"
                stroke="#1C1917"
                strokeWidth="2.5"
                strokeDasharray="6 6"
              />

              {/* Sub-label along top-right dotted leg */}
              <text
                x="275"
                y="155"
                textAnchor="middle"
                transform="rotate(57 275 155)"
                fill="#78716C"
                fontSize="8"
                fontFamily="monospace"
              >
                encrypted intent ➔
              </text>

              {/* Sub-label along bottom dotted leg */}
              <text
                x="200"
                y="278"
                textAnchor="middle"
                fill="#78716C"
                fontSize="8"
                fontFamily="monospace"
              >
                passkey settlement ➔
              </text>

              {/* Animated Shielded Packet Moving along Dotted Legs */}
              <g transform={`translate(${pos.x}, ${pos.y})`}>
                <circle r="12" fill="#1C1917" stroke="#FFFFFF" strokeWidth="2" />
                <text
                  textAnchor="middle"
                  dy="3.5"
                  fill="#FFFFFF"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  ✦
                </text>

                {/* Shielded Tag */}
                <g transform="translate(0, -20)">
                  <rect
                    x="-45"
                    y="-8"
                    width="90"
                    height="16"
                    rx="8"
                    fill="#1C1917"
                    stroke="#FFFFFF"
                    strokeWidth="1"
                  />
                  <text
                    textAnchor="middle"
                    dy="2.5"
                    fill="#FFFFFF"
                    fontSize="7"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    SHIELDED: $500
                  </text>
                </g>
              </g>

              {/* POINT 1: Apex (Top) - @mert (Sender) */}
              <g transform="translate(200, 70)">
                <circle r="22" fill="#FFFFFF" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-stone-900">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="-30"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  @mert
                </text>
                <text
                  x="0"
                  y="-20"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Sends on 𝕏
                </text>
              </g>

              {/* POINT 2: Bottom Right - NEAR Intents (Solver) */}
              <g transform="translate(320, 260)">
                <circle r="22" fill="#1C1917" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-white">
                    <Shield className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="36"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  NEAR Intents
                </text>
                <text
                  x="0"
                  y="46"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Solver Routing
                </text>
              </g>

              {/* POINT 3: Bottom Left - @illia (Passkey Vault) */}
              <g transform="translate(80, 260)">
                <circle r="22" fill="#1C1917" stroke="#1C1917" strokeWidth="2" />
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div className="w-5 h-5 flex items-center justify-center text-white">
                    <Fingerprint className="w-4 h-4" />
                  </div>
                </foreignObject>
                <text
                  x="0"
                  y="36"
                  textAnchor="middle"
                  fill="#1C1917"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  @illia
                </text>
                <text
                  x="0"
                  y="46"
                  textAnchor="middle"
                  fill="#78716C"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Passkey Claim
                </text>
              </g>
            </svg>
          </div>

          <div className="p-2.5 rounded-xl bg-stone-900 text-white text-[11px] font-mono text-center">
            Absolute Discretion: Illia claims securely with Touch ID. Public balance stays $0.00.
          </div>
        </div>
      </div>
    </div>
  );
};
