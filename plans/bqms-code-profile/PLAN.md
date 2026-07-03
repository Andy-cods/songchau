# PLAN: Hồ sơ mã BQMS (BQMS Code Profile)

**Author**: Planner agent
**Date**: 2026-05-15
**Target**: `songchau-erp/frontend/src/app/(dashboard)/analytics/price-trends/page.tsx` + new backend endpoint
**Scope**: Read-only analytical drill-down panel cho 1 mã BQMS — KPI thống kê + dự báo rule-based
**Constraint**: Data đã được trim về `>=2026`, không gộp năm cũ. Không ML, chỉ SQL aggregate + ngưỡng cứng.

---

## 1. Mục tiêu & Phạm vi

Khi user (Thang) click 1 dòng trong bảng "Đối chiếu theo mã" (`matched_bqms`) tại trang Xu hướng giá, hoặc gõ mã đầy đủ vào filter "Mã BQMS", một modal/drawer mở ra hiển thị **4 panel** tổng hợp lịch sử + dự báo cho mã đó.

**Không nằm trong scope**:
- Không train model ML; tất cả dự báo là rule-based với ngưỡng cứng.
- Không vẽ histogram giá chi tiết (chỉ median + P10/P90).
- Không truy ngược raw RFQ rows (đã có trang BQMS riêng cho việc đó).
- Không support multi-code so sánh chéo.

---

## 2. Wireframe ASCII (Layout 2-cột XL, full-width LG)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [×]  HỒ SƠ MÃ BQMS · Z0000002-509805                                              │
│ Maker chính: MISUMI · 12 tháng · 47 RFQ · Last: 2026-05-08                        │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ ┌─────────────────────────────────────┐ │
│ │ PANEL A — TẦN SUẤT & NHỊP            │ │ PANEL B — GIÁ & TỶ LỆ THẮNG         │ │
│ │                                      │ │                                     │ │
│ │ [KpiCard:RFQ/tháng]  [KpiCard:avg Δ] │ │ [KpiCard:Median V1] [KpiCard:V4]    │ │
│ │ [KpiCard:Last seen]  [KpiCard:Next?] │ │ [KpiCard:Win rate]  [KpiCard:Δ TT%] │ │
│ │                                      │ │                                     │ │
│ │ ╭─Bar chart: số RFQ/tháng 2026─────╮ │ │ Khoảng giá V1 (P10-P50-P90):        │ │
│ │ │ ▆▃▅▇▂▆▇█▅▂▃                       │ │ │ ├──[14k]──●50k──[88k]┤             │ │
│ │ ╰──────────────────────────────────╯ │ │                                     │ │
│ │                                      │ │ Giá PO (won): median 47k₫           │ │
│ │ Nhịp: avg 11 ngày (σ 3.4)            │ │ Δ vs TT XNK: +6.4% (cao hơn TT)     │ │
│ │ → Dự báo lần kế: ~2026-05-19         │ │ → Trend 6 tháng: ↗ +2.1%/tháng      │ │
│ └──────────────────────────────────────┘ └─────────────────────────────────────┘ │
│                                                                                  │
│ ┌──────────────────────────────────────┐ ┌─────────────────────────────────────┐ │
│ │ PANEL C — DEPT & REQUESTER           │ │ PANEL D — DỰ BÁO RULE-BASED         │ │
│ │                                      │ │                                     │ │
│ │ Top 5 Department (12 tháng):         │ │ Xác suất xuất hiện Q tới:           │ │
│ │ ─────────────────────────────────────│ │ ┌───────────────────────────┐       │ │
│ │ █████████ Set Equipment   18         │ │ │ ●●●○○  CAO  (78%)          │       │ │
│ │ ███████   PCB Assembly    12         │ │ └───────────────────────────┘       │ │
│ │ ████      EMS Line2        6         │ │ Lý do: 9 RFQ trong 90 ngày qua,    │ │
│ │ ██        Mold Shop        3         │ │ nhịp 11d, đều đặn.                  │ │
│ │ █         R&D Lab          2         │ │                                     │ │
│ │                                      │ │ Giá V1 đề xuất lần báo kế tiếp:    │ │
│ │ Top 5 Requester (12 tháng):          │ │ ┌───────────────────────────┐       │ │
│ │ • Kim Min-su      (Set Eq)    9      │ │ │  ~50,000 ₫                │       │ │
│ │ • Park Ji-won     (PCB)       7      │ │ │  Biên P10-P90: 14k-88k    │       │ │
│ │ • Lee Hyun-woo    (EMS L2)    5      │ │ └───────────────────────────┘       │ │
│ │ • Yoon Sang-hee   (Mold)      3      │ │                                     │ │
│ │ • Choi Da-eun     (R&D)       2      │ │ Dept dự kiến order:                 │ │
│ │                                      │ │ ► Set Equipment  (47% share 6m)     │ │
│ │ Maker đã từng won (3):               │ │                                     │ │
│ │ [MISUMI] [THK] [SMC]                 │ │ Confidence: HIGH (47 RFQ, σ thấp)   │ │
│ └──────────────────────────────────────┘ └─────────────────────────────────────┘ │
│                                                                                  │
│ [Đóng]                                                  [Mở trong trang BQMS →]  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Layout rules**:
- Modal full-screen on mobile, max-w-6xl on XL (`xl:grid-cols-2 gap-4`).
- Mỗi panel = `rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm` (reuse pattern từ `page.tsx`).
- Header sticky với mã + maker + meta line.
- Footer: 2 actions: Đóng + Deep-link `/bqms?bqms_code=Z000...` (mở danh sách RFQ thật).

