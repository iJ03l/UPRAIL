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
import { FONT_DISPLAY, FONT_SANS } from '../assets/fonts';
import { BRAND_ICON, BRAND_WORDMARK } from '../assets/brand';

export interface OgCardOptions {
  eyebrow: string;
  headline: string;
  subline?: string;
  detail?: string;
  cacheControl?: string;
}

const ACCENT = '#E05326';
const ACCENT_GLOW = 'rgba(224, 83, 38, 0.15)';
const CARD_BG = '#14100D';
const CARD_BORDER = '#2B211B';
const TEXT_WHITE = '#FFFFFF';
const TEXT_SUBTLE = '#D6D3D1';
const TEXT_MUTED = '#A8A29E';
const FOOTER_LABEL = '#78716C';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function headlineSize(text: string): number {
  if (text.length <= 10) return 92;
  if (text.length <= 16) return 80;
  if (text.length <= 24) return 66;
  return 52;
}

export async function renderOgCard(opts: OgCardOptions): Promise<Response> {
  const size = headlineSize(opts.headline);
  const subline = opts.subline
    ? `<div style="display:flex;font-family:'SpaceGrotesk';font-size:26px;color:${TEXT_SUBTLE};margin-top:14px;letter-spacing:-0.3px;">${esc(opts.subline)}</div>`
    : '';
  const detail = opts.detail
    ? `<div style="display:flex;font-family:'SpaceGrotesk';font-size:20px;color:${TEXT_MUTED};line-height:1.45;">${esc(opts.detail)}</div>`
    : '';

  const html = `
  <div style="display:flex;flex-direction:column;width:1200px;height:630px;box-sizing:border-box;padding:36px;background:#0A0807;font-family:'SpaceGrotesk';">
    <div style="display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;padding:48px 56px;background:${CARD_BG};border:2px solid ${CARD_BORDER};border-radius:28px;">
      
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
        <div style="display:flex;align-items:center;">
          <img src="${BRAND_ICON}" width="44" height="42" />
          <img src="${BRAND_WORDMARK}" width="104" height="35" style="margin-left:14px;" />
        </div>
        <div style="display:flex;align-items:center;padding:7px 18px;border-radius:999px;background:${ACCENT_GLOW};border:1.5px solid rgba(224,83,38,0.35);">
          <div style="display:flex;width:8px;height:8px;border-radius:4px;background:${ACCENT};margin-right:10px;"></div>
          <div style="display:flex;font-family:'SpaceGrotesk';font-size:13px;font-weight:700;letter-spacing:2px;color:#FF7D54;">CONFIDENTIAL RAIL</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;margin-top:54px;">
        <div style="display:flex;font-family:'SpaceGrotesk';font-size:15px;font-weight:700;letter-spacing:3px;color:${ACCENT};text-transform:uppercase;">${esc(opts.eyebrow)}</div>
        <div style="display:flex;font-family:'Syne';font-size:${size}px;font-weight:700;color:${TEXT_WHITE};line-height:1.02;margin-top:14px;letter-spacing:-1.5px;">${esc(opts.headline)}</div>
        ${subline}
      </div>

      <div style="display:flex;flex-direction:column;margin-top:auto;">
        ${detail}
        
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:24px;">
          <div style="display:flex;font-family:'SpaceGrotesk';font-size:15px;font-weight:700;letter-spacing:1px;color:${FOOTER_LABEL};">app.uprail.world</div>
          <div style="display:flex;font-family:'SpaceGrotesk';font-size:13px;font-weight:700;letter-spacing:1.5px;color:${FOOTER_LABEL};">THE VALUE RAILWAY FOR X</div>
        </div>

        <div style="display:flex;align-items:center;margin-top:14px;">
          <div style="display:flex;width:12px;height:12px;border-radius:6px;background:${ACCENT};"></div>
          <div style="display:flex;flex:1;border-top:2px dashed #3D2D24;margin:0 10px;"></div>
          <div style="display:flex;width:10px;height:10px;border-radius:5px;background:#00C1DE;"></div>
          <div style="display:flex;flex:1;border-top:2px dashed #3D2D24;margin:0 10px;"></div>
          <div style="display:flex;width:12px;height:12px;border-radius:6px;background:#00EC97;"></div>
        </div>
      </div>

    </div>
  </div>`;

  const image = new ImageResponse(html, {
    width: 1200,
    height: 630,
    format: 'png',
    fonts: [
      { name: 'Syne', data: FONT_DISPLAY, weight: 700, style: 'normal' },
      { name: 'SpaceGrotesk', data: FONT_SANS, weight: 500, style: 'normal' },
    ],
  });

  return new Response(image.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': opts.cacheControl || 'public, max-age=31536000, immutable',
    },
  });
}
