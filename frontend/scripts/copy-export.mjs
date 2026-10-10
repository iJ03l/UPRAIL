/**
 * Dual build step: the Cloudflare Worker serves `frontend/dist` as static
 * assets (see worker/wrangler.jsonc), while `next build` with
 * `output: 'export'` emits into `out/`. This script syncs `out/` into
 * `dist/` (clean first, so stale artifacts can never be served) so that
 * `npm run build` alone produces everything the worker needs.
 */
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, '..', 'out');
const distDir = path.join(root, '..', 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(outDir, distDir, { recursive: true });
console.log(`[copy-export] synced ${outDir} -> ${distDir}`);