---

## 3. Backend Spec

### 3.1 Endpoint mới

Thêm vào file đã có: `songchau-erp/backend/app/api/v1/price_analytics.py`
(KHÔNG tạo file mới — pattern đang dùng "1 file = 1 module routers").

```
GET /api/v1/price-analytics/code-profile/{bqms_code}?months=12
```

**Path param**: `bqms_code` (URL-encoded; có thể chứa dấu `-`)
**Query**: `months` (default 12, range 3-24)
**Auth**: `require_role("admin", "manager", "staff", "sales", "director")` (cùng pattern `/intelligence`)

### 3.2 Response JSON Shape (TypeScript)

```ts
interface CodeProfileResponse {
  filters: {
    bqms_code: string;
    months: number;
    cutoff_date: string;            // ISO date — CURRENT_DATE - months
    data_floor: '2026-01-01';       // hard-coded floor sau trim
  };

  meta: {
    bqms_code: string;
    primary_maker: string | null;
    total_rfq_rows: number;
    won_rows: number;
    lost_rows: number;
    pending_rows: number;
    closed_rows: number;
    first_seen: string | null;
    last_seen: string | null;
    days_since_last: number | null;
  };

  // PANEL A
  frequency: {
    monthly_counts: Array<{
      month: string;                    // 'YYYY-MM'
      rfq_count: number;
      won_count: number;
    }>;
    quarterly_counts: Array<{ quarter: string; rfq_count: number }>;
    cadence: {
      avg_interval_days: number | null;
      stddev_interval_days: number | null;
      median_interval_days: number | null;
      sample_size: number;
    };
    next_expected: {
      date: string | null;
      window_low: string | null;
      window_high: string | null;
    };
  };

  // PANEL B
  pricing: {
    internal: {
      median_v1: number | null;
      median_v4: number | null;
      p10_v1: number | null;
      p90_v1: number | null;
      median_po_won: number | null;
      sample_v1: number;
    };
    market: {
      median_vnd: number | null;
      median_usd: number | null;
      p10_vnd: number | null;
      p90_vnd: number | null;
      sample: number;
    };
    win_rate_pct: number | null;
    gap_vs_market_pct: number | null;
    trend_6m_pct_per_month: number | null;
  };

  // PANEL C
  organization: {
    top_departments: Array<{
      department: string;
      rfq_count: number;
      win_count: number;
      share_pct: number;
    }>;
    top_requesters: Array<{
      requester: string;
      department: string | null;
      rfq_count: number;
    }>;
    makers_won: Array<{
      maker: string;
      won_count: number;
      last_won_date: string | null;
    }>;
  };

  // PANEL D
  forecast: {
    appearance_next_quarter: {
      level: 'high' | 'medium' | 'low' | 'unknown';
      score_pct: number;
      reason: string;
      basis: {
        rfq_last_90d: number;
        rfq_last_180d: number;
        avg_interval_days: number | null;
      };
    };
    suggested_v1_next: {
      value: number | null;
      band_low: number | null;
      band_high: number | null;
      basis: string;
    };
    expected_department: {
      department: string | null;
      share_pct: number | null;
      reason: string;
    };
    confidence: 'high' | 'medium' | 'low';
    confidence_reason: string;
  };

  generated_at: string;
}
```

