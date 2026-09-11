import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@thesis/ui', '@thesis/contracts'],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: (process.env.API_BASE_URL ?? 'http://127.0.0.1:4000') + '/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
export default config;
