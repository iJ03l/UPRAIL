/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiTarget = process.env.API_URL || 'http://127.0.0.1:8787';
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${apiTarget}/auth/:path*`,
      },
      {
        source: '/health',
        destination: `${apiTarget}/health`,
      },
    ];
  },
};

export default nextConfig;