### 3.3 SQL queries (11 queries — Q1 đến Q11)

Reuse `RFQ_DATE_SQL = "COALESCE(inquiry_date, created_at::date)"` đã có. Tất cả query đều có `WHERE bqms_code = $1 AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($2 || ' months')::interval`.

**Q1 — Meta + sample size + first/last**
```sql
SELECT
  COUNT(*)::int AS total_rfq_rows,
  COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_rows,
  COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%')::int AS lost_rows,
  COUNT(*) FILTER (WHERE result IS NULL OR result::text = '')::int AS pending_rows,
  COUNT(*) FILTER (WHERE result::text ILIKE '%closed%')::int AS closed_rows,
  MIN(COALESCE(inquiry_date, created_at::date)) AS first_seen,
  MAX(COALESCE(inquiry_date, created_at::date)) AS last_seen,
  (CURRENT_DATE - MAX(COALESCE(inquiry_date, created_at::date))) AS days_since_last,
  MODE() WITHIN GROUP (ORDER BY maker) FILTER (WHERE maker IS NOT NULL AND BTRIM(maker) != '') AS primary_maker
FROM bqms_rfq
WHERE bqms_code = $1
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval;
```

**Q2 — Monthly counts**
```sql
SELECT
  TO_CHAR(DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)), 'YYYY-MM') AS month,
  COUNT(*)::int AS rfq_count,
  COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_count
FROM bqms_rfq
WHERE bqms_code = $1
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval
GROUP BY 1
ORDER BY 1;
```

**Q3 — Cadence intervals (LAG)**
```sql
WITH dates AS (
  SELECT DISTINCT COALESCE(inquiry_date, created_at::date) AS d
  FROM bqms_rfq
  WHERE bqms_code = $1
    AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval
  ORDER BY 1
),
intervals AS (
  SELECT (d - LAG(d) OVER (ORDER BY d))::int AS gap_days
  FROM dates
)
SELECT
  COUNT(gap_days)::int AS sample_size,
  ROUND(AVG(gap_days)::numeric, 1) AS avg_interval_days,
  ROUND(STDDEV_SAMP(gap_days)::numeric, 1) AS stddev_interval_days,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days) AS median_interval_days
FROM intervals
WHERE gap_days IS NOT NULL;
```

**Q4 — Pricing internal**
```sql
SELECT
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1)
        FILTER (WHERE quoted_price_bqms_v1 > 0)::numeric, 0) AS median_v1,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v4)
        FILTER (WHERE quoted_price_bqms_v4 > 0)::numeric, 0) AS median_v4,
  ROUND(PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY quoted_price_bqms_v1)
        FILTER (WHERE quoted_price_bqms_v1 > 0)::numeric, 0) AS p10_v1,
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY quoted_price_bqms_v1)
        FILTER (WHERE quoted_price_bqms_v1 > 0)::numeric, 0) AS p90_v1,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY po_price)
        FILTER (WHERE po_price > 0 AND result::text ILIKE '%won%')::numeric, 0) AS median_po_won,
  COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS sample_v1
FROM bqms_rfq
WHERE bqms_code = $1
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval;
```

