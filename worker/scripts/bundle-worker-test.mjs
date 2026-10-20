// Builds the Worker for the Miniflare test harness.
//
// esbuild cannot represent Wrangler's native `.wasm` module imports, and
// workerd forbids compiling wasm from bytes at runtime ("Wasm code generation
// disallowed by embedder"). So we let Wrangler do the bundling — it emits an
// ES module plus the two wasm sidecars — and copy that output to the path the
// test harness expects.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

// Wrangler validates that the configured assets directory exists, even for a
// dry run. Tests do not exercise static assets, so an empty placeholder is
// enough (and keeps `npm test` independent of a frontend build).
await mkdir('../frontend/dist', { recursive: true });

await rm('dist-test', { recursive: true, force: true });
execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir=dist-test'], {
  stdio: 'inherit',
});

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

for (const file of await readdir('dist-test')) {
  if (file === 'index.js') {
    await copyFile('dist-test/index.js', 'dist/worker.js');
  } else if (file.endsWith('.wasm')) {
    await copyFile(`dist-test/${file}`, `dist/${file}`);
  }
}
