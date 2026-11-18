'use client';

import React, { useEffect, useRef } from 'react';
import { FIGURE_SPRITE_PNG } from './figureSpriteBase64';

const LOW_W = 48;
const LOW_H = 80;

/**
 * The Quantus mascot is a green pixel sprite. In dark mode we retint it to the
 * burnt-orange hero palette (and warm its glow + floor shadow) so the obsidian
 * theme reads as one coherent accent instead of a stray green figure.
 */
const GREEN_PALETTE = {
  glow: '#39ff14',
  floor: 'rgba(6, 46, 12, 0.09)',
  gridOrange: '224, 83, 38',
  gridGreen: '57, 255, 20',
};
const ORANGE_PALETTE = {
  glow: '#E05326',
  floor: 'rgba(46, 18, 12, 0.10)',
  gridOrange: '224, 83, 38',
  gridGreen: '255, 175, 148',
};
// burnt-800 → burnt-500 → burnt-300, a ramp used to remap sprite luminance.
const ORANGE_RAMP: [number, number, number][] = [
  [126, 41, 16],
  [224, 83, 38],
  [255, 175, 148],
];

function rampColor(luminance: number): [number, number, number] {
  const l = Math.max(0, Math.min(1, luminance));
  const upper = l >= 0.5;
  const t = upper ? (l - 0.5) / 0.5 : l / 0.5;
  const a = upper ? ORANGE_RAMP[1] : ORANGE_RAMP[0];
  const b = upper ? ORANGE_RAMP[2] : ORANGE_RAMP[1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

interface QuantusInteractiveCanvasProps {
  fullScreenRoam?: boolean;
}

export const QuantusInteractiveCanvas: React.FC<QuantusInteractiveCanvasProps> = ({
  fullScreenRoam,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Offscreen canvas for the 48x80 quantized sprite
    const offscreen = document.createElement('canvas');
    offscreen.width = LOW_W;
    offscreen.height = LOW_H;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    let spriteReady = false;
    let isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

    const tintSpriteOrange = () => {
      const frame = offCtx.getImageData(0, 0, LOW_W, LOW_H);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 16) continue;
        const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        const [r, g, b] = rampColor(lum);
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
      offCtx.putImageData(frame, 0, 0);
    };

    const paintSprite = () => {
      offCtx.clearRect(0, 0, LOW_W, LOW_H);
      offCtx.imageSmoothingEnabled = false;
      offCtx.drawImage(spriteImg, 0, 0, LOW_W, LOW_H);
      if (isDark) tintSpriteOrange();
      spriteReady = true;
    };

    const spriteImg = new Image();
    spriteImg.onload = paintSprite;
    spriteImg.src = FIGURE_SPRITE_PNG;

    // Follow the theme toggle so the mascot flips green ↔ orange live.
    const themeObserver = new MutationObserver(() => {
      const nowDark = document.documentElement.classList.contains('dark');
      if (nowDark !== isDark) {
        isDark = nowDark;
        if (spriteReady) paintSprite();
      }
    });
    if (typeof document !== 'undefined') {
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Quantus Pixel Grid parameters
    const GRID_SIZE = 26;
    let cols = Math.ceil(width / GRID_SIZE);
    let rows = Math.ceil(height / GRID_SIZE);
    const gridEnergies = new Float32Array(cols * rows);
    const gridTypes = new Uint8Array(cols * rows); // 0 = burnt orange, 1 = neon green

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      cols = Math.ceil(width / GRID_SIZE);
      rows = Math.ceil(height / GRID_SIZE);
    };
    window.addEventListener('resize', handleResize);

    const isFullScreen = fullScreenRoam ?? (typeof window !== 'undefined' && window.location.pathname !== '/');

    // Mouse coordinates
    const mouse = { x: width * 0.75, y: 280, active: false };

    // Entity state: Starts centered on app/dashboard, or in hero right-hand blank space on landing
    const startX = isFullScreen ? width * 0.5 : width * 0.75;
    const startY = isFullScreen ? height * 0.4 : 280;

    const entity = {
      x: startX,
      y: startY,
      targetX: startX,
      targetY: startY,
      vx: 0,
      vy: 0,
      facingLeft: false,
      wanderTimer: 0,
      roamSpeed: 0.022,
      scale: isFullScreen ? 2.2 : (width < 768 ? 1.8 : 5.5),
    };

    let scrollY = window.scrollY;

    const getHeroBounds = () => {
      const isDesktop = width >= 768;
      const minX = isDesktop ? width * 0.60 : width * 0.68;
      const maxX = isDesktop ? width * 0.90 : width * 0.88;
      const minY = isDesktop ? 150 : 80;
      const maxY = isDesktop ? Math.min(height * 0.68, 520) : 180;
      return { minX, maxX, minY, maxY };
    };

    const pickHeroRoamTarget = () => {
      const { minX, maxX, minY, maxY } = getHeroBounds();
      entity.targetX = minX + Math.random() * (maxX - minX);
      entity.targetY = minY + Math.random() * (maxY - minY);
      entity.roamSpeed = 0.016 + Math.random() * 0.018;
    };

    const pickScrolledRoamTarget = () => {
      const isMobile = width < 768;
      if (isMobile) {
        // Keep strictly in the right-side margin on mobile so it never obscures section text
        entity.targetX = width - 65;
        entity.targetY = 120 + Math.random() * (height - 240);
        entity.roamSpeed = 0.02;
      } else {
        const margin = 80;
        entity.targetX = margin + Math.random() * (width - margin * 2);
        entity.targetY = 140 + Math.random() * (height - 260);
        entity.roamSpeed = 0.024 + Math.random() * 0.02;
      }
    };

    const pickFullScreenRoamTarget = () => {
      // Roaming across dashboard viewport
      const marginX = Math.min(width * 0.08, 90);
      const marginY = Math.min(height * 0.08, 80);
      entity.targetX = marginX + Math.random() * (width - marginX * 2);
      entity.targetY = marginY + Math.random() * (height - marginY * 2);
      entity.roamSpeed = 0.016 + Math.random() * 0.02;
    };

    if (isFullScreen) {
      pickFullScreenRoamTarget();
    } else {
      pickHeroRoamTarget();
    }

    const handlePointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;

      // Excite Quantus pixel blocks near cursor
      const gx = Math.floor(e.clientX / GRID_SIZE);
      const gy = Math.floor(e.clientY / GRID_SIZE);
      const radius = 3;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
            const dist = Math.hypot(dx, dy);
            if (dist <= radius) {
              const idx = cy * cols + cx;
              const boost = (1 - dist / radius) * 0.65;
              gridEnergies[idx] = Math.min(1.0, gridEnergies[idx] + boost);
              gridTypes[idx] = Math.random() > 0.4 ? 0 : 1;
            }
          }
        }
      }

      // If mouse comes near the entity:
      const distToEntity = Math.hypot(e.clientX - entity.x, e.clientY - entity.y);
      if (distToEntity < 120) {
        if (isFullScreen) {
          const angle = Math.atan2(entity.y - e.clientY, entity.x - e.clientX);
          entity.targetX = Math.max(70, Math.min(width - 70, entity.x + Math.cos(angle) * 220));
          entity.targetY = Math.max(80, Math.min(height - 120, entity.y + Math.sin(angle) * 220));
          entity.roamSpeed = 0.042;
        } else if (scrollY < 60) {
          // In hero: playfully dodge, but stay strictly within right-hand blank space
          pickHeroRoamTarget();
        } else {
          // When scrolled: dart away to new open space
          const angle = Math.atan2(entity.y - e.clientY, entity.x - e.clientX);
          entity.targetX = Math.max(80, Math.min(width - 80, entity.x + Math.cos(angle) * 180));
          entity.targetY = Math.max(80, Math.min(height - 180, entity.y + Math.sin(angle) * 180));
          entity.roamSpeed = 0.04;
        }
      }
    };

    const handleScroll = () => {
      scrollY = window.scrollY;

      if (scrollY >= 60) {
        // Only move down / explore when scrolled down!
        // As scrollY increases, shift targetY downwards
        const scrollFactor = (scrollY - 60) * 0.12;
        entity.targetY = (280 + scrollFactor) % (height - 180) + 100;
        entity.roamSpeed = 0.03;
      } else {
        // Back at top hero: smoothly return to right-hand blank zone
        pickHeroRoamTarget();
      }

      // Light up horizontal Quantus dither wave on scroll
      const row = Math.floor(Math.random() * rows);
      for (let cx = 0; cx < cols; cx++) {
        const idx = row * cols + cx;
        gridEnergies[idx] = Math.min(0.85, gridEnergies[idx] + 0.28);
        gridTypes[idx] = 0;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('scroll', handleScroll, { passive: true });

    let animId: number;
    let time = 0;

    const tick = () => {
      time += 0.03;
      const palette = isDark ? ORANGE_PALETTE : GREEN_PALETTE;

      // Periodic autonomous wander
      entity.wanderTimer += 1;
      if (entity.wanderTimer > 150 + Math.random() * 80) {
        entity.wanderTimer = 0;
        if (isFullScreen) {
          pickFullScreenRoamTarget();
        } else if (scrollY < 60) {
          pickHeroRoamTarget();
        } else {
          pickScrolledRoamTarget();
        }
      }

      // If at hero level (scrollY < 60) and not fullscreen, strictly enforce right-hand blank space restriction
      if (!isFullScreen && scrollY < 60) {
        const { minX, maxX, minY, maxY } = getHeroBounds();
        entity.targetX = Math.max(minX, Math.min(maxX, entity.targetX));
        entity.targetY = Math.max(minY, Math.min(maxY, entity.targetY));
      } else if (isFullScreen) {
        const marginX = 60;
        const marginY = 60;
        entity.targetX = Math.max(marginX, Math.min(width - marginX, entity.targetX));
        entity.targetY = Math.max(marginY, Math.min(height - marginY, entity.targetY));
      }

      // Smooth floating ease toward target
      const dx = entity.targetX - entity.x;
      const dy = entity.targetY - entity.y;
      entity.vx = dx * entity.roamSpeed;
      entity.vy = dy * entity.roamSpeed;

      // Gentle floating bob
      const floatBob = Math.sin(time * 1.8) * 0.6;
      const floatDrift = Math.cos(time * 1.2) * 0.35;

      entity.x += entity.vx + floatDrift;
      entity.y += entity.vy + floatBob;

      // Hard clamp while roaming
      if (!isFullScreen && scrollY < 60) {
        const { minX, maxX, minY, maxY } = getHeroBounds();
        entity.x = Math.max(minX, Math.min(maxX, entity.x));
        entity.y = Math.max(minY, Math.min(maxY, entity.y));
      } else if (isFullScreen) {
        const marginX = 50;
        const marginY = 50;
        entity.x = Math.max(marginX, Math.min(width - marginX, entity.x));
        entity.y = Math.max(marginY, Math.min(height - marginY, entity.y));
      }

      if (Math.abs(entity.vx) > 0.2) {
        entity.facingLeft = entity.vx < 0;
      }

      ctx.clearRect(0, 0, width, height);

      // -------------------------------------------------------------
      // 1. Quantus Dithered Grid Matrix Pass
      // -------------------------------------------------------------
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          let energy = gridEnergies[idx];

          if (energy > 0.01) {
            gridEnergies[idx] = energy * 0.94;
            const bx = c * GRID_SIZE;
            const by = r * GRID_SIZE;
            const size = GRID_SIZE - 2;

            if (gridTypes[idx] === 0) {
              // Burnt Orange flare block (#E05326)
              ctx.fillStyle = `rgba(${palette.gridOrange}, ${energy * 0.22})`;
            } else {
              // Electric Green block (#39FF14); warmed in dark mode
              ctx.fillStyle = `rgba(${palette.gridGreen}, ${energy * 0.26})`;
            }
            ctx.fillRect(bx, by, size, size);
          } else {
            if ((c + r) % 4 === 0) {
              const bx = c * GRID_SIZE + GRID_SIZE / 2;
              const by = r * GRID_SIZE + GRID_SIZE / 2;
              ctx.fillStyle = 'rgba(0, 0, 0, 0.028)';
              ctx.fillRect(bx, by, 1.5, 1.5);
            }
          }
        }
      }

      // -------------------------------------------------------------
      // 2. The Figure Sprite (Only drawn on >= 640px so narrow mobile columns stay unobstructed)
      // -------------------------------------------------------------
      if (spriteReady && width >= 640) {
        const isMobile = width < 768;
        // Target scale:
        // Desktop hero (scrollY < 80): 5.5 (large and heroic in open space)
        // Desktop scrolled down (scrollY >= 80): smoothly reduce to 2.2 so it never blocks page content!
        // App / FullScreen views: 2.2
        // Mobile screens: 1.8
        const targetScale = isMobile
          ? 1.8
          : isFullScreen
            ? 2.2
            : (scrollY < 80 ? 5.5 : 2.2);

        // Smooth springy scale easing
        entity.scale += (targetScale - entity.scale) * 0.08;

        const dw = LOW_W * entity.scale;
        const dh = LOW_H * entity.scale;

        const drawX = entity.x - dw / 2;
        const drawY = entity.y - dh / 2;

        // Soft floor shadow
        ctx.save();
        ctx.fillStyle = palette.floor;
        ctx.beginPath();
        ctx.ellipse(entity.x, entity.y + dh / 2 - 8, dw * 0.34, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Glow pass
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.28;
        ctx.shadowColor = palette.glow;
        ctx.shadowBlur = 22;

        if (entity.facingLeft) {
          ctx.translate(entity.x, drawY);
          ctx.scale(-1, 1);
          ctx.drawImage(offscreen, -dw / 2 - 1, -1, dw + 2, dh + 2);
        } else {
          ctx.drawImage(offscreen, drawX - 1, drawY - 1, dw + 2, dh + 2);
        }
        ctx.restore();

        // Sharp nearest-neighbor pass
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.95;

        if (entity.facingLeft) {
          ctx.translate(entity.x, drawY);
          ctx.scale(-1, 1);
          ctx.drawImage(offscreen, -dw / 2, 0, dw, dh);
        } else {
          ctx.drawImage(offscreen, drawX, drawY, dw, dh);
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('scroll', handleScroll);
      themeObserver.disconnect();
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
