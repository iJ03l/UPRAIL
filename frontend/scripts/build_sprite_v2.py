"""
Refine the sprite generation:
1. Load figure-source.jpg, segment green figure cleanly, crop tightly.
2. Downscale to 48x80 with nearest/area sampling.
3. Keep head blank (no dark spots inside the head oval - head is a glowing blank egg with cracks).
4. Outline the entire perimeter with #062e0c so the sprite is razor sharp on a white background.
5. Palette:
   - outline: #062e0c
   - abs/deep shadow: #0a5c12
   - deep body: #0d8a18
   - mid body: #39ff14
   - crack/highlight: #d8ff6a
"""
import numpy as np
from PIL import Image
from collections import deque
from pathlib import Path

OUT = Path("public/sprite")
OUT.mkdir(parents=True, exist_ok=True)

PALETTE = {
    "outline": (0x06, 0x2E, 0x0C),
    "abs": (0x0A, 0x5C, 0x12),
    "deep": (0x0D, 0x8A, 0x18),
    "mid": (0x39, 0xFF, 0x14),
    "crack": (0xD8, 0xFF, 0x6A),
}

def build_perfect_sprite(gw=48, gh=80):
    im = Image.open("assets-src/figure-source.jpg").convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    h, w, _ = rgb.shape

    # Segment green figure from checkerboard/white sticker border
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Green energy figure is saturated green
    green_diff = g - np.maximum(r, b)
    is_figure = (green_diff > 25) & (g > 60)

    # Flood fill hole closing from corners
    outside = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not is_figure[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not is_figure[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))

    while q:
        cy, cx = q.popleft()
        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not is_figure[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))

    mask = ~outside

    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop_rgb = rgb[y0:y1, x0:x1]
    crop_mask = mask[y0:y1, x0:x1]
    ch, cw = crop_mask.shape

    scale = min(gw / cw, gh / ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
    ox = (gw - tw) // 2
    oy = 0

    grid = np.zeros((gh, gw, 4), dtype=np.uint8)

    # Downscale crop to target grid
    for ty in range(th):
        sy0 = int(ty * ch / th)
        sy1 = max(sy0 + 1, int((ty + 1) * ch / th))
        for tx in range(tw):
            sx0 = int(tx * cw / tw)
            sx1 = max(sx0 + 1, int((tx + 1) * cw / tw))

            cell_m = crop_mask[sy0:sy1, sx0:sx1]
            if cell_m.mean() < 0.40:
                continue

            cell_rgb = crop_rgb[sy0:sy1, sx0:sx1][cell_m].mean(axis=0)
            cr, cg, cb = cell_rgb

            gx = ox + tx
            gy = oy + ty

            # Brightness/crack determination
            lum = 0.299 * cr + 0.587 * cg + 0.114 * cb
            
            # Head area is top portion (gy < 24 and gx between 18 and 30)
            is_head = (gy <= 23) and (18 <= gx <= 30)
            
            if lum > 190:
                color = PALETTE["crack"]
            elif lum > 135:
                color = PALETTE["mid"]
            elif lum > 85:
                if is_head:
                    color = PALETTE["mid"] # Keep head blank/glowing, no dark mouth/eyes
                else:
                    color = PALETTE["deep"]
            else:
                if is_head:
                    color = PALETTE["mid"]
                else:
                    color = PALETTE["abs"]

            grid[gy, gx, :3] = color
            grid[gy, gx, 3] = 255

    # Head shape polish: ensure oval head has blank interior with crack highlight
    # and NO dark patches
    for y in range(4, 23):
        for x in range(19, 31):
            if grid[y, x, 3] > 0:
                cur = tuple(grid[y, x, :3])
                if cur == PALETTE["abs"] or cur == PALETTE["deep"]:
                    grid[y, x, :3] = PALETTE["mid"]

    # Now add 1px dark green outline (#062e0c) around all boundary/perimeter pixels
    final_grid = grid.copy()
    for y in range(gh):
        for x in range(gw):
            if grid[y, x, 3] > 0:
                # Check 4 neighbors
                is_boundary = False
                for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                    ny, nx = y + dy, x + dx
                    if ny < 0 or ny >= gh or nx < 0 or nx >= gw or grid[ny, nx, 3] == 0:
                        is_boundary = True
                        break
                if is_boundary:
                    final_grid[y, x, :3] = PALETTE["outline"]

    img = Image.fromarray(final_grid, "RGBA")
    img.save(OUT / f"figure-{gw}x{gh}.png")
    img.resize((gw * 7, gh * 7), Image.NEAREST).save(OUT / f"preview-{gw}x{gh}.png")
    print(f"Generated {gw}x{gh} sprite with outline!")

build_perfect_sprite(48, 80)
