"""
Build the UPRAIL pixel sprite from the real figure render.

Pipeline (nothing is redrawn by hand):
  1. background removal  - checkerboard + white sticker border are low-saturation,
                           the figure is saturated green. Keep saturated pixels,
                           then fill interior holes (white-hot crack cores).
  2. tight crop          - bounding box of the remaining figure.
  3. downscale           - area-average each target cell, alpha = coverage.
  4. palette snap        - every opaque cell snaps to one of 5 colours.

Outputs PNGs into public/sprite/ at several grid sizes plus a scaled preview.
Usage: python3 scripts/build_sprite.py <source-image>
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

PALETTE = {
    "outline": (0x06, 0x2E, 0x0C),
    "abs": (0x0A, 0x5C, 0x12),
    "deep": (0x0D, 0x8A, 0x18),
    "mid": (0x39, 0xFF, 0x14),
    "crack": (0xD8, 0xFF, 0x6A),
}
PAL = np.array(list(PALETTE.values()), dtype=np.float32)
# perceptual weights so luminance dominates the snap (keeps cracks vs body distinct)
W = np.array([0.30, 0.59, 0.11], dtype=np.float32)

OUT = Path(__file__).resolve().parent.parent / "public" / "sprite"


def figure_mask(rgb: np.ndarray) -> np.ndarray:
    r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    green_dominant = (g > r + 12) & (g > b + 12)
    mask = (sat > 0.28) & green_dominant

    # fill holes: anything not reachable from the border through non-mask is interior
    h, w = mask.shape
    outside = np.zeros_like(mask)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    filled = ~outside

    # drop tiny detached specks (floating embers / stray streaks) by keeping the largest blob
    labels = np.zeros((h, w), dtype=np.int32)
    best_label, best_size, cur = 0, 0, 0
    for sy in range(h):
        for sx in range(w):
            if filled[sy, sx] and labels[sy, sx] == 0:
                cur += 1
                size = 0
                labels[sy, sx] = cur
                q.append((sy, sx))
                while q:
                    y, x = q.popleft()
                    size += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and filled[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = cur
                            q.append((ny, nx))
                if size > best_size:
                    best_size, best_label = size, cur
    return labels == best_label


def snap(rgb: np.ndarray) -> np.ndarray:
    d = (((rgb[:, None, :] - PAL[None, :, :]) ** 2) * W).sum(-1)
    return PAL[d.argmin(-1)]


def build(src: Path, gw: int, gh: int, coverage: float = 0.42) -> Image.Image:
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im)
    mask = figure_mask(rgb)

    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = rgb[y0:y1, x0:x1].astype(np.float32)
    cmask = mask[y0:y1, x0:x1]
    ch, cw = cmask.shape

    # fit crop into grid preserving aspect, centred horizontally, anchored to the top (head)
    scale = min(gw / cw, gh / ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
    ox, oy = (gw - tw) // 2, 0

    out = np.zeros((gh, gw, 4), dtype=np.uint8)
    for ty in range(th):
        sy0, sy1 = int(ty * ch / th), max(int((ty + 1) * ch / th), int(ty * ch / th) + 1)
        for tx in range(tw):
            sx0, sx1 = int(tx * cw / tw), max(int((tx + 1) * cw / tw), int(tx * cw / tw) + 1)
            m = cmask[sy0:sy1, sx0:sx1]
            cov = m.mean()
            if cov < coverage:
                continue
            col = crop[sy0:sy1, sx0:sx1][m].mean(0)
            out[oy + ty, ox + tx, :3] = snap(col[None, :])[0]
            out[oy + ty, ox + tx, 3] = 255
    return Image.fromarray(out, "RGBA")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for gw, gh in ((48, 80), (72, 120), (96, 160)):
        img = build(src, gw, gh)
        img.save(OUT / f"figure-{gw}x{gh}.png")
        img.resize((gw * 6, gh * 6), Image.NEAREST).save(OUT / f"preview-{gw}x{gh}.png")
        a = np.asarray(img)[..., 3]
        print(f"{gw}x{gh}: {int((a > 0).sum())} opaque cells")


if __name__ == "__main__":
    main()
