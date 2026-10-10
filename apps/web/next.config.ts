import type { NextConfig } from 'next';

// Security headers (spec 013 tech §5.1, FR-PRIV-011). Pages are static, so scripts may be inline (no per-request
// nonce: tasks/M6-launch.md decision 1); everything else is limited to this site, Cloudflare's human check and
// Cloudflare's cookieless analytics. The browser talks to no other service (sign-in runs on the server).
const dev = process.env.NODE_ENV === 'development';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
  'frame-src https://challenges.cloudflare.com',
  "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@domains-all/config',
    '@domains-all/core',
    '@domains-all/email',
    '@domains-all/jev',
    '@domains-all/log',
    '@domains-all/metrics',
  ],
  serverExternalPackages: ['wink-nlp', 'wink-eng-lite-web-model'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
