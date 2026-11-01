import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: 'www.artic.edu' }] },
  turbopack: { root: process.cwd() },
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    return target ? [{ source: '/api/:path*', destination: `${target}/:path*` }] : [];
  }
};

export default nextConfig;
