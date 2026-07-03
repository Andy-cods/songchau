/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@radix-ui'],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://api:8000/api/:path*',
      },
    ];
  },
  // Thang 2026-06-19: IA migration — old top-level finance routes moved under /finance/*
  // Use HTTP 308 (permanent) redirects so external bookmarks/links migrate cleanly.
  async redirects() {
    return [
      {
        source: '/invoices',
        destination: '/finance/invoices',
        permanent: true,
      },
      {
        source: '/payment-approvals',
        destination: '/finance/payment-approvals',
        permanent: true,
      },
    ];
  },
  // Thang 2026-06-15: defensive caching headers — prevents stale HTML entrypoints
  // from pinning clients to outdated chunk manifests. Root cause discovered when
  // round_filter wiring landed 2026-06-13 but some users still saw old behavior
  // because their browser/CDN had cached the previous /bqms HTML which referenced
  // an older page-XXXX.js chunk (lacking round_filter wiring). HTML pages with
  // dynamic data must NEVER be cached; static chunks (immutable hashed) still get
  // Next.js default long-cache via /_next/static/.
  async headers() {
    return [
      {
        source: '/bqms',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
      {
        source: '/bqms/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
