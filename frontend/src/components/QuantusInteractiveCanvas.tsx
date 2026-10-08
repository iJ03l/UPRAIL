import React, { useEffect, useRef } from 'react';
import { FIGURE_SPRITE_PNG } from './figureSpriteBase64';

const LOW_W = 48;
const LOW_H = 80;

export const QuantusInteractiveCanvas: React.FC = () => {
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
    const spriteImg = new Image();
    spriteImg.onload = () => {
      offCtx.clearRect(0, 0, LOW_W, LOW_H);
      offCtx.imageSmoothingEnabled = false;
      offCtx.drawImage(spriteImg, 0, 0, LOW_W, LOW_H);
      spriteReady = true;
    };
    spriteImg.src = FIGURE_SPRITE_PNG;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Dynamic Pixel Grid parameters (Quantus pixelated aesthetic)
    const GRID_SIZE = 24; // size of pixel blocks
    let cols = Math.ceil(width / GRID_SIZE);
    let rows = Math.ceil(height / GRID_SIZE);
    // Grid cell activations: stores intensity [0..1] and hue ('orange' | 'green')
    const gridEnergies = new Float32Array(cols * rows);
    const gridTypes = new Uint8Array(cols * rows); // 0 = orange, 1 = green

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      cols = Math.ceil(width / GRID_SIZE);
      rows = Math.ceil(height / GRID_SIZE);
    };
    window.addEventListener('resize', handleResize);

    // Mouse & Velocity Tracking
    const pos = { x: width / 2, y: height / 2 };
    const target = { x: pos.x, y: pos.y };
    let vx = 0;
    let vy = 0;
    let lastDirX = 0;
    let lastDirY = 1; // default facing down
    let lastScrollY = window.scrollY;
    let scrollVelocity = 0;

    const handlePointerMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;

      // Excite grid cells near cursor (Quantus interactive matrix)
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
              const boost = (1 - dist / radius) * 0.75;
              gridEnergies[idx] = Math.min(1.0, gridEnergies[idx] + boost);
              gridTypes[idx] = Math.random() > 0.4 ? 0 : 1; // 0 = burnt orange, 1 = neon green
            }
          }
        }
      }
    };

    const handleScroll = () => {
      const curY = window.scrollY;
      scrollVelocity = (curY - lastScrollY);
      lastScrollY = curY;

      // Scroll excites a horizontal swath of the pixel grid
      const excitedRow = Math.floor(Math.random() * rows);
      for (let cx = 0; cx < cols; cx++) {
        const idx = excitedRow * cols + cx;
        gridEnergies[idx] = Math.min(0.9, gridEnergies[idx] + 0.35);
        gridTypes[idx] = 0;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('scroll', handleScroll, { passive: true });

    let animId: number;
    let time = 0;

    const tick = () => {
      time += 0.03;
      scrollVelocity *= 0.92;

      // Velocity easing: pos follows target
      vx = target.x - pos.x;
      vy = target.y - pos.y;
      pos.x += vx * 0.08;
      pos.y += vy * 0.08;

      const len = Math.hypot(vx, vy);
      if (len > 0.4) {
        lastDirX = vx / len;
        lastDirY = vy / len;
      }

      ctx.clearRect(0, 0, width, height);

      // -------------------------------------------------------------
      // 1. Quantus Pixelated Background Matrix Pass
      // -------------------------------------------------------------
      // Render subtle pixel blocks on white background
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          let energy = gridEnergies[idx];

          if (energy > 0.01) {
            gridEnergies[idx] = energy * 0.94; // fade decay
            const bx = c * GRID_SIZE;
            const by = r * GRID_SIZE;
            const size = GRID_SIZE - 2;

            if (gridTypes[idx] === 0) {
              // Burnt Orange flare block (#E05326 / #FF6B35)
              ctx.fillStyle = `rgba(224, 83, 38, ${energy * 0.28})`;
            } else {
              // Electric Green block (#39FF14)
              ctx.fillStyle = `rgba(57, 255, 20, ${energy * 0.32})`;
            }
            ctx.fillRect(bx, by, size, size);
          } else {
            // Very faint ambient grid point
            if ((c + r) % 4 === 0) {
              const bx = c * GRID_SIZE + GRID_SIZE / 2;
              const by = r * GRID_SIZE + GRID_SIZE / 2;
              ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
              ctx.fillRect(bx, by, 1.5, 1.5);
            }
          }
        }
      }

      // -------------------------------------------------------------
      // 2. Trailing Pixel Figure (from real uploaded image)
      // -------------------------------------------------------------
      if (spriteReady) {
        const isMobile = width < 768;
        const SCALE = isMobile ? 5 : 7;
        const behind = isMobile ? 52 : 72; // pixels behind the pointer
        const headOffset = isMobile ? 24 : 36; // head below the cursor

        // The sprite anchor is the top of the head, and that point sits behind the pointer
        const spriteHeadX = pos.x - lastDirX * behind;
        const spriteHeadY = pos.y - lastDirY * behind + headOffset;

        const dw = LOW_W * SCALE;
        const dh = LOW_H * SCALE;

        // Anchor is top-center of head: (LOW_W/2 * SCALE, 0)
        // Sprite drawing top-left coordinate:
        const drawX = spriteHeadX - dw / 2;
        const drawY = spriteHeadY;

        const isFacingLeft = lastDirX < 0 || vx < -0.5;

        // A. Subtle floor shadow under trailing figure on white ground
        ctx.save();
        ctx.fillStyle = 'rgba(6, 46, 12, 0.12)';
        ctx.beginPath();
        ctx.ellipse(spriteHeadX, spriteHeadY + dh - 10, dw * 0.32, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // B. Soft Glow Pass: 1 screen pixel larger, ~0.3 alpha behind sharp pass
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.32;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 18;

        if (isFacingLeft) {
          ctx.translate(spriteHeadX, drawY);
          ctx.scale(-1, 1);
          ctx.drawImage(offscreen, -dw / 2 - 1, -1, dw + 2, dh + 2);
        } else {
          ctx.drawImage(offscreen, drawX - 1, drawY - 1, dw + 2, dh + 2);
        }
        ctx.restore();

        // C. Sharp Pass: nearest-neighbor scaled 6-8x with crisp square blocks
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1.0;

        if (isFacingLeft) {
          ctx.translate(spriteHeadX, drawY);
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
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-10"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
