import type { NextConfig } from 'next';

const frameAncestors = process.env.EMBED_FRAME_ANCESTORS ?? "'self'";

/** Baseline security headers for every route. */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@suntec/ui', '@suntec/core', '@suntec/types'],
  // One customer experience at /play. Old links (portal, in-app embed) keep working.
  async redirects() {
    return [
      { source: '/embed', has: [{ type: 'query', key: 'code', value: '(?<code>.+)' }], destination: '/api/v1/auth/exchange?code=:code', permanent: false },
      { source: '/portal/login', destination: '/play/signin', permanent: true },
      { source: '/:area(portal|embed)/:page(badges|leaderboard|inbox|history|profile)', destination: '/play', permanent: true },
      { source: '/:area(portal|embed)/error', destination: '/play/error', permanent: true },
      { source: '/:area(portal|embed)', destination: '/play', permanent: true },
      { source: '/:area(portal|embed)/:path*', destination: '/play/:path*', permanent: true },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Admin must never be framed.
        source: '/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        // Play & Win is loaded top-level (browser / native WebView); framing only by allow-listed hosts.
        source: '/play/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` }],
      },
      { source: '/play', headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` }] },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
