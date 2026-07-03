// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /reports/scheduled không còn nav/href/router.push nào trỏ tới
// (re-verify: grep toàn frontend/src, 0 tham chiếu — kể cả trang cha
// /reports cũng không link tới đây).
// Giữ dạng redirect-stub thay vì xoá file thô — build không vỡ + có đường
// lui (khôi phục từ git history) nếu sau này cần dùng lại.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/');
}
