// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /documents (trang GỐC, danh sách /api/v1/documents) không còn
// nav/href/router.push nào trỏ tới — toàn bộ nav thực tế dùng
// /documents/browser (trang con, filesystem browser, VẪN GIỮ NGUYÊN,
// không đụng tới). Re-verify: grep toàn frontend/src cho '/documents'
// (không phải /documents/browser|edit|ocr) chỉ ra 0 tham chiếu thật.
// Giữ dạng redirect-stub thay vì xoá file thô — build không vỡ + có đường
// lui (khôi phục từ git history) nếu sau này cần dùng lại.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/');
}
