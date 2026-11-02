import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: 'www.artic.edu' }] },
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      }
    ];
  },
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    return target ? [{ source: '/api/:path*', destination: `${target}/:path*` }] : [];
  }
};

export default nextConfig;
