import { redirect } from 'next/navigation';

// Thang 2026-07-02: trang /analytics/xnk (mồ côi, không có trong menu, 2 panel gọi
// endpoint không tồn tại) đã bỏ. Trang tra cứu giá XNK duy nhất là /market-prices
// (đã trong menu, chạy thật, dữ liệu ~35K dòng). Giữ route để không 404 với link cũ.
export default function XnkAnalyticsRemovedPage() {
  redirect('/market-prices');
}
