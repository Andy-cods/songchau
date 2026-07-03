// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /finance/cash-book không còn nav/href/router.push nào trỏ tới.
// Nghiệp vụ sổ quỹ đã được tích hợp NGAY TRONG /finance/overview (widget
// "cash-book create modal" + query ['finance-cashbook'] gọi cùng API
// /api/v1/finance-management/cash-book) — theo Thang, giữ 1 chỗ duy nhất
// là finance/overview. Redirect thẳng về đó (không phải trang chủ).
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/finance/overview');
}
