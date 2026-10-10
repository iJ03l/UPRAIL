/**
 * Static export by default: the Cloudflare Worker serves the exported assets
 * and owns /api + /auth on the same origin.
 *
 * `NEXT_EXPORT=0` (used by `npm run dev`) keeps the dev server dynamic and
 * enables the rewrites that proxy API calls to a locally running Worker.
 */
const isStaticExport = process.env.NEXT_EXPORT !== '0';

const apiTarget = process.env.API_URL || 'http://127.0.0.1:8787';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport ? { output: 'export' } : {}),
  ...(!isStaticExport
    ? {
        rewrites: [
          { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
          { source: '/auth/:path*', destination: `${apiTarget}/auth/:path*` },
          { source: '/health', destination: `${apiTarget}/health` },
        ],
      }
    : {}),
};

export default nextConfig;
