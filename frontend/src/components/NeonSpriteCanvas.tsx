import React, { useEffect, useRef } from 'react';

const LOW_W = 64;
const LOW_H = 96;
const SCALE = 7;

export const NeonSpriteCanvas: React.FC = () => {
  const viewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const view = viewCanvasRef.current;
    if (!view) return;

    const ctx = view.getContext('2d');
    if (!ctx) return;

    // Offscreen 64x96 low-resolution buffer
    const low = document.createElement('canvas');
    low.width = LOW_W;
    low.height = LOW_H;
    const pen = low.getContext('2d');
    if (!pen) return;

    let animId: number;
    let width = (view.width = window.innerWidth);
    let height = (view.height = window.innerHeight);

    const pos = { x: width / 2, y: height / 2 };
    const target = { x: pos.x, y: pos.y };

    const handleResize = () => {
      if (!view) return;
      width = view.width = window.innerWidth;
      height = view.height = window.innerHeight;
    };

    const handlePointerMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', handlePointerMove);

    function px(x: number, y: number, w: number, h: number, color: string) {
      if (!pen) return;
      pen.fillStyle = color;
      pen.fillRect(Math.floor(x), Math.floor(y), w, h);
    }

    function pxOutline(x: number, y: number, w: number, h: number, fillColor: string, outlineColor = '#052e08') {
      if (!pen) return;
      // Outline 1px border
      pen.fillStyle = outlineColor;
      pen.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, w + 2, h + 2);
      // Fill
      pen.fillStyle = fillColor;
      pen.fillRect(Math.floor(x), Math.floor(y), w, h);
    }

    let time = 0;

    const render = () => {
      time += 0.05;

      // Ease position toward target cursor
      pos.x += (target.x - pos.x) * 0.12;
      pos.y += (target.y - pos.y) * 0.12;

      const dx = target.x - pos.x;
      const lean = Math.max(-1, Math.min(1, dx / 80));
      const isFacingLeft = target.x < pos.x;
      const bob = Math.round(Math.sin(time * 5) * 1);

      // Clear low-res sprite buffer
      pen.clearRect(0, 0, LOW_W, LOW_H);

      const ox = lean * 3;

      // Colors:
      const cBody = '#39ff14';      // Neon green
      const cShadow = '#0b7a12';    // Dark shadow / abs
      const cCrack = '#e8ff6a';     // Bright energy vein
      const cOutline = '#052e08';   // Deep 1px boundary outline

      // 1. Legs (capsules from hips 60 down to 88, with small gap)
      // Left leg
      pxOutline(20, 60 + bob, 8, 27, cBody, cOutline);
      // Left foot
      px(18, 85 + bob, 10, 3, cShadow);

      // Right leg
      pxOutline(36, 60 + bob, 8, 27, cBody, cOutline);
      // Right foot
      px(36, 85 + bob, 10, 3, cShadow);

      // 2. Torso (shoulders 12..52, hips 20..44, y 30..62)
      // Torso outline
      pen.fillStyle = cOutline;
      pen.beginPath();
      pen.moveTo(11 + ox, 29 + bob);
      pen.lineTo(53 + ox, 29 + bob);
      pen.lineTo(45 + ox * 0.5, 63 + bob);
      pen.lineTo(19 + ox * 0.5, 63 + bob);
      pen.closePath();
      pen.fill();

      // Torso fill
      pen.fillStyle = cBody;
      pen.beginPath();
      pen.moveTo(12 + ox, 30 + bob);
      pen.lineTo(52 + ox, 30 + bob);
      pen.lineTo(44 + ox * 0.5, 62 + bob);
      pen.lineTo(20 + ox * 0.5, 62 + bob);
      pen.closePath();
      pen.fill();

      // Defined Chest / Pectorals outline
      px(20 + ox, 34 + bob, 11, 6, cBody);
      px(33 + ox, 34 + bob, 11, 6, cBody);
      px(20 + ox, 39 + bob, 11, 1, cShadow);
      px(33 + ox, 39 + bob, 11, 1, cShadow);
      px(31 + ox, 34 + bob, 2, 7, cShadow); // Sternum line

      // Defined Six-pack Abs (2 columns x 3 rows, inset around x 26-38, y 42-58)
      px(26 + ox, 43 + bob, 5, 4, cShadow);
      px(33 + ox, 43 + bob, 5, 4, cShadow);

      px(26 + ox, 49 + bob, 5, 4, cShadow);
      px(33 + ox, 49 + bob, 5, 4, cShadow);

      px(26 + ox, 55 + bob, 5, 4, cShadow);
      px(33 + ox, 55 + bob, 5, 4, cShadow);

      // 3. Far Arm (back shoulder)
      const farArmLift = Math.round(lean * -2);
      pxOutline(5 + ox * 0.4, 32 + bob + farArmLift, 7, 24, cBody, cOutline);
      px(5 + ox * 0.4, 53 + bob + farArmLift, 7, 3, cShadow); // hand

      // 4. Near Arm (front shoulder - lifts slightly toward cursor)
      const nearArmLift = Math.round(lean * 5);
      pxOutline(52 + ox, 32 + bob - Math.max(0, nearArmLift), 7, 24, cBody, cOutline);
      px(52 + ox, 53 + bob - Math.max(0, nearArmLift), 7, 3, cShadow); // hand

      // 5. Thick Neck (x 26..38, y 24..30)
      pxOutline(26 + ox, 23 + bob, 12, 7, cBody, cOutline);

      // 6. Oval Blank Head (oval/ellipse centered near 32, 14, radius 10x12)
      // Head outline
      pen.fillStyle = cOutline;
      pen.beginPath();
      pen.ellipse(32 + ox, 14 + bob, 11, 13, 0, 0, Math.PI * 2);
      pen.fill();

      // Head fill - Completely blank, no eyes, no mouth
      pen.fillStyle = cBody;
      pen.beginPath();
      pen.ellipse(32 + ox, 14 + bob, 10, 12, 0, 0, Math.PI * 2);
      pen.fill();

      // 7. Energy Cracks (1-pixel brighter green polylines: #e8ff6a in broken segments)
      pen.strokeStyle = cCrack;
      pen.lineWidth = 1;

      // Head crack
      pen.beginPath();
      pen.moveTo(33 + ox, 5 + bob);
      pen.lineTo(31 + ox, 11 + bob);
      pen.lineTo(35 + ox, 17 + bob);
      pen.stroke();

      // Chest & Torso crack veins
      pen.beginPath();
      pen.moveTo(32 + ox, 25 + bob);
      pen.lineTo(30 + ox, 33 + bob);
      pen.lineTo(24 + ox, 38 + bob);
      pen.stroke();

      pen.beginPath();
      pen.moveTo(32 + ox, 33 + bob);
      pen.lineTo(36 + ox, 41 + bob);
      pen.lineTo(32 + ox, 47 + bob);
      pen.lineTo(34 + ox, 58 + bob);
      pen.stroke();

      // Leg crack vein
      pen.beginPath();
      pen.moveTo(24, 62 + bob);
      pen.lineTo(22, 72 + bob);
      pen.lineTo(25, 80 + bob);
      pen.stroke();

      // Near Arm crack
      pen.beginPath();
      pen.moveTo(55 + ox, 34 + bob - Math.max(0, nearArmLift));
      pen.lineTo(54 + ox, 44 + bob - Math.max(0, nearArmLift));
      pen.stroke();

      // Clear main viewport canvas
      ctx.clearRect(0, 0, width, height);

      // Draw shadow under feet on the white ground
      const groundY = pos.y + (LOW_H * SCALE) / 2 - 12;
      ctx.save();
      ctx.fillStyle = 'rgba(11, 122, 18, 0.15)';
      ctx.beginPath();
      ctx.ellipse(pos.x, groundY, 48, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const dw = LOW_W * SCALE;
      const dh = LOW_H * SCALE;
      const sx = pos.x - dw / 2;
      const sy = pos.y - dh / 2;

      // Glow pass: Draw the sprite in #39ff14 at 0.35 alpha on view canvas (with glow blur)
      ctx.save();
      ctx.shadowColor = '#39ff14';
      ctx.shadowBlur = 28;
      ctx.globalAlpha = 0.45;
      if (isFacingLeft) {
        ctx.translate(pos.x, pos.y);
        ctx.scale(-1, 1);
        ctx.drawImage(low, -dw / 2, -dh / 2, dw, dh);
      } else {
        ctx.drawImage(low, sx, sy, dw, dh);
      }
      ctx.restore();

      // Sharp nearest-neighbor scaled pass
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (isFacingLeft) {
        ctx.translate(pos.x, pos.y);
        ctx.scale(-1, 1);
        ctx.drawImage(low, -dw / 2, -dh / 2, dw, dh);
      } else {
        ctx.drawImage(low, sx, sy, dw, dh);
      }
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={viewCanvasRef}
      className="fixed inset-0 pointer-events-none z-20"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
