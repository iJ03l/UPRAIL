// Generates the social/SEO share cards in public/og from a single SVG
// template. Run with: node scripts/generate-og.mjs
// Requires `rsvg-convert` (librsvg) on PATH. Plain off-white cards with the
// brand's burnt-orange accent, small type, and plain-language copy.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconB64 = readFileSync(join(root, 'public/brand/uprail-icon.png')).toString('base64');
const wordB64 = readFileSync(join(root, 'public/brand/uprail-wordmark.png')).toString('base64');

const CARDS = {
  'og-landing': {
    eyebrow: 'CONFIDENTIAL PAYMENTS ON X',
    title: ['Send crypto to any', 'X handle \u2014 privately'],
    sub: ['No wallet addresses. No mempools.', 'They claim it in one tap with a passkey.'],
  },
  'og-app': {
    eyebrow: 'YOUR VAULT',
    title: ['Your confidential', 'balance'],
    sub: ['Hold, send, and receive privately', '\u2014 all inside one simple app.'],
  },
  'og-send': {
    eyebrow: 'SEND',
    title: ['Send crypto to', 'anyone on X'],
    sub: ['Confidential by default.', 'They claim it with a passkey.'],
  },
  'og-receive': {
    eyebrow: 'RECEIVE',
    title: ['Get paid from', 'any chain'],
    sub: ['One address. USDC, NEAR and more', 'settle privately in your vault.'],
  },
  'og-claim': {
    eyebrow: 'CRYPTO IS WAITING',
    title: ['Crypto is waiting', 'for you'],
    sub: ['Claim it with a passkey.', 'No wallet. No seed phrase.'],
  },
  'og-refer': {
    eyebrow: 'INVITE',
    title: ['Invite a friend', 'to UPRAIL'],
    sub: ['Confidential payments', 'for everyone on X.'],
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg({ title, sub }) {
  const titleLines = title
    .map((l, i) => `<text x="72" y="${308 + i * 68}" class="title">${esc(l)}</text>`)
    .join('\n    ');
  const subLines = sub
    .map((l, i) => `<text x="72" y="${436 + i * 36}" class="sub">${esc(l)}</text>`)
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      .title { font-family: "DejaVu Sans"; font-size: 54px; font-weight: 700; fill: #191A1C; }
      .sub { font-family: "DejaVu Sans"; font-size: 24px; font-weight: 400; fill: #6E7075; }
      .foot { font-family: "DejaVu Sans"; font-size: 18px; font-weight: 700; fill: #9B9DA1; letter-spacing: 1px; }
    </style>
  </defs>

  <rect width="1200" height="630" fill="#F7F6F3"/>
  <rect x="1" y="1" width="1198" height="628" fill="none" stroke="#ECE9E4" stroke-width="2"/>

  <!-- brand lockup -->
  <image x="72" y="60" width="48" height="46" xlink:href="data:image/png;base64,${iconB64}"/>
  <image x="134" y="66" width="110" height="37" xlink:href="data:image/png;base64,${wordB64}"/>

  <!-- headline + subtext -->
  ${titleLines}
  ${subLines}

  <!-- rail motif -->
  <g stroke="#DAD8D3" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round">
    <line x1="72" y1="606" x2="1080" y2="606"/>
  </g>
  <circle cx="72" cy="606" r="5" fill="#E05326"/>
  <circle cx="576" cy="606" r="4" fill="#C7C5C0"/>
  <circle cx="1080" cy="606" r="4" fill="#C7C5C0"/>

  <text x="72" y="578" class="foot">app.uprail.world</text>
  <text x="1128" y="578" class="foot" text-anchor="end">UPRAIL</text>
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
