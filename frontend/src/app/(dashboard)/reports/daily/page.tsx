'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import {
  Copy, Check, Calendar as CalendarIcon, TrendingUp, TrendingDown,
  Package, Truck, Sparkles, FileText, RefreshCw, Printer, Share2,
  ArrowRight, Clock, BarChart3, Bell, ChevronRight,
  AlertCircle, Eye, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsReadOnly } from '@/hooks/use-permissions';
import { toast } from 'sonner';

// Code-splitting (W3-16): recharts moved into DailyTrendChart.tsx, deferred
// via dynamic() so it isn't part of this route's first-load JS.
const DailyTrendChart = dynamic(
  () => import('./DailyTrendChart').then((m) => m.DailyTrendChart),
  { ssr: false, loading: () => <div className="h-full bg-slate-100 rounded-xl animate-pulse" /> },
);

// ─── Types ────────────────────────────────────────────────────

type MorningReport = {
  report_date: string;
  requests: { total: number; tm: number; gc: number; unclassified: number };
  quoted_today: {
    total: number;
    breakdown: Array<{
      round: number;
      rfq_inquiry_date: string | null;
      label: string;
      total: number;
      tm: number;
      gc: number;
      type_tag?: string;
    }>;
  };
  text_version: string;
  historical_text?: string | null;
  has_historical?: boolean;
};

type RevenueSummary = {
  report_date: string;
  cutoff: string;
  currency: string;
  po_revenue: {
    today: { amount: number; count: number };
    week: { amount: number; count: number };
    month: { amount: number; count: number };
    yoy_same_day: { amount: number; count: number };
    yoy_mtd: { amount: number; count: number };
    delta_yoy_today_pct: number | null;
    delta_yoy_mtd_pct: number | null;
  };
  delivery_revenue: {
    week: { amount_vnd: number; count: number };
    month: { amount_vnd: number; count: number };
  };
};

type TrendPoint = { bucket: string; amount: number; po_count: number; amount_ly: number };
type TopCode = { bqms_code: string; total: number; cells: Array<{ date: string; amount: number }> };
type TopCodesPayload = { start: string; days: number; codes: string[]; matrix: TopCode[] };

type ReportHistoryItem = { date: string; text: string };
type ReportHistory = { year: number; count: number; items: ReportHistoryItem[] };

// ─── Formatters ────────────────────────────────────────────────

const fmtVND = (v: number) => {
  const n = Number(v) || 0;
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' ₫';
};

const fmtVNDShort = (v: number) => {
  const n = Number(v) || 0;
  if (!n) return '0 ₫';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} tr`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${Math.round(n)} ₫`;
};

const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

