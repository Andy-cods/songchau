/** @type {import('next').NextConfig} */
// basePath env-driven (W2-05):
//   - Main server erp.songchau.vn build KHÔNG set APP_BASE_PATH → default '/ncc'
//     (giữ nguyên bản xem-trước /ncc, non-breaking).
//   - Server domain riêng vendor.songchau.vn build với APP_BASE_PATH="" → root '/'.
const bp = process.env.APP_BASE_PATH ?? '/ncc';
const nextConfig = {
  output: 'standalone',
  ...(bp ? { basePath: bp } : {}),
  // A1-07: bỏ rewrite /api → http://api:8000 (dead-code) — nginx ở CẢ 2 deploy đã
  // proxy /api trực tiếp tới backend TRƯỚC khi request tới Next, và service 'api'
  // không tồn tại trên stack vendor. api.ts gọi same-origin (BASE='') qua nginx.
};

export default nextConfig;
