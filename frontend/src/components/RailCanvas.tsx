'use client';

import React, { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  speed: number;
  trackIndex: number;
  size: number;
  color: string;
  alpha: number;
  glow: number;
}

export const RailCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, targetX: -1000, targetY: -1000, isHovering: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.targetX = e.clientX;
      mouseRef.current.targetY = e.clientY;
      mouseRef.current.isHovering = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.isHovering = false;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    // Track definitions
    const trackCount = 14;
    const particles: Particle[] = [];
    const particleCount = 75;

    // Palette: Monochrome shades of black, stone, and optic white
    const colors = [
      '#000000',
      '#262626',
      '#525252',
      '#737373',
      '#A3A3A3',
    ];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: 1.2 + Math.random() * 2.8,
        trackIndex: Math.floor(Math.random() * trackCount),
        size: 1.5 + Math.random() * 2.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.35 + Math.random() * 0.65,
        glow: 8 + Math.random() * 16,
      });
    }

    let time = 0;

    const render = () => {
      time += 0.015;

      // Smooth mouse interpolation
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.08;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const mouseX = mouseRef.current.x;
      const mouseY = mouseRef.current.y;

      // Draw perspective tracks
      for (let t = 0; t < trackCount; t++) {
        const baseOffset = (t - trackCount / 2) * (width / (trackCount - 1));
        const startX = width / 2 + baseOffset * 0.25;
        const startY = -50;
        const endX = width / 2 + baseOffset * 1.6;
        const endY = height + 100;

        ctx.beginPath();
        const steps = 40;
        for (let s = 0; s <= steps; s++) {
          const progress = s / steps;
          let px = startX + (endX - startX) * progress;
          let py = startY + (endY - startY) * progress;

          // Mouse gravitational distortion
          const dx = px - mouseX;
          const dy = py - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 260;

          if (dist < maxDist && dist > 1) {
            const force = (1 - dist / maxDist) * 38;
            px += (dx / dist) * force;
            py += (dy / dist) * force;
          }

          // Subtle sine wave pulse along tracks
          px += Math.sin(time * 2 + progress * 8) * 3;

          if (s === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }

        // Track stroke styling
        const isCenter = Math.abs(t - trackCount / 2) <= 2;
        ctx.strokeStyle = isCenter
          ? 'rgba(224, 83, 38, 0.22)'
          : 'rgba(200, 70, 28, 0.08)';
        ctx.lineWidth = isCenter ? 1.5 : 1;
        ctx.stroke();

        // Horizontal rail crossties
        if (t < trackCount - 1) {
          const nextOffset = (t + 1 - trackCount / 2) * (width / (trackCount - 1));
          for (let r = 0; r < 9; r++) {
            const prog = ((r / 9 + (time * 0.15)) % 1);
            const x1 = width / 2 + baseOffset * (0.25 + prog * 1.35);
            const y1 = height * prog;
            const x2 = width / 2 + nextOffset * (0.25 + prog * 1.35);
            const y2 = height * prog;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(224, 83, 38, 0.05)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw and update glowing particles
      for (const p of particles) {
        const trackBase = (p.trackIndex - trackCount / 2) * (width / (trackCount - 1));
        const progress = (p.y / height);

        const targetX = width / 2 + trackBase * (0.25 + progress * 1.35);
        p.x += (targetX - p.x) * 0.08;
        p.y += p.speed;

        // Mouse gravitational attraction on particles
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 180 && dist > 1) {
          const repel = (1 - dist / 180) * 8;
          p.x += (dx / dist) * repel;
          p.y += (dy / dist) * repel;
        }

        // Reset particle when it leaves screen
        if (p.y > height + 20) {
          p.y = -20;
          p.x = width / 2 + trackBase * 0.25;
        }

        // Render glowing particle
        ctx.save();
        ctx.shadowBlur = p.glow;
        ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // White core highlight for high-speed particles
        if (p.speed > 2.5) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Cursor radiant focal glow in burnt orange
      if (mouseRef.current.isHovering) {
        const grad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 320);
        grad.addColorStop(0, 'rgba(224, 83, 38, 0.14)');
        grad.addColorStop(0.5, 'rgba(255, 107, 53, 0.05)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80 transition-opacity duration-1000"
      style={{ background: 'transparent' }}
    />
  );
};
