'use client';

import { type ElementType, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BadgeDollarSign,
  BarChart3,
  CalendarRange,
  Filter,
  FolderSearch,
  PackageSearch,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  TrendingDown,
  TrendingUp,
  Users2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { EmptyState } from '@/components/shared/empty-state';
import { PageTransition } from '@/components/shared/page-transition';

interface XnkRow {
  id: number;
  rfq_date?: string;
  quotation_no?: string;
  bqms_code?: string;
  item_name?: string;
  item_explain?: string;
  item_type?: string;
  maker?: string;
  notes?: string;
  notes2?: string;
  unit?: string;
  quantity?: number;
  quote_deadline?: string;
  bqms_code3?: string;
  hs_code?: string;
  price_usd?: number;
  price_vnd?: number;
  total_usd?: number;
  buyer_name?: string;
  seller_name?: string;
  quoted_date?: string;
  source?: string;
  raw_data?: Record<string, string | number | null> | string;
}

interface Stats {
  total_records: number;
  unique_products: number;
  unique_sellers: number;
  years_covered: number;
  latest_record?: string;
}

interface SellerRow {
  seller_name: string;
  deal_count: number;
  product_count: number;
  total_usd: number;
  latest_deal?: string;
}

interface HistoryStats {
  count?: number;
  sellers?: number;
  avg_usd?: number;
  min_usd?: number;
  max_usd?: number;
  latest_rfq?: string;
}

type SortMode = 'rfq_desc' | 'rfq_asc' | 'excel_desc' | 'excel_asc' | 'price_desc' | 'seller';

const TABS = [
  { key: 'search', label: 'Tra cứu giá' },
  { key: 'sellers', label: 'Đối thủ' },
] as const;

const QUICK_YEARS = ['', '2026', '2025', '2024'];
const DATE_COLUMNS = new Set(['Ngày Tháng', 'Ngày']);
const NUMBER_COLUMNS = new Set([
  '_excel_row_number',
  'TT',
  'Số lượng',
  'SL',
  'Tổng cộng USD',
  'Đơn giá USD',
  'Đơn giá \nVND',
  '2022 về trước đó',
  '2023',
  'Đến 11/2024',
]);
const WIDE_COLUMNS = new Set([
  'Tên hàng hóa',
  'Explain for detail? (Có thể viết tiếng việt)',
  'Miêu tả hàng hóa',
  'Nhà cung cấp khác / Ghi chú',
  'Bên mua',
  'Bên bán',
]);
const EXCEL_COLUMNS = [
  { key: '_excel_row_number', label: 'Dòng', sticky: true },
  { key: 'TT', label: 'TT', sticky: true },
  { key: 'Ngày Tháng', label: 'Ngày tháng', sticky: true },
  { key: 'Đơn hàng', label: 'Đơn hàng', sticky: true },
  { key: 'BMSQ', label: 'BMSQ', sticky: true },
  { key: 'Tên hàng hóa', label: 'Tên hàng hóa' },
  { key: 'Explain for detail? (Có thể viết tiếng việt)', label: 'Explain' },
  { key: 'Loại hàng', label: 'Loại hàng' },
  { key: 'Maker 업체', label: 'Maker' },
  { key: 'Ghi chú', label: 'Ghi chú' },
  { key: 'ghi chú2', label: 'Ghi chú 2' },
  { key: 'Đơn vị tính', label: 'Đơn vị tính' },
  { key: 'Số lượng', label: 'Số lượng' },
  { key: 'Quote Deadline', label: 'Quote deadline' },
  { key: 'Ngày', label: 'Ngày báo giá' },
  { key: 'BMSQ3', label: 'BMSQ3' },
  { key: 'Miêu tả hàng hóa', label: 'Miêu tả hàng hóa' },
  { key: 'Mã HS', label: 'Mã HS' },
  { key: 'ĐVT', label: 'ĐVT' },
  { key: 'SL', label: 'SL' },
  { key: 'Tổng cộng USD', label: 'Tổng USD' },
  { key: 'Đơn giá USD', label: 'Đơn giá USD' },
  { key: 'Đơn giá \nVND', label: 'Đơn giá VND' },
  { key: 'Bên mua', label: 'Bên mua' },
  { key: 'Bên bán', label: 'Bên bán' },
  { key: '2022 về trước đó', label: '2022 trở về trước' },
  { key: '2023', label: '2023' },
  { key: 'Đến 11/2024', label: 'Đến 11/2024' },
  { key: 'Nhà cung cấp khác / Ghi chú', label: 'NCC khác / ghi chú' },
] as const;

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits });
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function compactUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtUsd(n);
}

