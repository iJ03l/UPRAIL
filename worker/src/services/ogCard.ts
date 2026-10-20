/**
 * Dynamic social share cards.
 *
 * The static PNGs in `frontend/public/og` are generic by nature — every claim
 * link used to point at the same "Crypto is waiting for you" image, so a
 * payment to a handle looked identical to every other one. These helpers render
 * a card per payment/invite/receipt with the real sender, amount and ticker,
 * using Satori + resvg inside the Worker (no browser, no external service).
 */
import { ImageResponse } from 'workers-og';
import { FONT_REGULAR, FONT_BOLD } from '../assets/fonts';
import { BRAND_ICON, BRAND_WORDMARK } from '../assets/brand';

export interface OgCardOptions {
  eyebrow: string;
  headline: string;
  subline?: string;
  detail?: string;
}

const ACCENT = '#E05326';
const INK = '#191A1C';
const MUTED = '#6E7075';
const FOOT = '#9B9DA1';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function headlineSize(text: string): number {
  if (text.length <= 12) return 96;
  if (text.length <= 18) return 82;
  if (text.length <= 26) return 68;
  return 56;
}

export async function renderOgCard(opts: OgCardOptions): Promise<Response> {
  const size = headlineSize(opts.headline);
  const subline = opts.subline
    ? `<div style="display:flex;font-size:28px;color:${MUTED};margin-top:18px;">${esc(opts.subline)}</div>`
    : '';
  const detail = opts.detail
    ? `<div style="display:flex;font-size:24px;color:${MUTED};line-height:1.45;">${esc(opts.detail)}</div>`
    : '';

  const html = `
  <div style="display:flex;flex-direction:column;width:1200px;height:630px;box-sizing:border-box;padding:60px 72px;background:#F7F6F3;border:2px solid #ECE9E4;font-family:'DejaVu';">
    <div style="display:flex;align-items:center;">
      <img src="${BRAND_ICON}" width="48" height="46" />
      <img src="${BRAND_WORDMARK}" width="110" height="37" style="margin-left:14px;" />
    </div>

    <div style="display:flex;flex-direction:column;margin-top:92px;">
      <div style="display:flex;font-size:20px;font-weight:700;letter-spacing:3px;color:${ACCENT};">${esc(opts.eyebrow)}</div>
      <div style="display:flex;font-size:${size}px;font-weight:700;color:${INK};line-height:1.05;margin-top:18px;">${esc(opts.headline)}</div>
      ${subline}
    </div>

    <div style="display:flex;flex-direction:column;margin-top:auto;">
      ${detail}
      <div style="display:flex;align-items:center;margin-top:26px;">
        <div style="display:flex;font-size:16px;font-weight:700;letter-spacing:1px;color:${FOOT};">app.uprail.world</div>
        <div style="display:flex;font-size:16px;font-weight:700;letter-spacing:1px;color:${FOOT};margin-left:auto;">UPRAIL</div>
      </div>
      <div style="display:flex;align-items:center;margin-top:16px;">
        <div style="display:flex;width:10px;height:10px;border-radius:5px;background:${ACCENT};"></div>
        <div style="display:flex;flex:1;border-top:2px dashed #DAD8D3;margin:0 8px;"></div>
        <div style="display:flex;width:8px;height:8px;border-radius:4px;background:#C7C5C0;"></div>
        <div style="display:flex;flex:1;border-top:2px dashed #DAD8D3;margin:0 8px;"></div>
        <div style="display:flex;width:8px;height:8px;border-radius:4px;background:#C7C5C0;"></div>
      </div>
    </div>
  </div>`;

  const image = new ImageResponse(html, {
    width: 1200,
    height: 630,
    format: 'png',
    fonts: [
      { name: 'DejaVu', data: FONT_REGULAR, weight: 400, style: 'normal' },
      { name: 'DejaVu', data: FONT_BOLD, weight: 700, style: 'normal' },
    ],
  });

  return new Response(image.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Card content is immutable for a given payment/invite/withdrawal id.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
