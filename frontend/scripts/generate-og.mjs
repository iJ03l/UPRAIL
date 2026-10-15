// Generates the social/SEO share cards in public/og from a single SVG
// template. Run with: node scripts/generate-og.mjs
// Requires `rsvg-convert` (librsvg) on PATH. Keeps copy in plain language and
// the brand's dark + burnt-orange look.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconB64 = readFileSync(join(root, 'public/brand/uprail-icon.png')).toString('base64');
const wordB64 = readFileSync(join(root, 'public/brand/uprail-wordmark-white.png')).toString('base64');

const CARDS = {
  'og-landing': {
    eyebrow: 'CONFIDENTIAL PAYMENTS ON X',
    title: ['Send money to any', 'X handle \u2014 privately'],
    sub: ['No wallet addresses. No mempools.', 'They claim it in one tap with a passkey.'],
  },
  'og-app': {
    eyebrow: 'YOUR VAULT',
    title: ['Your confidential', 'balance'],
    sub: ['Hold, send, and receive private', 'payments \u2014 all inside the app.'],
  },
  'og-send': {
    eyebrow: 'SEND',
    title: ['Send money to', 'anyone on X'],
    sub: ['Confidential by default.', 'They claim it with a passkey.'],
  },
  'og-receive': {
    eyebrow: 'RECEIVE',
    title: ['Get paid from', 'any chain'],
    sub: ['One address. USDC, NEAR and more', 'settle privately in your vault.'],
  },
  'og-claim': {
    eyebrow: "YOU'VE GOT MONEY WAITING",
    title: ['Money is waiting', 'for you'],
    sub: ['Claim it with a passkey.', 'No wallet. No seed phrase.'],
  },
  'og-refer': {
    eyebrow: 'INVITE',
    title: ['Invite a friend', 'to UPRAIL'],
    sub: ['Confidential payments', 'for everyone on X.'],
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg({ eyebrow, title, sub }) {
  const titleLines = title
    .map((l, i) => `<text x="72" y="${330 + i * 88}" class="title">${esc(l)}</text>`)
    .join('\n    ');
  const subLines = sub
    .map((l, i) => `<text x="72" y="${480 + i * 40}" class="sub">${esc(l)}</text>`)
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17181B"/>
      <stop offset="1" stop-color="#101113"/>
    </linearGradient>
    <radialGradient id="glow" cx="1" cy="0" r="1.1">
      <stop offset="0" stop-color="#E05326" stop-opacity="0.30"/>
      <stop offset="0.45" stop-color="#E05326" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#E05326" stop-opacity="0"/>
    </radialGradient>
    <style>
      .title { font-family: "DejaVu Sans"; font-size: 76px; font-weight: 700; fill: #F3F4F5; }
      .sub { font-family: "DejaVu Sans"; font-size: 30px; font-weight: 400; fill: #A6A9AD; }
      .eyebrow { font-family: "DejaVu Sans"; font-size: 19px; font-weight: 700; fill: #E05326; letter-spacing: 4px; }
      .foot { font-family: "DejaVu Sans"; font-size: 20px; font-weight: 700; fill: #7E8186; letter-spacing: 1px; }
    </style>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- brand lockup -->
  <image x="72" y="58" width="58" height="56" xlink:href="data:image/png;base64,${iconB64}"/>
  <image x="144" y="64" width="119" height="40" xlink:href="data:image/png;base64,${wordB64}"/>

  <!-- eyebrow + headline + subtext -->
  <text x="72" y="248" class="eyebrow">${esc(eyebrow)}</text>
  ${titleLines}
  ${subLines}

  <!-- rail motif -->
  <g stroke="#313337" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round">
    <line x1="72" y1="610" x2="1080" y2="610"/>
  </g>
  <circle cx="72" cy="610" r="5" fill="#E05326"/>
  <circle cx="576" cy="610" r="4" fill="#4A4D52"/>
  <circle cx="1080" cy="610" r="4" fill="#4A4D52"/>

  <text x="72" y="584" class="foot">app.uprail.world</text>
  <text x="1128" y="584" class="foot" text-anchor="end">UPRAIL</text>

  <!-- accent edge -->
  <rect x="0" y="0" width="8" height="630" fill="#E05326"/>
</svg>`;
}

const tmp = mkdtempSync(join(tmpdir(), 'og-'));
try {
  for (const [name, card] of Object.entries(CARDS)) {
    const svgPath = join(tmp, `${name}.svg`);
    const pngPath = join(root, 'public/og', `${name}.png`);
    writeFileSync(svgPath, svg(card));
    execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', pngPath, svgPath]);
    console.log('wrote', pngPath);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