**Q5 — Pricing market (xnk_price_lookup)**
```sql
SELECT
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd)
        FILTER (WHERE price_vnd > 0)::numeric, 0) AS median_vnd,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd)
        FILTER (WHERE price_usd > 0)::numeric, 2) AS median_usd,
  ROUND(PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY price_vnd)
        FILTER (WHERE price_vnd > 0)::numeric, 0) AS p10_vnd,
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY price_vnd)
        FILTER (WHERE price_vnd > 0)::numeric, 0) AS p90_vnd,
  COUNT(*) FILTER (WHERE price_vnd > 0)::int AS sample
FROM xnk_price_lookup
WHERE bqms_code = $1
  AND COALESCE(rfq_date, quoted_date) >= CURRENT_DATE - ($2 || ' months')::interval;
```

**Q6 — Top departments**
```sql
SELECT
  COALESCE(NULLIF(BTRIM(department), ''), 'Không rõ') AS department,
  COUNT(*)::int AS rfq_count,
  COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS win_count
FROM bqms_rfq
WHERE bqms_code = $1
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval
GROUP BY 1
ORDER BY rfq_count DESC
LIMIT 5;
```

**Q7 — Top requesters (với dept phổ biến)**
```sql
SELECT
  requester,
  COUNT(*)::int AS rfq_count,
  MODE() WITHIN GROUP (ORDER BY department)
    FILTER (WHERE department IS NOT NULL AND BTRIM(department) != '') AS department
FROM bqms_rfq
WHERE bqms_code = $1
  AND requester IS NOT NULL AND BTRIM(requester) != ''
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval
GROUP BY requester
ORDER BY rfq_count DESC
LIMIT 5;
```

**Q8 — Makers won**
```sql
SELECT
  COALESCE(NULLIF(BTRIM(maker), ''), 'Không rõ') AS maker,
  COUNT(*)::int AS won_count,
  MAX(COALESCE(inquiry_date, created_at::date)) AS last_won_date
FROM bqms_rfq
WHERE bqms_code = $1
  AND result::text ILIKE '%won%'
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval
GROUP BY 1
ORDER BY won_count DESC
LIMIT 5;
```

**Q9 — Forecast inputs (90d/180d)**
```sql
SELECT
  COUNT(*) FILTER (WHERE COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - INTERVAL '90 days')::int AS rfq_last_90d,
  COUNT(*) FILTER (WHERE COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - INTERVAL '180 days')::int AS rfq_last_180d
FROM bqms_rfq
WHERE bqms_code = $1
  AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($2 || ' months')::interval;
```

**Q10 — Expected department 6m**
```sql
WITH dept_6m AS (
  SELECT
    COALESCE(NULLIF(BTRIM(department), ''), 'Không rõ') AS dept,
    COUNT(*)::int AS cnt
  FROM bqms_rfq
  WHERE bqms_code = $1
    AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1
),
total AS (SELECT SUM(cnt)::int AS tot FROM dept_6m)
SELECT dept_6m.dept,
       cnt,
       ROUND((cnt::numeric / NULLIF(total.tot, 0)) * 100, 1) AS share_pct
FROM dept_6m, total
ORDER BY cnt DESC
LIMIT 1;
```

**Q11 — Trend 6m linear slope**
```sql
WITH monthly AS (
  SELECT
    EXTRACT(EPOCH FROM DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date))) / (86400 * 30) AS x_month_idx,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1)
      FILTER (WHERE quoted_price_bqms_v1 > 0) AS y_median
  FROM bqms_rfq
  WHERE bqms_code = $1
    AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1
  HAVING COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0) > 0
)
SELECT REGR_SLOPE(y_median, x_month_idx) AS slope_per_month,
       AVG(y_median) AS avg_median
FROM monthly;
```
Backend tính: `trend_6m_pct_per_month = slope / avg_median * 100`; nếu sample < 3 tháng → null.

### 3.4 Async pattern (Python)

Follow existing pattern: chạy các query bằng `await conn.fetchrow(...)` / `await conn.fetch(...)`. KHÔNG dùng `asyncio.gather` ở đây vì asyncpg single connection — sequential là chuẩn.

