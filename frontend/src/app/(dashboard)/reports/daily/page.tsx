'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import {
  ResponsiveContainer, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Area, AreaChart, ReferenceLine,
} from 'recharts';
import {
  Copy, Check, Calendar as CalendarIcon, TrendingUp, TrendingDown,
  Package, Truck, Sparkles, FileText, RefreshCw, Printer, Share2,
  ArrowRight, Clock, BarChart3, Bell, ChevronRight,
  AlertCircle, Eye, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const [morning, setMorning] = useState<MorningReport | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topCodes, setTopCodes] = useState<TopCodesPayload | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const n = trendPeriod === 'day' ? 30 : trendPeriod === 'week' ? 12 : 13;
      const [m, r, t, tc] = await Promise.all([
        api.get<MorningReport>(`/api/v1/daily-report/morning?report_date=${reportDate}`),
        api.get<RevenueSummary>(`/api/v1/daily-report/revenue?report_date=${reportDate}`),
        api.get<{ series: TrendPoint[] }>(`/api/v1/daily-report/trend?period=${trendPeriod}&n=${n}`),
        api.get<TopCodesPayload>(`/api/v1/daily-report/top-codes?days=21&limit=12`),
      ]);
      setMorning(m);
      setRevenue(r);
      setTrend(t.series || []);
      setTopCodes(tc);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-blue-50/30 -m-6 p-6 print:bg-white print:p-0">
      {/* ─── STICKY HEADER ─────────────────────────────────────── */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 px-6 py-4 backdrop-blur-md bg-white/70 border-b border-slate-200/80 print:hidden"
      >
        <div className="flex items-center justify-between gap-4 max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-sky-500/30 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Báo cáo doanh thu hàng ngày</h1>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <Clock className="h-3 w-3" />
                <span>Cập nhật {updatedTimeStr}</span>
                <span className="text-slate-300">·</span>
                <span>Cutoff {revenue?.cutoff || '—'}</span>
                {refreshing && (
                  <span className="inline-flex items-center gap-1 text-sky-600">
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
        {/* ─── HERO KPI STRIP ───────────────────────────────────── */}
        <motion.section
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <KpiCard
            label="Hôm nay"
            value={fmtVND(revenue?.po_revenue.today.amount || 0)}
            badge={`${revenue?.po_revenue.today.count || 0} PO`}
            delta={revenue?.po_revenue.delta_yoy_today_pct}
            deltaLabel="vs cùng ngày năm ngoái"
            accent="sky"
            loading={loading}
          />
          <KpiCard
            label="Tuần này"
            value={fmtVND(revenue?.po_revenue.week.amount || 0)}
            badge={`${revenue?.po_revenue.week.count || 0} PO`}
            accent="emerald"
            loading={loading}
          />
          <KpiCard
            label="Tháng này (MTD)"
            value={fmtVND(revenue?.po_revenue.month.amount || 0)}
            badge={`${revenue?.po_revenue.month.count || 0} PO`}
            delta={revenue?.po_revenue.delta_yoy_mtd_pct}
            deltaLabel="YoY MTD"
            accent="amber"
            loading={loading}
          />
          <KpiCard
            label="Giao hàng tuần"
            value={fmtVND(revenue?.delivery_revenue.week.amount_vnd || 0)}
            badge={`${revenue?.delivery_revenue.week.count || 0} lô`}
            accent="violet"
            loading={loading}
          />
        </motion.section>

        {/* ─── MAIN GRID ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Morning report card — left */}
          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-4 print:col-span-12"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
              <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 opacity-80" />
                    <h2 className="text-sm font-semibold uppercase tracking-wider">Báo cáo buổi sáng</h2>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="text-xs flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md transition print:hidden"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Đã copy' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-slate-300 mt-1">Format chuẩn để paste Zalo group sáng</p>
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
                          <span className="text-[10px] text-amber-600/70">(do nhân viên ghi)</span>
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

          {/* Trend chart — right (8 cols) */}
          <motion.section
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 }}
            className="lg:col-span-8 print:col-span-12 print:hidden"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    <h2 className="font-semibold text-slate-900">Xu hướng doanh thu</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">YoY</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    PO theo {trendPeriod === 'day' ? '30 ngày' : trendPeriod === 'week' ? '12 tuần' : '13 tháng'} · so sánh năm ngoái
                  </p>
                </div>
                <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
                  {(['day', 'week', 'month'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setTrendPeriod(p)}
                      className={cn(
                        'px-3 py-1.5 rounded-md transition-all',
                        trendPeriod === p
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {p === 'day' ? 'Ngày' : p === 'week' ? 'Tuần' : 'Tháng'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 p-4 min-h-[340px]">
                {loading ? (
                  <div className="h-full bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl animate-pulse" />
                ) : trend.length === 0 ? (
                  <EmptyState icon={<BarChart3 />} text="Chưa có dữ liệu cho khoảng thời gian này" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendBar" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={fmtDate}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        width={56}
                        tickFormatter={(v) => fmtVNDShort(v)}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#f1f5f9' }}
                        content={<TrendTooltip />}
                      />
                      <Bar dataKey="amount" name="Năm nay" fill="url(#trendBar)" radius={[8, 8, 0, 0]} maxBarSize={40} />
                      <Line
                        dataKey="amount_ly"
                        name="Năm ngoái"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ fill: '#fff', stroke: '#94a3b8', strokeWidth: 2, r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 grid grid-cols-3 gap-4 text-xs">
                <TrendStat label="Tổng kỳ" value={fmtVNDShort(trend.reduce((s, t) => s + t.amount, 0))} />
                <TrendStat label="Cao nhất" value={fmtVNDShort(trend.reduce((m, t) => Math.max(m, t.amount), 0))} />
                <TrendStat
                  label="So với năm ngoái"
                  value={(() => {
                    const cur = trend.reduce((s, t) => s + t.amount, 0);
                    const ly = trend.reduce((s, t) => s + t.amount_ly, 0);
                    if (!ly) return '—';
                    const d = ((cur - ly) / ly) * 100;
                    return fmtPct(d);
                  })()}
                  positive
                />
              </div>
            </div>
          </motion.section>
        </div>

        {/* ─── HEATMAP ──────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:hidden"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-slate-400" />
                <h2 className="font-semibold text-slate-900">Top mã linh kiện × 21 ngày</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Doanh thu theo mã từng ngày — màu càng đậm, doanh thu càng cao
              </p>
            </div>
            {topCodes && topCodes.matrix.length > 0 && (
              <div className="text-xs text-slate-500 flex items-center gap-3">
                <span>Top {topCodes.matrix.length} mã</span>
                <div className="flex items-center gap-1">
                  <span>Thấp</span>
                  <div className="flex">
                    {[0.15, 0.3, 0.5, 0.7, 0.9].map((a, i) => (
                      <div key={i} className="h-3 w-3" style={{ background: `rgba(14, 165, 233, ${a})` }} />
                    ))}
                  </div>
                  <span>Cao</span>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:hidden">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <h2 className="font-semibold text-slate-900">Hành động nhanh</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction icon={<Sparkles />} label="Tạo báo giá mới" href="/bqms/quotation/new" color="sky" />
              <QuickAction icon={<Eye />} label="Tra giá Ctrl+K" href="#" color="emerald" hint="Mở thanh tìm kiếm trên cùng" />
              <QuickAction icon={<RefreshCw />} label="Đồng bộ BQMS" href="/bqms" color="amber" />
              <QuickAction icon={<Truck />} label="Quản lý giao hàng" href="/bqms/deliveries" color="violet" />
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-slate-400" />
                <h2 className="font-semibold text-slate-900">Hoạt động gần đây</h2>
              </div>
              <a href="/notifications" className="text-xs text-sky-700 hover:text-sky-900 flex items-center gap-0.5">
                Xem tất cả <ChevronRight className="h-3 w-3" />
              </a>
            </div>
            <ActivityFeed />
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
          ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-sm'
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
  accent: 'sky' | 'emerald' | 'amber' | 'violet';
  loading?: boolean;
}) {
  const positive = typeof delta === 'number' && delta > 0;
  const accentBar = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    violet: 'bg-violet-500',
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
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 tabular-nums">
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
    if (tm > 0 && gc > 0) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{tm}TM-{gc}GC</span>;
    if (tm > 0) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-mono">TM</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-mono">GC</span>;
  }
  const tag = typeTag || (gc > 0 ? 'GC' : 'TM');
  const isGC = tag === 'GC' || tag.includes('GC');
  return <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', isGC ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700')}>{tag}</span>;
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
          <span className="text-sky-300">● Năm nay</span>
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
      <div className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</div>
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
                <div className={cn('text-[9px] font-mono', dow === 0 || dow === 6 ? 'text-slate-300' : 'text-slate-400')}>
                  {d.getDate()}
                </div>
              )}
            </div>
          );
        })}
        <div className="text-right text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Tổng</div>
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
  icon, label, href, color, hint,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  color: 'sky' | 'emerald' | 'amber' | 'violet';
  hint?: string;
}) {
  const colorMap = {
    sky: 'from-sky-50 to-sky-100/50 hover:from-sky-100 hover:to-sky-200/60 text-sky-700 border-sky-100',
    emerald: 'from-emerald-50 to-emerald-100/50 hover:from-emerald-100 hover:to-emerald-200/60 text-emerald-700 border-emerald-100',
    amber: 'from-amber-50 to-amber-100/50 hover:from-amber-100 hover:to-amber-200/60 text-amber-700 border-amber-100',
    violet: 'from-violet-50 to-violet-100/50 hover:from-violet-100 hover:to-violet-200/60 text-violet-700 border-violet-100',
  };
  return (
    <a
      href={href}
      className={cn(
        'group bg-gradient-to-br rounded-xl p-4 border transition-all hover:shadow-md',
        colorMap[color],
      )}
    >
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 rounded-lg bg-white shadow-sm flex items-center justify-center">
          {icon}
        </div>
        <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
      </div>
      <div className="text-sm font-semibold mt-3">{label}</div>
      {hint && <div className="text-[11px] opacity-70 mt-0.5">{hint}</div>}
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
      <div className="py-8 text-center">
        <Bell className="h-6 w-6 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">Chưa có hoạt động gần đây</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition group cursor-pointer">
          <div className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
            item.type === 'po_received' ? 'bg-sky-50 text-sky-600' :
            item.type === 'stock_alert' ? 'bg-rose-50 text-rose-600' :
            'bg-slate-100 text-slate-500',
          )}>
            {item.type === 'po_received' ? <Package className="h-4 w-4" /> :
             item.type === 'stock_alert' ? <AlertCircle className="h-4 w-4" /> :
             <Bell className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 truncate">{item.title}</div>
            <div className="text-xs text-slate-500 truncate">{item.body?.split('\n')[0]}</div>
          </div>
          <div className="text-[10px] text-slate-400 flex-shrink-0 mt-1">
            {timeAgo(item.created_at)}
          </div>
        </div>
      ))}
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
