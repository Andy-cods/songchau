/** @type {import('next').NextConfig} */
// basePath env-driven (W2-05):
//   - Main server erp.songchau.vn build KHÔNG set APP_BASE_PATH → default '/ncc'
//     (giữ nguyên bản xem-trước /ncc, non-breaking).
//   - Server domain riêng vendor.songchau.vn build với APP_BASE_PATH="" → root '/'.
const bp = process.env.APP_BASE_PATH ?? '/ncc';
const nextConfig = {
  output: 'standalone',
  ...(bp ? { basePath: bp } : {}),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://api:8000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