Helper mới cần thêm vào `price_analytics.py`:
- `compute_forecast_level(rfq_90d, rfq_180d, avg_interval) -> (level, score, reason)`
- `compute_confidence(sample_v1, sample_intervals) -> (level, reason)`

---

## 4. Rule-based Forecast Logic

### 4.1 Xác suất xuất hiện quý tới

```
INPUT: rfq_last_90d, rfq_last_180d, avg_interval_days

# Component 1 — Recency velocity (50%)
IF rfq_last_90d >= 6:   velocity = 100
ELIF >= 3:              velocity = 70
ELIF >= 1:              velocity = 40
ELSE:                   velocity = 10

# Component 2 — Cadence regularity (30%)
IF avg_interval IS NULL: cadence = 20
ELIF <= 30:              cadence = 100
ELIF <= 60:              cadence = 70
ELIF <= 90:              cadence = 45
ELSE:                    cadence = 15

# Component 3 — Decay 180d-90d (20%)
older_90d = rfq_180d - rfq_90d
IF rfq_90d > older_90d:   decay = 100   # tăng tốc
ELIF rfq_90d == older_90d: decay = 60
ELSE:                      decay = 30   # giảm tốc

score_pct = round(0.50*velocity + 0.30*cadence + 0.20*decay)

# Level
IF score >= 70:   level='high',    label='CAO'
ELIF score >= 40: level='medium',  label='TRUNG BÌNH'
ELSE:             level='low',     label='THẤP'

# Special case
IF rfq_180d == 0:
    level='unknown', score=0
    reason='Không có RFQ trong 180 ngày — không đủ dữ liệu dự báo'
```

### 4.2 Giá V1 đề xuất

```
suggested = median_v1
band_low  = p10_v1
band_high = p90_v1
basis = f'Trung vị V1 {months} tháng ({sample_v1} mẫu)'

IF trend_6m_pct IS NOT NULL AND abs(trend) >= 1.0:
    suggested = suggested * (1 + trend/100)
    basis += f' · điều chỉnh trend {trend:+.1f}%/tháng'
```

### 4.3 Department dự kiến order

Lấy từ Q10. Reason: `Chiếm {share_pct}% RFQ trong 6 tháng gần nhất`.

### 4.4 Confidence

```
IF sample_v1 < 5 OR sample_intervals < 4:    confidence='low'
ELIF sample_v1 < 15 OR (σ/μ) > 1.0:          confidence='medium'
ELSE:                                         confidence='high'
```

---

## 5. Frontend Spec

### 5.1 Component tree

```
analytics/price-trends/page.tsx               (sửa: thêm state + onClick handler)
└── components/analytics/                     (folder mới)
    ├── BqmsCodeProfileModal.tsx              (container — Dialog từ ui/dialog)
    ├── panels/
    │   ├── FrequencyPanel.tsx                (Panel A)
    │   ├── PricingPanel.tsx                  (Panel B)
    │   ├── OrganizationPanel.tsx             (Panel C)
    │   └── ForecastPanel.tsx                 (Panel D)
    └── parts/
        ├── ForecastLevelBadge.tsx
        ├── PriceBandBar.tsx
        └── ConfidenceTag.tsx
```

### 5.2 Data fetching

```ts
useQuery<CodeProfileResponse>({
  queryKey: ['bqms-code-profile', bqmsCode, months],
  enabled: !!bqmsCode && open,
  queryFn: () => api.get(`/api/v1/price-analytics/code-profile/${encodeURIComponent(bqmsCode!)}?months=${months}`),
  retry: false,
  staleTime: 60_000,
});
```

### 5.3 Charts

| Panel | Chart | Component |
|-------|-------|-----------|
| A | Bar chart monthly | `<BarChart>` recharts |
| B | Horizontal P10-P50-P90 bar | DIY div+absolute |
| C | Horizontal Bar top depts | `<BarChart layout="vertical">` |
| C req | List | `<ul>` plain |
| D | Score gauge 5 dots | DIY span |

### 5.4 Sửa `page.tsx`