function getRawValue(row: XnkRow, key: string): string | number | null | undefined {
  if (!row.raw_data) return undefined;
  if (typeof row.raw_data === 'string') {
    try {
      const parsed = JSON.parse(row.raw_data) as Record<string, string | number | null>;
      return parsed[key];
    } catch {
      return undefined;
    }
  }
  return row.raw_data[key];
}

function formatCellValue(value: string | number | null | undefined, key: string): string {
  if (value == null || value === '') return '—';
  if (DATE_COLUMNS.has(key)) return formatDate(String(value));
  if (NUMBER_COLUMNS.has(key)) {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? String(value) : numeric.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }
  return String(value).replace(/\s+/g, ' ').trim() || '—';
}

function getColumnWidth(key: string): string {
  if (key === '_excel_row_number' || key === 'TT') return 'min-w-[72px]';
  if (DATE_COLUMNS.has(key)) return 'min-w-[120px]';
  if (NUMBER_COLUMNS.has(key)) return 'min-w-[96px]';
  if (WIDE_COLUMNS.has(key)) return 'min-w-[220px]';
  return 'min-w-[140px]';
}

function getMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function HeroStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ElementType;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
        <div className="rounded-xl bg-slate-100 p-2">
          <Icon className="h-4 w-4 text-slate-600" />
        </div>
      </div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function SearchField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
      />
    </label>
  );
}

export default function MarketPricesPage() {
  const [activeTab, setActiveTab] = useState<'search' | 'sellers'>('search');
  const [sellerPreset, setSellerPreset] = useState('');
  const { data: statsData } = useQuery({
    queryKey: ['xnk-stats'],
    queryFn: () => api.get<{ data: Stats }>('/api/v1/market-prices/stats'),
  });
  const stats: Stats = statsData?.data ?? ({} as Stats);

  const applySellerPreset = (sellerName: string) => {
    setSellerPreset(sellerName);
    setActiveTab('search');
  };

  return (
    <PageTransition>
      <div className="space-y-5">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#eef4fb_58%,#e8eef8_100%)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                Market Intelligence Console
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-[30px]">Tra cứu giá XNK</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Chuyển màn hình này thành nơi tra cứu thật sự dùng được: tìm kiếm rõ, nhìn thấy dữ liệu
                ngay, bấm vào là có lịch sử giá và đối thủ theo BQMS.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <HeroStat icon={FolderSearch} label="Tổng bản ghi" value={fmtNum(stats.total_records, 0)} hint="Kho giá XNK" />
              <HeroStat icon={PackageSearch} label="Sản phẩm" value={fmtNum(stats.unique_products, 0)} hint="BQMS khác nhau" />
              <HeroStat icon={Users2} label="Đối thủ" value={fmtNum(stats.unique_sellers, 0)} hint="Bên bán đã có" />
              <HeroStat icon={CalendarRange} label="Cập nhật" value={stats.latest_record ? formatDate(stats.latest_record) : '—'} hint={`${fmtNum(stats.years_covered, 0)} năm dữ liệu`} />
            </div>
          </div>
        </section>

        <div className="flex border-b border-slate-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'border-b-2 px-4 py-3 text-sm font-medium transition -mb-px',
                activeTab === tab.key ? 'border-sky-700 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'search' ? (
          <SearchTab stats={stats} sellerPreset={sellerPreset} onPresetConsumed={() => setSellerPreset('')} />
        ) : (
          <SellersTab onUseSeller={applySellerPreset} />
        )}
      </div>
    </PageTransition>
  );
}

