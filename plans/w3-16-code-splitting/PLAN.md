# PLAN.md — W3-16 Frontend Code-Splitting (recharts + top-5 modals)

Goal: move `recharts` and the heaviest modals out of first-load JS via `next/dynamic`, with zero runtime behavior change. Constraints: `tsc --noEmit` must stay 0 errors, no `as any`/`@ts-ignore`, no new libraries, App Router, all targets are `'use client'`.

Key facts confirmed during recon:
- No modal uses `forwardRef`/`useImperativeHandle` → dynamic wrapping is ref-safe.
- Export styles: `PushToSecModal` = `export default`; all others (`QuoteBatchModal`, `BqmsImagePickerModal`, `BqmsImageCropModal`, `RevenueDashboardModal`, `CodeHistoryDrawer`, and the 4 chart wrappers) = **named** exports.
- All 5 modal/drawer call sites are already gated by state (`{state && <Modal/>}`), so `ssr:false` dynamic loads the chunk only on first open — behavior-identical.

## 0. Shared loading fallback (do this first)

KISS: no new shared component required, but to avoid layout shift on charts use a fixed-height pulse box.

- Chart fallback (match the chart's height to prevent CLS):
  ```tsx
  loading: () => <div className="w-full animate-pulse rounded-lg bg-slate-100" style={{ height: 320 }} />
  ```
- Modal fallback: `loading: () => null` (modals open on click; no skeleton needed).

`import dynamic from 'next/dynamic';` is added to each edited file that doesn't already have it.

## 1. Chart wrappers (files #11-14) — wrap at USE SITE

Wrap at each use site, not at definition, so the wrapper files' public API stays untouched.

- `src/app/(dashboard)/reports/page.tsx` — dynamic-wrap `LineAreaChart`, `HorizontalBarChart`, `DonutChart`.
- `src/app/(dashboard)/analytics/procurement/page.tsx` — dynamic-wrap `LineAreaChart`, `DonutChart`, `Sparkline` (loading: null for Sparkline, it's tiny).
- `src/components/cockpit/index.tsx` — dynamic-wrap `Sparkline`.

## 2. Standalone recharts components — dynamic at use site

- `CodeHistoryDrawer` → `src/app/(dashboard)/analytics/price-trends/page.tsx` (import line ~41, usage line ~1085). Gate usage with `{drilldownCode && <CodeHistoryDrawer .../>}` since component already returns null on `!code`.
- `RevenueDashboardModal` → `src/app/(dashboard)/bqms/deliveries/page.tsx` (import line ~19, usage already gated ~814).

## 3. Inline recharts pages — extract child `*Chart.tsx` + dynamic import

Recipe: create co-located `'use client'` child containing only the `<ResponsiveContainer>` block(s) + private tooltip/consts it needs; page passes computed data as typed props; page dynamic-imports the child with height-matched skeleton.

Target files (low → high effort/risk):
1. `analytics/win-loss/page.tsx` → extract `WinLossCharts.tsx`
2. `inventory/forecast/[product_id]/page.tsx` → extract `ConsumptionChart.tsx`
3. `analytics/profit/page.tsx` → extract `ProfitTrendChart.tsx`
4. `finance/reports/page.tsx` → extract `MonthlyComparisonChart.tsx`
5. `reports/daily/page.tsx` → extract `DailyTrendChart.tsx` (preserve `onClick` drill-through via prop)
6. `dashboard/charts/page.tsx` → extract `DashboardCharts.tsx` (4 charts)
7. `market-prices/page.tsx` → extract `MarketPriceCharts.tsx` (2 area charts)
8. `analytics/price-trends/page.tsx` → extract `PriceTrendCharts.tsx` (4 charts, each behind `ExportButton chartRef` — keep ref div in page, extract only `<ResponsiveContainer>`). Highest risk/effort — do last.

After each extraction: delete the page's `from 'recharts'` import; verify with grep no page still imports recharts directly (else the split achieves nothing).

## 4. Top-5 modals — swap import to dynamic at use site only

- `QuoteBatchModal` (named, 1669 lines) — 4 sites: `crm/_components/HoSoTab.tsx`, `crm/[id]/page.tsx`, `crm/page.tsx`, `sourcing/page.tsx`. Do NOT touch `admin/vendor-staging/page.tsx` (local function, same name, unrelated).
- `PushToSecModal` (default export, 684 lines) — `bqms/page.tsx`. `dynamic(() => import(...))` — no `.then()`.
- `BqmsImagePickerModal` + `BqmsImageCropModal` (pair, 586+262 lines) — `bqms-images/BqmsImageThumb.tsx` (renders per image cell — outsized multiplier).
- `RevenueDashboardModal` — covered in §2.
- `CodeHistoryDrawer` — covered in §2.

## 5. Execution order

1. §0 inline skeleton pattern.
2. §1 chart wrappers (3 files) — trivial, high value.
3. §2 RevenueDashboardModal + CodeHistoryDrawer — one-line swaps, big components.
4. §4 modals: PushToSecModal, BqmsImage pair, QuoteBatchModal×4 — pure import swaps.
5. §3 simple extractions: win-loss, forecast, profit, finance/reports.
6. §3 medium extractions: reports/daily, dashboard/charts, market-prices.
7. §3 price-trends — last, time-boxed; may defer if risk too high.

Run `npx tsc --noEmit` after each batch. Do NOT run `next build`.

## 6. Risks & verification checklist

- Default vs named export: only `PushToSecModal` is default.
- `ssr:false` mandatory for all (ResponsiveContainer measures DOM).
- CLS: skeleton height must match replaced chart height; modals use `loading: () => null`.
- No modal uses forwardRef/useImperativeHandle — confirmed safe.
- Keep existing state-gating; add gate to CodeHistoryDrawer usage (currently ungated).
- Prop type inference via `.then(m => m.Named)` needs no explicit generics — never use `as any`.
- Moved helpers (`ChartTooltip`, `fmtVnd`, `fmtDate`, `CHART_TOKENS`, `SERIES_COLORS`, etc.) must move/duplicate into child; keep in page only if still used by tables there.
- `onClick` drill-through (reports/daily) must be passed as prop to extracted child.
- Verify no `from 'recharts'` remains in any §3 page after extraction.

### Critical files
- `src/app/(dashboard)/analytics/price-trends/page.tsx`
- `src/app/(dashboard)/bqms/page.tsx`
- `src/components/bqms-images/BqmsImageThumb.tsx`
- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/dashboard/charts/page.tsx`
