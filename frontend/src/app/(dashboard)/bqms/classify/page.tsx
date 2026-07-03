// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /bqms/classify không còn nav/href/router.push nào trỏ tới
// (re-verify: grep toàn frontend/src, không thấy tham chiếu thật).
// Giữ dạng redirect-stub thay vì xoá file thô — build không vỡ + có đường
// lui (khôi phục từ git history) nếu sau này cần dùng lại.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/');
}
