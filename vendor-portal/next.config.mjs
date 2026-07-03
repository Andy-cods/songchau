/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // TẠM (Thang 2026-06-23): phục vụ cổng NCC tại https://erp.songchau.vn/ncc/
  // để xem trước khi có domain riêng. REVERT (bỏ basePath + 6 redirect /ncc)
  // khi đã gán domain ncc.songchau.vn.
  basePath: '/ncc',
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
