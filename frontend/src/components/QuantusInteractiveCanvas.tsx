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

    // Mouse coordinates (for pixel grid excitation & sprite curiosity)
    const mouse = { x: width * 0.5, y: height * 0.5, active: false };

    // Adventurous autonomous entity coordinates
    const entity = {
      x: width * 0.75,
      y: height * 0.35,
      targetX: width * 0.75,
      targetY: height * 0.35,
      vx: 0,
      vy: 0,
      facingLeft: false,
      wanderTimer: 0,
      roamSpeed: 0.025,
      isFleeing: false,
    };

    let lastScrollY = window.scrollY;

    const pickNewRoamTarget = () => {
      // Pick an adventurous point on screen, favoring interesting margins and open space
      const margin = 100;
      entity.targetX = margin + Math.random() * (width - margin * 2);
      entity.targetY = 80 + Math.random() * (height - 200);
      entity.roamSpeed = 0.015 + Math.random() * 0.02;
    };

    pickNewRoamTarget();

    const handlePointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;

      // Excite Quantus dithered grid blocks near cursor
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
              const boost = (1 - dist / radius) * 0.7;
              gridEnergies[idx] = Math.min(1.0, gridEnergies[idx] + boost);
              gridTypes[idx] = Math.random() > 0.4 ? 0 : 1;
            }
          }
        }
      }

      // If mouse gets very close to the entity, it playfully dashes away or explores
      const distToEntity = Math.hypot(e.clientX - entity.x, e.clientY - entity.y);
      if (distToEntity < 130) {
        // Playfully dart to a new adventure quadrant
        const angle = Math.atan2(entity.y - e.clientY, entity.x - e.clientX);
        entity.targetX = Math.max(80, Math.min(width - 80, entity.x + Math.cos(angle) * 220));
        entity.targetY = Math.max(80, Math.min(height - 180, entity.y + Math.sin(angle) * 220));
        entity.roamSpeed = 0.045; // swift adventurous dodge
      }
    };

    const handleScroll = () => {
      const curY = window.scrollY;
      const scrollDiff = curY - lastScrollY;
      lastScrollY = curY;

      // Adventurous entity responds to scroll momentum: floats along with the wave!
      entity.y -= scrollDiff * 0.15;
      entity.targetY -= scrollDiff * 0.25;

      // Wrap or clamp within window view
      if (entity.y < 60) entity.y = height - 120;
      if (entity.y > height - 60) entity.y = 80;

      // Light up horizontal Quantus dither line on scroll
      const row = Math.floor(Math.random() * rows);
      for (let cx = 0; cx < cols; cx++) {
        const idx = row * cols + cx;
        gridEnergies[idx] = Math.min(0.85, gridEnergies[idx] + 0.3);
        gridTypes[idx] = 0;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('scroll', handleScroll, { passive: true });

    let animId: number;
    let time = 0;

    const tick = () => {
      time += 0.03;

      // Periodic autonomous wander decision
      entity.wanderTimer += 1;
      if (entity.wanderTimer > 180 + Math.random() * 120) {
        entity.wanderTimer = 0;
        pickNewRoamTarget();
      }

      // Smooth floating ease toward roam target
      const dx = entity.targetX - entity.x;
      const dy = entity.targetY - entity.y;
      entity.vx = dx * entity.roamSpeed;
      entity.vy = dy * entity.roamSpeed;

      // Add gentle cosmic floating bob
      const floatBob = Math.sin(time * 1.8) * 0.8;
      const floatDrift = Math.cos(time * 1.2) * 0.5;

      entity.x += entity.vx + floatDrift;
      entity.y += entity.vy + floatBob;

      if (Math.abs(entity.vx) > 0.3) {
        entity.facingLeft = entity.vx < 0;
      }

      ctx.clearRect(0, 0, width, height);

      // -------------------------------------------------------------
      // 1. Quantus Dithered Background Matrix Pass
      // -------------------------------------------------------------
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          let energy = gridEnergies[idx];

          if (energy > 0.01) {
            gridEnergies[idx] = energy * 0.94; // smooth fade
            const bx = c * GRID_SIZE;
            const by = r * GRID_SIZE;
            const size = GRID_SIZE - 2;

            if (gridTypes[idx] === 0) {
              // Burnt Orange flare block (#E05326)
              ctx.fillStyle = `rgba(224, 83, 38, ${energy * 0.22})`;
            } else {
              // Electric Green block (#39FF14)
              ctx.fillStyle = `rgba(57, 255, 20, ${energy * 0.26})`;
            }
            ctx.fillRect(bx, by, size, size);
          } else {
            // Subtle quiet technical grid dots
            if ((c + r) % 4 === 0) {
              const bx = c * GRID_SIZE + GRID_SIZE / 2;
              const by = r * GRID_SIZE + GRID_SIZE / 2;
              ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
              ctx.fillRect(bx, by, 1.5, 1.5);
            }
          }
        }
      }

      // -------------------------------------------------------------
      // 2. Adventurous Background Entity (Real Figure Sprite)
      // -------------------------------------------------------------
      if (spriteReady) {
        const isMobile = width < 768;
        const SCALE = isMobile ? 4.5 : 6.0;
        const dw = LOW_W * SCALE;
        const dh = LOW_H * SCALE;

        const drawX = entity.x - dw / 2;
        const drawY = entity.y - dh / 2;

        // Subtle soft shadow on white floor under the roaming entity
        ctx.save();
        ctx.fillStyle = 'rgba(6, 46, 12, 0.09)';
        ctx.beginPath();
        ctx.ellipse(entity.x, entity.y + dh / 2 - 8, dw * 0.34, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Glow Pass: 1 screen pixel larger, soft green glow
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.28;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 22;

        if (entity.facingLeft) {
          ctx.translate(entity.x, drawY);
          ctx.scale(-1, 1);
          ctx.drawImage(offscreen, -dw / 2 - 1, -1, dw + 2, dh + 2);
        } else {
          ctx.drawImage(offscreen, drawX - 1, drawY - 1, dw + 2, dh + 2);
        }
        ctx.restore();

        // Sharp Pass: Crisp nearest-neighbor square pixels
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
