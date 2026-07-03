/**
 * chart-colors.ts — SINGLE source of truth for chart/graph colours.
 *
 * Mọi biểu đồ (Recharts) PHẢI lấy màu từ đây thay vì hardcode hex rời rạc
 * (#7c3aed, #a78bfa, #8b5cf6, #6366f1…). Giá trị khớp 1-1 với token Tailwind:
 *   brand-600 = #4f46e5 (indigo) · status.success/danger/warning/info.
 *
 * Quy ước ngữ nghĩa (dùng nhất quán toàn app):
 *   - Series "chính" / báo giá / brand highlight  → CHART.brand
 *   - Thu / income / on-time / positive            → CHART.success
 *   - Chi / expense / negative / fail              → CHART.danger
 *   - Chờ / pending / cảnh báo                      → CHART.warning
 *   - Thông tin phụ                                 → CHART.info
 *   - Categorical (pie nhiều lát)                   → CHART.categorical (brand + slate ramp)
 *
 * Nhân từ analytics/procurement BRAND/SLATE_RAMP (data cockpit) — đó là chuẩn.
 */

export const CHART = {
  /** brand-600 indigo — series chính / nhấn */
  brand: '#4f46e5',
  /** status.success — thu / tích cực */
  success: '#059669',
  /** status.danger — chi / tiêu cực / lỗi */
  danger: '#dc2626',
  /** status.warning — chờ / cảnh báo */
  warning: '#d97706',
  /** status.info — thông tin phụ */
  info: '#0891b2',
  /** slate-400 — trung tính */
  neutral: '#94a3b8',
} as const;

/** Thang slate cho series phụ / categorical — brand dẫn đầu rồi tới slate ramp. */
export const SLATE_RAMP = ['#4f46e5', '#94a3b8', '#cbd5e1', '#e2e8f0', '#64748b', '#475569'] as const;

/** Bảng màu categorical cho pie/donut: brand trước, rồi slate ramp (KHÔNG cầu vồng). */
export const CATEGORICAL = [
  CHART.brand,
  '#64748b',
  '#94a3b8',
  '#cbd5e1',
  '#475569',
  '#e2e8f0',
] as const;

/** Win/Loss pie: trúng=success, trượt=danger, còn lại=neutral. */
export const WIN_LOSS_COLORS = [CHART.success, CHART.danger, CHART.neutral] as const;

export type ChartColorKey = keyof typeof CHART;
