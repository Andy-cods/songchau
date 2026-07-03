// ─── Trang mồ côi — đã xoá (COOK W2-13) ─────────────────────────────────
// Route /chains/[code] không còn nav/href/router.push nào trỏ tới
// (re-verify: grep toàn frontend/src, chỉ có self-reference nội bộ trong
// chính chains/ + chains/[code]/ — cả hai đều mồ côi, cùng xoá).
// Giữ dạng redirect-stub thay vì xoá file thô — build không vỡ + có đường
// lui (khôi phục từ git history) nếu sau này cần dùng lại.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/');
}