const fmtDate = (s: string) => {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ─── Page ──────────────────────────────────────────────────────

export default function DailyReportPage() {
  // Viewer role (guest read-only) hides interactive action cards.
  const isReadOnly = useIsReadOnly();
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const [morning, setMorning] = useState<MorningReport | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topCodes, setTopCodes] = useState<TopCodesPayload | null>(null);
  const [history, setHistory] = useState<ReportHistory | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const n = trendPeriod === 'day' ? 30 : trendPeriod === 'week' ? 12 : 13;
      const [m, r, t, tc, hist] = await Promise.all([
        api.get<MorningReport>(`/api/v1/daily-report/morning?report_date=${reportDate}`),
        api.get<RevenueSummary>(`/api/v1/daily-report/revenue?report_date=${reportDate}`),
        api.get<{ series: TrendPoint[] }>(`/api/v1/daily-report/trend?period=${trendPeriod}&n=${n}`),
        api.get<TopCodesPayload>(`/api/v1/daily-report/top-codes?days=21&limit=12`),
        api.get<ReportHistory>('/api/v1/daily-report/history?year=2026'),
      ]);
      setMorning(m);
      setRevenue(r);
      setTrend(t.series || []);
      setTopCodes(tc);
      setHistory(hist);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('daily-report load failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [reportDate, trendPeriod]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  // Auto refresh every 60s if viewing today
  useEffect(() => {
    if (reportDate !== today) return;
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [reportDate, today, fetchAll]);

  const handleCopy = async () => {
    if (!morning?.text_version) return;
    try {
      await navigator.clipboard.writeText(morning.text_version);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {}
  };

  const handlePrint = () => window.print();

  const heatmapMax = useMemo(() => {
    if (!topCodes) return 0;
    let max = 0;
    for (const r of topCodes.matrix) for (const c of r.cells) if (c.amount > max) max = c.amount;
    return max;
  }, [topCodes]);

  const updatedTimeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="min-h-screen bg-white -m-6 p-6 print:bg-white print:p-0">
      {/* ─── STICKY HEADER ─────────────────────────────────────── */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 px-6 py-4 backdrop-blur-md bg-white/70 border-b border-slate-200/80 print:hidden"
      >
        <div className="flex items-center justify-between gap-4 max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="h-5 w-5 text-brand-600" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-tight">Báo cáo doanh thu hàng ngày</h1>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 font-medium">
                <Clock className="h-3 w-3" />
                <span>Cập nhật <span className="font-bold text-slate-700">{updatedTimeStr}</span></span>
                <span className="text-slate-300">·</span>
                <span>Cutoff <span className="font-bold text-slate-700">{revenue?.cutoff || '—'}</span></span>
                {refreshing && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-200 font-bold">
                    <span className="h-1.5 w-1.5 bg-sky-500 rounded-full animate-pulse" />
                    đang đồng bộ
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="date"
                className="bg-transparent outline-none text-slate-700 cursor-pointer"
                value={reportDate}
                max={today}
                onChange={(e) => setReportDate(e.target.value)}
              />
            </div>
            <ToolButton onClick={fetchAll} title="Làm mới" disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </ToolButton>
            <ToolButton onClick={handlePrint} title="In báo cáo">
              <Printer className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={handleCopy} title="Copy text" variant="primary">
              {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline ml-1.5">{copied ? 'Đã copy' : 'Copy'}</span>
            </ToolButton>
          </div>
        </div>
      </motion.div>

      <div className="max-w-[1600px] mx-auto space-y-6 print:max-w-none">
        {/* ─── HERO KPI STRIP — tạm ẩn theo yêu cầu ─────────────── */}

        {/* Import status banner — Thang 2026-06-01 */}
        <ImportStatusBanner readOnly={isReadOnly} />

        {/* ─── MAIN GRID ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Morning report card — left */}
          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-4 print:col-span-12"
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
              <div className="px-5 py-4 bg-slate-900 text-white">
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-white/10 backdrop-blur-sm ring-1 ring-white/20 flex items-center justify-center">
                        <FileText className="h-3.5 w-3.5" />
                      </div>
                      <h2 className="text-sm font-bold uppercase tracking-wider">Báo cáo buổi sáng</h2>
                    </div>
                    <button
                      onClick={handleCopy}
                      className="text-xs font-semibold flex items-center gap-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-md transition ring-1 ring-white/20 print:hidden"
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Đã copy' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300/90 mt-1.5 font-medium">Format chuẩn để paste Zalo group sáng</p>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {loading ? (
                  <SkeletonStack count={6} />
                ) : morning ? (
                  <>
                    <ReportLine label="Tổng số yêu cầu" value={morning.requests.total} suffix="mã" highlight />
                    <div className="ml-4 space-y-1.5 text-sm border-l-2 border-slate-100 pl-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sky-700 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-sky-500" /> Hàng thương mại
                        </span>
                        <span className="font-medium text-slate-900 tabular-nums">{morning.requests.tm} mã</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-amber-700 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> Hàng gia công
                        </span>
                        <span className="font-medium text-slate-900 tabular-nums">{morning.requests.gc} mã</span>
                      </div>
                      {morning.requests.unclassified > 0 && (
                        <div className="flex justify-between items-center text-slate-400">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-300" /> Chưa phân loại
                          </span>
                          <span className="tabular-nums">{morning.requests.unclassified}</span>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <ReportLine label="SL báo giá được" value={morning.quoted_today.total} suffix="mã" highlight />
                      {morning.quoted_today.breakdown.length === 0 ? (
                        <div className="ml-4 mt-2 text-xs text-slate-400 italic">Chưa có báo giá hôm nay</div>
                      ) : (
                        <div className="ml-4 mt-2 space-y-1.5 text-sm border-l-2 border-slate-100 pl-4">
                          {morning.quoted_today.breakdown.map((b, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.3 + i * 0.05 }}
                              className="flex justify-between items-center"
                            >
                              <span className="text-slate-700">
                                {b.round === 1 ? (
                                  <>Báo giá ngày <strong className="font-medium">{b.label.replace('báo giá ngày ', '')}</strong></>
                                ) : (
                                  <>Báo giá <strong className="font-medium">v{b.round}</strong></>
                                )}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="font-medium text-slate-900 tabular-nums">{b.total} mã</span>
                                <TypeTag tm={b.tm} gc={b.gc} round={b.round} typeTag={b.type_tag} />
                              </span>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <div>* GC: Gia công</div>
                      <div>* TM: Thương mại</div>
                    </div>

                    {/* Báo cáo gốc nhân viên ghi tay trong Excel "Thống kê hỏi hàng" cột S */}
                    {morning.has_historical && morning.historical_text ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                            Báo cáo gốc trong Excel
                          </span>
                          <span className="text-[11px] text-amber-600/70">(do nhân viên ghi)</span>
                        </div>
                        <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono leading-relaxed">
                          {morning.historical_text}
                        </pre>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </motion.section>

          {/* Trend chart — right (8 cols). Viewer cũng xem được (Thang 2026-05-25): thống kê quá khứ read-only */}
          <motion.section
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 }}
            className="lg:col-span-8 print:col-span-12 print:hidden"
          >
            <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm h-full flex flex-col overflow-hidden">
              <div className="relative px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-brand-50 flex items-center justify-center">
                      <TrendingUp className="h-3.5 w-3.5 text-brand-600" strokeWidth={2.2} />
                    </div>
                    <h2 className="font-bold tracking-tight text-slate-900">Xu hướng số mã yêu cầu</h2>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 uppercase tracking-wider">Theo báo cáo</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    <span className="font-bold text-slate-700">{trendPeriod === 'day' ? '30 ngày' : trendPeriod === 'week' ? '12 tuần' : '13 tháng'}</span> · trích từ "Tổng số yêu cầu" trong báo cáo Excel
                    <span className="ml-1.5 text-sky-600 font-bold">· bấm cột để xem báo cáo ngày đó</span>
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-3 text-[11px] text-slate-600 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />
                      Tổng yêu cầu
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-[3px] w-5 rounded-full bg-emerald-500" />
                      Đã báo giá
                    </span>
                  </div>
                  <div className="inline-flex rounded-xl bg-slate-100/70 ring-1 ring-slate-200/60 p-1 text-xs font-bold">
                    {(['day', 'week', 'month'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setTrendPeriod(p)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg transition-all',
                          trendPeriod === p
                            ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200/60'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/60',
                        )}
                      >
                        {p === 'day' ? 'Ngày' : p === 'week' ? 'Tuần' : 'Tháng'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 p-4 min-h-[340px]">
                {loading ? (
                  <div className="h-full bg-slate-100 rounded-xl animate-pulse" />
                ) : trend.length === 0 ? (
                  <EmptyState icon={<BarChart3 />} text="Chưa có dữ liệu cho khoảng thời gian này" />
                ) : (
                  <DailyTrendChart trend={trend} setReportDate={setReportDate} />
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 grid grid-cols-3 gap-4 text-xs">
                <TrendStat
                  label="Tổng số mã trong kỳ"
                  value={`${trend.reduce((s, t) => s + (Number(t.amount) || 0), 0)} mã`}
                />
                <TrendStat
                  label="Ngày cao nhất"
                  value={`${trend.reduce((m, t) => Math.max(m, Number(t.amount) || 0), 0)} mã`}
                />
                <TrendStat
                  label="Đã báo giá (Tổng)"
                  value={`${trend.reduce((s, t) => s + (Number(t.po_count) || 0), 0)} mã`}
                />
              </div>
            </div>
          </motion.section>
        </div>

        {/* ─── HEATMAP — viewer cũng xem được (Thang 2026-05-25) ──── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden print:hidden"
        >
          <div className="relative px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-brand-50 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-brand-600" strokeWidth={2.2} />
                </div>
                <h2 className="font-bold tracking-tight text-slate-900">Top mã linh kiện × 21 ngày</h2>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Doanh thu theo mã từng ngày — màu càng đậm, doanh thu càng cao
              </p>
            </div>
            {topCodes && topCodes.matrix.length > 0 && (
              <div className="text-xs text-slate-600 flex items-center gap-3 font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 ring-1 ring-slate-200/60 tabular-nums">
                  Top <span className="font-bold text-slate-800">{topCodes.matrix.length}</span> mã
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Thấp</span>
                  <div className="flex rounded overflow-hidden ring-1 ring-slate-200/60">
                    {[0.15, 0.3, 0.5, 0.7, 0.9].map((a, i) => (
                      <div key={i} className="h-3 w-3" style={{ background: `rgba(14, 165, 233, ${a})` }} />
                    ))}
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cao</span>
                </div>
              </div>
            )}
          </div>
          <div className="p-4 overflow-x-auto">
            {loading ? (
              <div className="h-48 bg-slate-50 rounded-xl animate-pulse" />
            ) : !topCodes || topCodes.matrix.length === 0 ? (
              <EmptyState icon={<Package />} text="Chưa có PO trong khoảng 21 ngày" />
            ) : (
              <Heatmap data={topCodes} max={heatmapMax} />
            )}
          </div>
        </motion.section>

        {/* ─── QUICK ACTIONS + ACTIVITY (placeholder) ───────────── */}
        <div className={cn(
          'grid grid-cols-1 gap-6 print:hidden',
          // Viewer chỉ thấy "Hoạt động gần đây" → full width.
          // Other roles: 2-column layout với "Hành động nhanh" bên trái.
          isReadOnly ? '' : 'lg:grid-cols-2',
        )}>
          {!isReadOnly && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="relative overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm"
            >
              <div className="p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-brand-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">Hành động nhanh</h2>
                    <div className="text-[11px] text-slate-500 font-medium">Truy cập nhanh các tính năng thường dùng</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <QuickAction icon={<Sparkles />} label="Tạo báo giá mới" href="/bqms/quotation/new" />
                  <QuickAction icon={<Eye />} label="Tra giá Ctrl+K" href="#" hint="Mở thanh tìm kiếm trên cùng" />
                  <QuickAction icon={<RefreshCw />} label="Đồng bộ BQMS" href="/bqms" />
                  <QuickAction icon={<Truck />} label="Quản lý giao hàng" href="/bqms/deliveries" />
                </div>
              </div>
            </motion.section>
          )}

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="relative overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm"
          >
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center">
                    <Bell className="h-4 w-4 text-brand-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">Hoạt động gần đây</h2>
                    <div className="text-[11px] text-slate-500 font-medium">Cập nhật theo thời gian thực</div>
                  </div>
                </div>
                <a
                  href="/notifications"
                  className="text-xs font-semibold text-brand-700 hover:text-brand-900 flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-all"
                >
                  Xem tất cả <ChevronRight className="h-3 w-3" />
                </a>
              </div>
              <ActivityFeed />
            </div>
          </motion.section>
        </div>

        {/* Footer hint */}
        <div className="text-center text-xs text-slate-400 pt-4 print:hidden">
          Auto-refresh mỗi 60s · Báo cáo cập nhật tức thời theo dữ liệu BQMS
        </div>
      </div>
    </div>
  );
}

// ─── Sub Components ───────────────────────────────────────────

// Thang 2026-06-01: banner cho biết Excel "Thong ke giao hang" được import lần
// cuối lúc nào + nút "Import lại ngay" để chạy cron thủ công khi user vừa edit
// file trên OneDrive.
function ImportStatusBanner({ readOnly }: { readOnly: boolean }) {
  type Status = {
    enabled: boolean;
    last_status: string | null;
    last_completed_at: string | null;
    last_started_at: string | null;
    last_rows_inserted: number | null;
    last_error: string | null;
    max_delivery_date: string | null;
  };
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await api.get<{ data: Status }>('/api/v1/daily-report/import-status');
      setS(r.data);
    } catch {/* silent */}
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 60_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const handleForce = async () => {
    if (busy || readOnly) return;
    setBusy(true);
    try {
      await api.post('/api/v1/daily-report/force-import', {});
      toast.success('Đã yêu cầu import lại — kiểm tra trong ~10 giây');
      setTimeout(fetchStatus, 8_000);
    } catch (e: any) {
      toast.error(e?.detail || 'Không thực hiện được');
    } finally { setBusy(false); }
  };

  if (!s) return null;

  const completedAt = s.last_completed_at ? new Date(s.last_completed_at) : null;
  const lastStr = completedAt
    ? completedAt.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  const maxDate = s.max_delivery_date ? new Date(s.max_delivery_date) : null;
  const daysOld = maxDate ? Math.floor((Date.now() - maxDate.getTime()) / 86400_000) : 999;
  const stale = !s.enabled || daysOld > 2;
  const tone = !s.enabled || s.last_status === 'error'
    ? { bg: 'bg-rose-50', ring: 'ring-rose-200', dot: 'bg-rose-500', text: 'text-rose-700', icon: 'text-rose-600' }
    : stale
    ? { bg: 'bg-amber-50', ring: 'ring-amber-200', dot: 'bg-amber-500', text: 'text-amber-700', icon: 'text-amber-600' }
    : { bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', icon: 'text-emerald-600' };

  return (
    <div className={cn(
      'rounded-xl border border-slate-200/80 ring-1 p-3 print:hidden',
      tone.bg, tone.ring,
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-white/60', tone.dot, !stale && 'animate-pulse')} />
          <div className="text-sm min-w-0">
            {!s.enabled ? (
              <span className={cn('font-bold', tone.text)}>
                Auto-import đang TẮT — bật lại trong /admin để dữ liệu cập nhật tự động
              </span>
            ) : (
              <>
                <span className="font-semibold text-slate-700">Cập nhật lần cuối</span>{' '}
                <span className={cn('font-bold', tone.text)}>{lastStr}</span>
                <span className="text-slate-400 mx-2">·</span>
                <span className="font-semibold text-slate-700">Dữ liệu tới</span>{' '}
                <span className={cn('font-bold', tone.text)}>
                  {maxDate ? maxDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '—'}
                </span>
                {stale && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-bold ring-1 ring-amber-200">
                    <AlertCircle className="h-3 w-3" /> Trễ {daysOld} ngày
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={handleForce}
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-shrink-0',
              'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 shadow-sm',
            )}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            Import lại ngay
          </button>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  title,
  variant = 'ghost',
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  variant?: 'ghost' | 'primary';
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center h-9 px-3 rounded-lg border text-sm font-medium transition disabled:opacity-50',
        variant === 'primary'
          ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700 shadow-sm'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}

function KpiCard({
  label, value, badge, delta, deltaLabel, accent, loading,
}: {
  label: string;
  value: string;
  badge?: string;
  delta?: number | null;
  deltaLabel?: string;
  accent: 'sky' | 'emerald' | 'amber' | 'brand';
  loading?: boolean;
}) {
  const positive = typeof delta === 'number' && delta > 0;
  const accentBar = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    brand: 'bg-brand-500',
  }[accent];

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0 },
      }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative"
    >
      <div className={cn('absolute top-0 left-0 right-0 h-0.5', accentBar)} />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-semibold">{label}</div>
          {badge && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 tabular-nums">
              {badge}
            </span>
          )}
        </div>

        {loading ? (
          <div className="h-9 w-40 bg-slate-100 rounded mt-3 animate-pulse" />
        ) : (
          <div className="mt-2 text-[28px] xl:text-3xl font-bold text-slate-900 tabular-nums tracking-tight leading-tight">
            {value}
          </div>
        )}

        {delta != null && Number.isFinite(delta) ? (
          <div className="mt-3 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md',
                positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
              )}
            >
              {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {fmtPct(delta)}
            </span>
            {deltaLabel && <span className="text-[11px] text-slate-400">{deltaLabel}</span>}
          </div>
        ) : (
          <div className="mt-3 h-[22px]" />
        )}
      </div>
    </motion.div>
  );
}

function ReportLine({ label, value, suffix, highlight }: { label: string; value: number; suffix?: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={cn('text-sm', highlight ? 'font-semibold text-slate-900' : 'text-slate-600')}>{label}</span>
      <span className={cn('font-mono', highlight ? 'text-2xl font-bold text-slate-900' : 'text-base text-slate-700')}>
        <span className="tabular-nums">{value}</span>
        {suffix && <span className="text-xs text-slate-400 ml-1.5 font-sans">{suffix}</span>}
      </span>
    </div>
  );
}

function TypeTag({ tm, gc, round, typeTag }: { tm: number; gc: number; round: number; typeTag?: string }) {
  if (round === 1) {
    if (tm > 0 && gc > 0) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{tm}TM-{gc}GC</span>;
    if (tm > 0) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-mono">TM</span>;
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-mono">GC</span>;
  }
  const tag = typeTag || (gc > 0 ? 'GC' : 'TM');
  const isGC = tag === 'GC' || tag.includes('GC');
  return <span className={cn('text-[11px] px-1.5 py-0.5 rounded font-mono', isGC ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700')}>{tag}</span>;
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const cur = payload.find((p: any) => p.dataKey === 'amount')?.value || 0;
  const ly = payload.find((p: any) => p.dataKey === 'amount_ly')?.value || 0;
  const delta = ly ? ((cur - ly) / ly) * 100 : null;
  return (
    <div className="bg-slate-900 text-white rounded-lg shadow-xl px-3 py-2.5 text-xs border border-slate-700 min-w-[160px]">
      <div className="font-semibold text-slate-200 mb-1.5">{fmtDate(label)}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-brand-300">● Năm nay</span>
          <span className="font-mono tabular-nums">{fmtVNDShort(cur)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">○ Năm ngoái</span>
          <span className="font-mono tabular-nums text-slate-300">{fmtVNDShort(ly)}</span>
        </div>
        {delta != null && (
          <div className={cn('mt-1 pt-1.5 border-t border-slate-700 text-center font-semibold', delta > 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {fmtPct(delta)} YoY
          </div>
        )}
      </div>
    </div>
  );
}

function TrendStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div className="text-slate-500 text-[11px] uppercase tracking-wider">{label}</div>
      <div className={cn('font-bold tabular-nums mt-0.5 text-sm', positive && value.startsWith('+') ? 'text-emerald-700' : positive && value.startsWith('-') ? 'text-rose-700' : 'text-slate-900')}>
        {value}
      </div>
    </div>
  );
}

function Heatmap({ data, max }: { data: TopCodesPayload; max: number }) {
  const days = data.matrix[0]?.cells.length || 0;
  return (
    <div className="min-w-[860px]">
      {/* Date header */}
      <div className="grid items-end mb-2" style={{ gridTemplateColumns: `180px repeat(${days}, minmax(22px, 1fr)) 80px` }}>
        <div />
        {data.matrix[0]?.cells.map((c, i) => {
          const d = new Date(c.date);
          const dow = d.getDay();
          const showLabel = i % 3 === 0 || i === days - 1;
          return (
            <div key={c.date} className="text-center">
              {showLabel && (
                <div className={cn('text-[11px] font-mono', dow === 0 || dow === 6 ? 'text-slate-300' : 'text-slate-400')}>
                  {d.getDate()}
                </div>
              )}
            </div>
          );
        })}
        <div className="text-right text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Tổng</div>
      </div>
      {/* Rows */}
      <div className="space-y-1">
        {data.matrix.map((row) => (
          <div
            key={row.bqms_code}
            className="grid items-center group"
            style={{ gridTemplateColumns: `180px repeat(${days}, minmax(22px, 1fr)) 80px` }}
          >
            <div className="text-xs font-mono text-slate-700 truncate pr-3 group-hover:text-slate-900">{row.bqms_code}</div>
            {row.cells.map((c) => {
              const intensity = max > 0 ? c.amount / max : 0;
              const has = c.amount > 0;
              return (
                <div key={c.date} className="px-px py-px">
                  <div
                    className={cn(
                      'h-6 rounded transition-all hover:ring-2 hover:ring-sky-300 cursor-pointer',
                      !has && 'bg-slate-50',
                    )}
                    style={
                      has
                        ? { background: `rgba(14, 165, 233, ${0.15 + intensity * 0.75})` }
                        : undefined
                    }
                    title={has ? `${c.date}: ${fmtVNDShort(c.amount)}` : `${c.date}: 0`}
                  />
                </div>
              );
            })}
            <div className="text-right text-xs font-mono font-semibold text-slate-900 tabular-nums pl-2">
              {fmtVNDShort(row.total)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickAction({
  icon, label, href, hint,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  hint?: string;
}) {
  return (
    <a
      href={href}
      className="group/qa relative overflow-hidden rounded-xl p-4 border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50"
    >
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="h-10 w-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600">
            {icon}
          </div>
          <ArrowRight className="h-4 w-4 text-slate-300 transition-all group-hover/qa:text-brand-600 group-hover/qa:translate-x-1" />
        </div>
        <div className="text-sm font-bold mt-3 text-slate-900">{label}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-0.5 font-medium">{hint}</div>}
      </div>
    </a>
  );
}

function ActivityFeed() {
  const [items, setItems] = useState<Array<{ id: number; title: string; body: string; created_at: string; type: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: any[] }>('/api/v1/notifications?limit=5')
      .then((r) => setItems(r.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 bg-slate-50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="h-12 w-12 mx-auto mb-3 rounded-xl bg-slate-100 flex items-center justify-center">
          <Bell className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-400">Chưa có hoạt động gần đây</p>
      </div>
    );
  }

  const typeMap: Record<string, { tile: string; icon: React.ReactNode }> = {
    po_received: { tile: 'bg-sky-50 text-sky-600', icon: <Package className="h-4 w-4" /> },
    stock_alert: { tile: 'bg-rose-50 text-rose-600', icon: <AlertCircle className="h-4 w-4" /> },
    default: { tile: 'bg-slate-100 text-slate-500', icon: <Bell className="h-4 w-4" /> },
  };

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const t = typeMap[item.type] || typeMap.default;
        return (
          <div
            key={item.id}
            className="group/act relative flex items-start gap-3 p-3 rounded-xl border border-transparent transition-colors cursor-pointer hover:bg-slate-50 hover:border-slate-200"
          >
            <div className={cn(
              'h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0',
              t.tile,
            )}>
              {t.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900 truncate group-hover/act:text-brand-700 transition-colors">{item.title}</div>
              <div className="text-xs text-slate-500 truncate mt-0.5">{item.body?.split('\n')[0]}</div>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 tabular-nums flex-shrink-0 mt-1 px-1.5 py-0.5 rounded-md bg-slate-100/60 group-hover/act:bg-white group-hover/act:ring-1 group-hover/act:ring-slate-200/60 transition-all">
              {timeAgo(item.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d} ngày`;
}

function SkeletonStack({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" style={{ width: `${85 - i * 8}%` }} />
      ))}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10">
      <div className="text-slate-300 mb-2">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  );
}
