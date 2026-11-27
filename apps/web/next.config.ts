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
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Admin and portal must never be framed.
        source: '/(admin|portal)/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        // Embed is loaded top-level in the native WebView; framing only by allow-listed hosts.
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
