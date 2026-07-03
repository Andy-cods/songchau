import { redirect } from 'next/navigation';

// Thang 2026-07-02: "Dự báo nhu cầu" đã bỏ khỏi hệ thống.
// Dự báo số lượng bán kiểu bán lẻ vô nghĩa với mô hình báo giá RFQ (Samsung/IMV);
// đường ống dữ liệu cũ (FE gọi endpoint không tồn tại, bảng demand_forecasts rỗng) đã gãy.
// Thay bằng: gộp giá đa nguồn (Xu hướng giá) + Radar mã sắp bị hỏi lại.
// Giữ route để không 404 với link/bookmark cũ — chuyển hướng về Xu hướng giá.
export default function ForecastRemovedPage() {
  redirect('/analytics/price-trends');
}