function SearchTab({
  stats,
  sellerPreset,
  onPresetConsumed,
}: {
  stats: Stats;
  sellerPreset: string;
  onPresetConsumed: () => void;
}) {
  const [draft, setDraft] = useState({ q: '', bqms: '', hs: '', seller: '', year: '' });
  const [applied, setApplied] = useState({ q: '', bqms: '', hs: '', seller: '', year: '' });
  const [page, setPage] = useState(1);
  const [sortMode, setSortMode] = useState<SortMode>('rfq_desc');
  const [selected, setSelected] = useState<XnkRow | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (applied.q) params.set('q', applied.q);
    if (applied.bqms) params.set('bqms', applied.bqms);
    if (applied.hs) params.set('hs', applied.hs);
    if (applied.seller) params.set('seller', applied.seller);
    if (applied.year) params.set('year', applied.year);
    params.set('sort', sortMode);
    params.set('page', String(page));
    params.set('limit', '50');
    return params.toString();
  }, [applied, page, sortMode]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['xnk-search', applied, page, sortMode],
    queryFn: () => api.get<{ data: XnkRow[]; total: number }>(`/api/v1/market-prices/search?${queryString}`),
  });

  const rows = data?.data ?? [];

  const total = data?.total ?? 0;
  const medianUsd = getMedian(rows.map((row) => row.price_usd).filter((v): v is number => typeof v === 'number' && v > 0));
  const totalUsd = rows.reduce((sum, row) => sum + (row.total_usd ?? 0), 0);

  useEffect(() => {
    setSelected((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null);
  }, [rows]);

  useEffect(() => {
    if (!sellerPreset) return;
    setDraft((current) => ({ ...current, seller: sellerPreset }));
    setApplied((current) => ({ ...current, seller: sellerPreset }));
    setPage(1);
    onPresetConsumed();
  }, [sellerPreset, onPresetConsumed]);

  const { data: historyData, isFetching: historyLoading } = useQuery({
    queryKey: ['xnk-history', selected?.bqms_code],
    queryFn: () => api.get<{ data: XnkRow[]; stats: HistoryStats }>(`/api/v1/market-prices/by-bqms/${encodeURIComponent(selected?.bqms_code ?? '')}`),
    enabled: Boolean(selected?.bqms_code),
  });

  const historyRows = historyData?.data ?? [];
  const historyStats = historyData?.stats ?? {};
  const chartData = historyRows.slice().reverse().map((item) => ({ date: formatDate(item.rfq_date), price_usd: item.price_usd ?? 0 }));
  const compareAvg = selected?.price_usd && historyStats.avg_usd ? ((selected.price_usd - historyStats.avg_usd) / historyStats.avg_usd) * 100 : null;
  const activePills = [applied.q && `Từ khóa: ${applied.q}`, applied.bqms && `BQMS: ${applied.bqms}`, applied.hs && `HS: ${applied.hs}`, applied.seller && `Đối thủ: ${applied.seller}`, applied.year && `Năm: ${applied.year}`].filter(Boolean) as string[];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2.2fr)_320px]">
      <div className="space-y-4">
        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Search className="h-5 w-5 text-slate-400" />
                <input
                  value={draft.q}
                  onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
                  onKeyDown={(event) => event.key === 'Enter' && (setApplied(draft), setPage(1))}
                  placeholder="Tìm theo BQMS code, tên hàng, HS code, đối thủ..."
                  className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
                {(draft.q || draft.bqms || draft.hs || draft.seller || draft.year) && (
                  <button onClick={() => { const next = { q: '', bqms: '', hs: '', seller: '', year: '' }; setDraft(next); setApplied(next); setPage(1); }} className="rounded-full p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <SearchField label="BQMS code" value={draft.bqms} placeholder="VD: RC00..." onChange={(value) => setDraft((current) => ({ ...current, bqms: value }))} />
                <SearchField label="HS code" value={draft.hs} placeholder="Tìm theo mã HS" onChange={(value) => setDraft((current) => ({ ...current, hs: value }))} />
                <SearchField label="Đối thủ" value={draft.seller} placeholder="Tên bên bán" onChange={(value) => setDraft((current) => ({ ...current, seller: value }))} />
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_YEARS.map((year) => (
                  <button
                    key={year || 'all'}
                    onClick={() => setDraft((current) => ({ ...current, year }))}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                      draft.year === year ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                    )}
                  >
                    {year || 'Tất cả năm'}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Tóm tắt tra cứu</div>
              <div className="mt-3 grid gap-3">
                <SummaryLine label="Kết quả phù hợp" value={fmtNum(total, 0)} />
                <SummaryLine label="Median USD trang này" value={fmtUsd(medianUsd)} />
                <SummaryLine label="Tổng USD trang này" value={compactUsd(totalUsd)} />
                <SummaryLine label="Cập nhật gần nhất" value={stats.latest_record ? formatDate(stats.latest_record) : '—'} />
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => { setApplied(draft); setPage(1); }} className="flex-1 rounded-xl bg-sky-800 px-3 py-2 text-sm font-medium text-white hover:bg-sky-900">Tra cứu</button>
                <button onClick={() => { const next = { q: '', bqms: '', hs: '', seller: '', year: '' }; setDraft(next); setApplied(next); setPage(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"><RefreshCw className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
          {activePills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {activePills.map((pill) => (
                <span key={pill} className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  <Filter className="h-3.5 w-3.5" />
                  {pill}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Kết quả tra cứu</div>
              <div className="mt-1 text-xs text-slate-500">
                {fmtNum(total, 0)} bản ghi. Mặc định ưu tiên ngày RFQ mới nhất trên toàn bộ dữ liệu; nếu trùng ngày thì lấy dòng ở cuối file Excel lên trước.
              </div>
            </div>
            <select
              value={sortMode}
              onChange={(event) => {
                setSortMode(event.target.value as SortMode);
                setPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="rfq_desc">Ngày RFQ mới nhất</option>
              <option value="rfq_asc">Ngày RFQ cũ nhất</option>
              <option value="excel_desc">Dòng Excel mới nhất</option>
              <option value="excel_asc">Dòng Excel cũ nhất</option>
              <option value="price_desc">Giá USD giảm dần</option>
              <option value="seller">Theo tên đối thủ</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[2600px] text-[11px] leading-4">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Dòng</th>
                  <th className="px-2 py-2 text-left font-medium">Ngày tháng</th>
                  <th className="px-2 py-2 text-left font-medium">Đơn hàng</th>
                  <th className="px-2 py-2 text-left font-medium">BMSQ</th>
                  <th className="px-2 py-2 text-left font-medium">Tên hàng hóa</th>
                  <th className="px-2 py-2 text-left font-medium">Explain</th>
                  <th className="px-2 py-2 text-left font-medium">Loại hàng</th>
                  <th className="px-2 py-2 text-left font-medium">Maker</th>
                  <th className="px-2 py-2 text-left font-medium">Ghi chú</th>
                  <th className="px-2 py-2 text-left font-medium">Ngày báo giá</th>
                  <th className="px-2 py-2 text-left font-medium">Mã HS</th>
                  <th className="px-2 py-2 text-left font-medium">ĐVT</th>
                  <th className="px-2 py-2 text-right font-medium">SL</th>
                  <th className="px-2 py-2 text-right font-medium">Giá USD</th>
                  <th className="px-2 py-2 text-right font-medium">Tổng USD</th>
                  <th className="px-2 py-2 text-left font-medium">Bên mua</th>
                  <th className="px-2 py-2 text-left font-medium">Bên bán</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => <tr key={index}><td className="px-4 py-4" colSpan={17}><div className="h-12 animate-pulse rounded-2xl bg-slate-100" /></td></tr>)
                ) : rows.length === 0 ? (
                  <tr><td colSpan={17}><EmptyState icon={PackageSearch} heading="Chưa có kết quả phù hợp" description="Thử tìm theo tên hàng, HS code, BQMS hoặc đối thủ." actionLabel="Xóa bộ lọc" onAction={() => { const next = { q: '', bqms: '', hs: '', seller: '', year: '' }; setDraft(next); setApplied(next); setPage(1); }} className="py-14" /></td></tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} onClick={() => setSelected(row)} className={cn('cursor-pointer transition hover:bg-slate-50', selected?.id === row.id && 'bg-sky-50/70')}>
                      <td className="px-2 py-2 font-mono text-slate-500">{formatCellValue(getRawValue(row, '_excel_row_number'), '_excel_row_number')}</td>
                      <td className="px-2 py-2 text-slate-600">{formatDate(row.rfq_date ?? String(getRawValue(row, 'Ngày Tháng') ?? ''))}</td>
                      <td className="px-2 py-2 font-mono text-slate-600">{formatCellValue(getRawValue(row, 'Đơn hàng'), 'Đơn hàng')}</td>
                      <td className="px-2 py-2 font-mono font-semibold text-sky-700">{formatCellValue(getRawValue(row, 'BMSQ'), 'BMSQ')}</td>
                      <td className="px-2 py-2"><div className="max-w-[200px] truncate font-medium text-slate-800">{formatCellValue(getRawValue(row, 'Tên hàng hóa'), 'Tên hàng hóa')}</div></td>
                      <td className="px-2 py-2"><div className="max-w-[220px] truncate text-slate-500">{formatCellValue(getRawValue(row, 'Explain for detail? (Có thể viết tiếng việt)'), 'Explain for detail? (Có thể viết tiếng việt)')}</div></td>
                      <td className="px-2 py-2 text-slate-600">{formatCellValue(getRawValue(row, 'Loại hàng'), 'Loại hàng')}</td>
                      <td className="px-2 py-2"><div className="max-w-[120px] truncate text-slate-600">{formatCellValue(getRawValue(row, 'Maker 업체'), 'Maker 업체')}</div></td>
                      <td className="px-2 py-2"><div className="max-w-[160px] truncate text-slate-500">{formatCellValue(getRawValue(row, 'Ghi chú'), 'Ghi chú')}</div></td>
                      <td className="px-2 py-2 text-slate-600">{formatDate(row.quoted_date ?? String(getRawValue(row, 'Ngày') ?? ''))}</td>
                      <td className="px-2 py-2 font-mono text-slate-600">{formatCellValue(getRawValue(row, 'Mã HS'), 'Mã HS')}</td>
                      <td className="px-2 py-2 text-slate-500">{formatCellValue(getRawValue(row, 'ĐVT'), 'ĐVT')}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-600">{formatCellValue(getRawValue(row, 'SL'), 'SL')}</td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-900">{formatCellValue(getRawValue(row, 'Đơn giá USD'), 'Đơn giá USD')}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-700">{formatCellValue(getRawValue(row, 'Tổng cộng USD'), 'Tổng cộng USD')}</td>
                      <td className="px-2 py-2"><div className="max-w-[150px] truncate text-slate-600">{formatCellValue(getRawValue(row, 'Bên mua'), 'Bên mua')}</div></td>
                      <td className="px-2 py-2"><div className="max-w-[150px] truncate text-slate-700">{formatCellValue(getRawValue(row, 'Bên bán'), 'Bên bán')}</div></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 text-sm text-slate-500 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2"><BadgeDollarSign className="h-4 w-4 text-slate-400" />Đang hiển thị {fmtNum(rows.length, 0)} / {fmtNum(total, 0)} bản ghi{isFetching && !isLoading ? ' • đang làm mới dữ liệu...' : ''}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 disabled:opacity-40">Trước</button>
              <div className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-slate-700">Trang {page} / {Math.max(1, Math.ceil(total / 50))}</div>
              <button onClick={() => setPage((current) => current + 1)} disabled={page * 50 >= total} className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 disabled:opacity-40">Sau</button>
            </div>
          </div>
        </section>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="flex items-center justify-between">
              <div><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Chi tiết</div><div className="mt-1 text-lg font-semibold text-slate-900">Hồ sơ mã BQMS</div></div>
              <div className="rounded-2xl bg-slate-100 p-2"><BarChart3 className="h-4 w-4 text-slate-600" /></div>
            </div>
          </div>
          {!selected ? (
            <EmptyState icon={BarChart3} heading="Chọn một dòng để xem chi tiết" description="Panel này sẽ hiện lịch sử giá, số đối thủ, average/min/max và giao dịch cùng mã BQMS." className="py-16" />
          ) : (
            <div className="space-y-4 p-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-mono text-xs text-sky-700">{selected.bqms_code ?? '—'}</div>
                <div className="mt-1 text-base font-semibold leading-6 text-slate-900">{selected.item_name ?? 'Không có tên hàng'}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{selected.item_explain ?? 'Không có ghi chú mô tả bổ sung cho bản ghi này.'}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <HeroStat icon={BadgeDollarSign} label="Giá đang chọn" value={fmtUsd(selected.price_usd)} hint="Dòng hiện tại" />
                <HeroStat icon={Users2} label="Số đối thủ" value={fmtNum(historyStats.sellers, 0)} hint="Theo BQMS" />
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div><div className="text-sm font-semibold text-slate-900">Chỉ số tham chiếu</div><div className="text-xs text-slate-500">Dữ liệu từ /by-bqms/{selected.bqms_code ?? ''}</div></div>
                  {historyLoading && <span className="text-xs text-slate-400">Đang tải...</span>}
                </div>
                <div className="space-y-3">
                  <SummaryLine label="Số giao dịch cùng mã" value={fmtNum(historyStats.count, 0)} />
                  <SummaryLine label="Giá trung bình USD" value={fmtUsd(historyStats.avg_usd)} />
                  <SummaryLine label="Min / Max USD" value={`${fmtUsd(historyStats.min_usd)} / ${fmtUsd(historyStats.max_usd)}`} />
                  <SummaryLine label="Lần RFQ gần nhất" value={historyStats.latest_rfq ? formatDate(historyStats.latest_rfq) : '—'} />
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
                  {compareAvg == null ? (
                    'Chưa đủ dữ liệu để so sánh với average.'
                  ) : compareAvg <= 0 ? (
                    <span className="inline-flex items-center gap-2"><TrendingDown className="h-4 w-4 text-emerald-600" />Giá đang chọn thấp hơn trung bình {Math.abs(compareAvg).toFixed(1)}%.</span>
                  ) : (
                    <span className="inline-flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-600" />Giá đang chọn cao hơn trung bình {compareAvg.toFixed(1)}%.</span>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between"><div className="text-sm font-semibold text-slate-900">Lịch sử giá</div><div className="text-xs text-slate-500">{fmtNum(historyRows.length, 0)} dòng</div></div>
                <div className="h-40">
                  {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <defs><linearGradient id="marketHistory" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0f4c81" stopOpacity={0.28} /><stop offset="100%" stopColor="#0f4c81" stopOpacity={0.02} /></linearGradient></defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} />
                        <Tooltip formatter={(value: number) => fmtUsd(value)} labelFormatter={(label) => `Ngày: ${label}`} contentStyle={{ borderRadius: 16, borderColor: '#dbe3f0' }} />
                        <Area type="monotone" dataKey="price_usd" stroke="#0f4c81" fill="url(#marketHistory)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">Cần ít nhất 2 điểm dữ liệu để vẽ trend.</div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Giao dịch liên quan</div>
                <div className="space-y-3">
                  {historyLoading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />) : historyRows.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="text-xs font-mono text-slate-500">{formatDate(item.rfq_date)}</div><div className="mt-1 text-sm font-medium text-slate-800">{item.seller_name ?? 'Không rõ bên bán'}</div><div className="mt-1 text-xs text-slate-500">{item.buyer_name ?? 'Không rõ bên mua'}</div></div>
                        <div className="text-right"><div className="text-sm font-semibold text-slate-900">{fmtUsd(item.price_usd)}</div><div className="mt-1 text-xs text-slate-400">{fmtNum(item.quantity, 0)} {item.unit ?? ''}</div></div>
                      </div>
                    </div>
                  ))}
                  {!historyLoading && historyRows.length === 0 && <div className="rounded-2xl bg-slate-50 px-3 py-4 text-sm text-slate-400">Chưa có lịch sử giao dịch cho mã này.</div>}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Toàn bộ cột từ Excel</div>
                <div className="grid gap-3">
                  {EXCEL_COLUMNS.map((column) => (
                    <div key={column.key} className="rounded-2xl bg-slate-50 px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{column.label}</div>
                      <div className="mt-1 break-words text-sm text-slate-800">{formatCellValue(getRawValue(selected, column.key), column.key)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SellersTab({ onUseSeller }: { onUseSeller: (sellerName: string) => void }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['xnk-sellers', search],
    queryFn: () => api.get<{ data: SellerRow[] }>(`/api/v1/market-prices/sellers?q=${encodeURIComponent(search)}`),
  });
  const rows = data?.data ?? [];
  const topRows = rows.slice(0, 3);

  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Competitor Leaderboard</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">Bảng xếp hạng đối thủ</div>
            <div className="mt-2 text-sm leading-6 text-slate-600">Nhanh để thấy đối thủ nào xuất hiện nhiều, bán nhiều mã hàng và có tổng giá trị USD lớn.</div>
          </div>
          <div className="w-full max-w-md">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-5 w-5 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên đối thủ..." className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {topRows.map((row, index) => (
          <div key={row.seller_name} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Top {index + 1}</div><Tags className="h-4 w-4 text-slate-400" /></div>
            <div className="mt-4 text-lg font-semibold text-slate-900">{row.seller_name}</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SummaryLine label="Giao dịch" value={fmtNum(row.deal_count, 0)} />
              <SummaryLine label="Sản phẩm" value={fmtNum(row.product_count, 0)} />
              <SummaryLine label="Tổng USD" value={compactUsd(row.total_usd)} />
              <SummaryLine label="Gần nhất" value={formatDate(row.latest_deal)} />
            </div>
            <button
              onClick={() => onUseSeller(row.seller_name)}
              className="mt-4 w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100"
            >
              Tra cứu theo đối thủ này
            </button>
          </div>
        ))}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-sm font-semibold text-slate-900">Danh sách đối thủ</div>
          <div className="mt-1 text-xs text-slate-500">{fmtNum(rows.length, 0)} kết quả</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Tên đối thủ</th>
                <th className="px-4 py-3 text-right font-medium">Số giao dịch</th>
                <th className="px-4 py-3 text-right font-medium">Sản phẩm</th>
                <th className="px-4 py-3 text-right font-medium">Tổng USD</th>
                <th className="px-4 py-3 text-left font-medium">Gần nhất</th>
                <th className="px-4 py-3 text-left font-medium">Tác vụ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, index) => <tr key={index}><td className="px-4 py-4" colSpan={7}><div className="h-12 animate-pulse rounded-2xl bg-slate-100" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={Users2} heading="Chưa tìm thấy đối thủ" description="Thử đổi từ khóa khác hoặc bỏ trống ô search để xem bảng xếp hạng đầy đủ." className="py-14" /></td></tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.seller_name} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-400">{index + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{row.seller_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{fmtNum(row.deal_count, 0)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmtNum(row.product_count, 0)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{compactUsd(row.total_usd)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(row.latest_deal)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onUseSeller(row.seller_name)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
                      >
                        Mở tra cứu
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
