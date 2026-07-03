// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /finance/payables không còn nav/href/router.push nào trỏ tới.
// Nghiệp vụ công nợ phải trả đã có sẵn trong /finance/overview
// (ARAPTable variant="ap", label "Công nợ phải trả") — theo Thang, giữ 1
// chỗ duy nhất là finance/overview. Redirect thẳng về đó (không phải
// trang chủ).
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/finance/overview');
}