1. State: `const [profileCode, setProfileCode] = useState<string | null>(null);`
2. Click handler trên `<tr>` của `matched_bqms` → `setProfileCode(row.bqms_code)`.
3. Auto-open khi gõ mã đầy đủ vào filter (regex `^[ZR]` + length>=8).
4. Render `<BqmsCodeProfileModal>` sau section table.

---

## 6. Implementation Order

| # | Step | Complexity | LOC | Risk |
|---|------|-----------|-----|------|
| 1 | Backend: endpoint `code-profile` (11 queries + helpers) | M | ~250 | Low |
| 2 | Backend: smoke test với mã thật qua curl | S | ~50 | Low |
| 3 | FE: folder + parts (ConfidenceTag, ForecastLevelBadge, PriceBandBar) | S | ~120 | Low |
| 4 | FE: `BqmsCodeProfileModal` skeleton + Dialog + useQuery | S | ~80 | Low |
| 5 | FE: `FrequencyPanel` (A) | M | ~120 | Low |
| 6 | FE: `PricingPanel` (B) | M | ~130 | Med |
| 7 | FE: `OrganizationPanel` (C) | S | ~110 | Low |
| 8 | FE: `ForecastPanel` (D) | M | ~140 | Med |
| 9 | FE: sửa `page.tsx` (state + render) | S | ~30 | Low |
| 10 | Smoke test 3 mã (đủ data / ít data / 0 data) | S | — | Med |
| 11 | Code review + docs update | S | ~30 | Low |

Tổng: **~1.5-2 ngày 1 dev full-stack**.

---

## 7. Open Questions (cần Thang chốt trước khi cook)

1. **Trigger auto-open**: gõ đầy đủ mã → tự mở modal? Hay chỉ click? (Spec đề xuất CẢ HAI.)
2. **Modal vs Drawer vs Full page**: Modal đơn giản; route riêng `/analytics/price-trends/[bqms_code]` thì bookmarkable.
3. **Data floor**: confirm `2026-01-01` floor cứng — nếu data đã trim ở DB thì không cần filter thêm.
4. **"Maker đã từng won"**: 6m hay 12m? Đang theo `months` param.
5. **Trend slope**: P10/P90 đủ chưa, hay cần min/max?
6. **Normalize department/requester**: TEXT có whitespace, có UPPER(BTRIM()) không?
7. **Forecast confidence ngưỡng**: `sample_v1 < 5 → low`, `< 15 → medium` có hợp lý với data 2026 (mới 4-5 tháng)?
8. **Deep-link "Mở trong trang BQMS"**: `/bqms?bqms_code=...` đã hỗ trợ chưa?
9. **Link tới `analytics/forecast`**: cross-ref từ Panel D?
10. **Cache TTL**: 60s FE đủ chưa? Redis backend?

---

## 8. Acceptance Criteria

- [ ] `GET /api/v1/price-analytics/code-profile/Z0000002-509805?months=12` trả 200 với shape khớp `CodeProfileResponse`.
- [ ] Click 1 row trong "Đối chiếu theo mã" → modal mở, 4 panel có data trong < 2s.
- [ ] Mã không có data → empty block, không crash.
- [ ] `forecast.appearance_next_quarter.level` luôn ∈ `high|medium|low|unknown`, score ∈ [0,100].
- [ ] Confidence tag đúng tone theo §4.4.
- [ ] Không hardcode năm cụ thể — chỉ dùng `months` param.
- [ ] `npm run lint` + `npm run typecheck` pass.

---

### Critical Files

- `songchau-erp/backend/app/api/v1/price_analytics.py` (thêm endpoint)
- `songchau-erp/frontend/src/app/(dashboard)/analytics/price-trends/page.tsx` (sửa)
- `songchau-erp/frontend/src/components/analytics/BqmsCodeProfileModal.tsx` (new)
- `songchau-erp/frontend/src/components/ui/dialog.tsx` (reference)
- `songchau-erp/backend/migrations/bqms_phase2_columns.sql` (reference cho requester/department)
