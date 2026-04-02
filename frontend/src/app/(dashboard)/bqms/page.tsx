'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardList,
  RefreshCw,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  History,
  FileText,
  AlertTriangle,
  Clock,
  TrendingUp,
  Percent,
  DollarSign,
  Inbox,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────

interface BQMSRecord {
  id?: number;
  date?: string;
  created_at?: string;
  submitted_at?: string;
  rfq_no?: string;
  rfq_code?: string;
  order_number?: string;
  bqms_code?: string;
  reference_number?: string;
  product_name?: string;
  project_name?: string;
  maker?: string;
  quantity?: number;
  unit?: string;
  price_v1?: number;
  price_v2?: number;
  price_v3?: number;
  price_v4?: number;
  result?: string;
  status?: string;
  assignee?: string;
  person_in_charge?: string;
  deadline?: string;
}

interface OverviewStats {
  total_rfq?: number;
  total_bids?: number;
  processing?: number;
  win_rate?: number;
  avg_price?: number;
  last_synced?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value?: number): string {
  if (value == null) return '—';
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function getDeadlineUrgency(deadline?: string): 'red' | 'amber' | 'normal' | null {
  if (!deadline) return null;
  const now = new Date();
  const dl = new Date(deadline);
  const diffHours = (dl.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (diffHours < 0) return 'red';
  if (diffHours <= 24) return 'red';
  if (diffHours <= 48) return 'amber';
  return 'normal';
}

function getRecordDate(r: BQMSRecord): string {
  return r.date ?? r.created_at ?? r.submitted_at ?? '';
}

function getMonthKey(dateStr: string): string {
  if (!dateStr) return 'Không rõ';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Không rõ';
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

function groupByMonth(records: BQMSRecord[]): Map<string, BQMSRecord[]> {
  const map = new Map<string, BQMSRecord[]>();
  for (const r of records) {
    const key = getMonthKey(getRecordDate(r));
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return map;
}

// ─── Result Badge ────────────────────────────────────────────────

function ResultBadge({ result, status }: { result?: string; status?: string }) {
  const val = (result ?? status ?? '').toLowerCase();
  if (val === 'won' || val === 'win' || val === 'trúng')
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Trúng</span>;
  if (val === 'lost' || val === 'lose' || val === 'trượt')
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Trượt</span>;
  if (val === 'pending' || val === 'processing' || val === 'submitted')
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">Đang xử lý</span>;
  if (val === 'draft')
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-400">Nháp</span>;
  return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">{result ?? status ?? '—'}</span>;
}

// ─── KPI Card ────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {loading ? (
          <div className="h-6 w-20 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold font-mono text-slate-900 leading-tight">{value}</p>
        )}
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Table Skeleton ──────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-8 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Inline Action Bar ───────────────────────────────────────────

function InlineActionBar({
  record,
  onClose,
}: {
  record: BQMSRecord;
  onClose: () => void;
}) {
  const router = useRouter();
  const rfqCode = record.rfq_no ?? record.rfq_code ?? record.order_number ?? '';
  const id = record.id;

  return (
    <td
      colSpan={15}
      className="px-4 py-2 bg-brand-50/60 border-t border-brand-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 mr-1">Hành động:</span>
        <Link
          href={`/bqms/quotation/new${rfqCode ? `?rfq=${rfqCode}` : ''}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Tạo báo giá
        </Link>
        {rfqCode && (
          <Link
            href={`/bqms/quotation/history?rfq=${rfqCode}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <History className="h-3.5 w-3.5" />
            Xem lịch sử
          </Link>
        )}
        {id && (
          <button
            onClick={() => router.push(`/bqms/quotation/${id}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            Xem chi tiết
          </button>
        )}
        <button
          onClick={onClose}
          className="ml-auto text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
        >
          Đóng
        </button>
      </div>
    </td>
  );
}

// ─── Month Group ─────────────────────────────────────────────────

function MonthGroup({
  monthKey,
  records,
  selectedRowId,
  onRowClick,
}: {
  monthKey: string;
  records: BQMSRecord[];
  selectedRowId: string | null;
  onRowClick: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Month header */}
      <tr
        className="bg-slate-50 border-y border-slate-200 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <td colSpan={15} className="px-4 py-2">
          <div className="flex items-center gap-2">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {monthKey}
            </span>
            <span className="text-xs text-slate-400 ml-1">({records.length} bản ghi)</span>
          </div>
        </td>
      </tr>

      {!collapsed &&
        records.map((record, idx) => {
          const rowKey = String(record.id ?? `${monthKey}-${idx}`);
          const isSelected = selectedRowId === rowKey;
          const urgency = getDeadlineUrgency(record.deadline);
          const dateStr = getRecordDate(record);

          return (
            <>
              <tr
                key={rowKey}
                onClick={() => onRowClick(isSelected ? '' : rowKey)}
                className={cn(
                  'border-b border-slate-100 transition-colors cursor-pointer',
                  isSelected ? 'bg-brand-50/40' : 'hover:bg-slate-50/60',
                  urgency === 'red' ? 'bg-red-50/30' : '',
                  urgency === 'amber' && !isSelected ? 'bg-amber-50/20' : ''
                )}
              >
                {/* STT */}
                <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">{idx + 1}</td>
                {/* Ngày */}
                <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                  {dateStr ? formatDate(dateStr) : '—'}
                </td>
                {/* RFQ No */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    {urgency === 'red' && (
                      <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />
                    )}
                    {urgency === 'amber' && !urgency && (
                      <Clock className="h-3 w-3 text-amber-500 flex-shrink-0" />
                    )}
                    <span className="text-xs font-mono text-brand-600 whitespace-nowrap">
                      {record.rfq_no ?? record.rfq_code ?? record.order_number ?? '—'}
                    </span>
                  </div>
                </td>
                {/* BQMS Code */}
                <td className="px-3 py-2.5">
                  <span className="text-xs font-mono text-slate-600">
                    {record.bqms_code ?? record.reference_number ?? '—'}
                  </span>
                </td>
                {/* Tên hàng */}
                <td className="px-3 py-2.5 max-w-[180px]">
                  <span className="text-xs text-slate-800 truncate block">
                    {record.product_name ?? record.project_name ?? '—'}
                  </span>
                </td>
                {/* Maker */}
                <td className="px-3 py-2.5">
                  <span className="text-xs text-slate-600">{record.maker ?? '—'}</span>
                </td>
                {/* SL */}
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-slate-700">
                    {record.quantity != null
                      ? Number(record.quantity).toLocaleString('vi-VN')
                      : '—'}
                  </span>
                </td>
                {/* Đơn vị */}
                <td className="px-3 py-2.5">
                  <span className="text-xs text-slate-500">{record.unit ?? '—'}</span>
                </td>
                {/* Giá v1–v4 */}
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-slate-600">{fmtVnd(record.price_v1)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-slate-600">{fmtVnd(record.price_v2)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-slate-600">{fmtVnd(record.price_v3)}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-slate-600">{fmtVnd(record.price_v4)}</span>
                </td>
                {/* Kết quả */}
                <td className="px-3 py-2.5">
                  <ResultBadge result={record.result} status={record.status} />
                </td>
                {/* Deadline */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {record.deadline ? (
                    <span
                      className={cn(
                        'text-xs font-medium',
                        urgency === 'red' ? 'text-red-600' : urgency === 'amber' ? 'text-amber-600' : 'text-slate-500'
                      )}
                    >
                      {urgency === 'red' && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}
                      {urgency === 'amber' && <Clock className="inline h-3 w-3 mr-0.5 -mt-0.5" />}
                      {formatDate(record.deadline)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                {/* Người phụ trách */}
                <td className="px-3 py-2.5">
                  <span className="text-xs text-slate-500">
                    {record.assignee ?? record.person_in_charge ?? '—'}
                  </span>
                </td>
              </tr>
              {isSelected && (
                <tr key={`action-${rowKey}`} className="border-b border-brand-100">
                  <InlineActionBar record={record} onClose={() => onRowClick('')} />
                </tr>
              )}
            </>
          );
        })}
    </>
  );
}

// ─── Quotation History ───────────────────────────────────────────

function QuotationHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['quotation-history'],
    queryFn: () => api.get<any>('/api/v1/quotations/history?page=1'),
    retry: 1,
  });

  const items: any[] = data?.data ?? data?.items ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-slate-700">Lịch sử báo giá gần đây</h3>
        </div>
        <Link
          href="/bqms/quotation/history"
          className="text-xs text-brand-600 hover:underline"
        >
          Xem tất cả
        </Link>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-40 bg-slate-200 rounded animate-pulse flex-1" />
              <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
              <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-slate-300">
          <Inbox className="h-10 w-10 mb-2" />
          <p className="text-sm text-slate-400">Chưa có báo giá nào</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2">Ngày</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2">Số BG</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2">Khách hàng</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2">Giá trị</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.slice(0, 10).map((item: any, i: number) => (
                <tr key={item.id ?? i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {formatDate(item.date ?? item.created_at ?? item.submitted_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-mono text-brand-600">
                      {item.quotation_number ?? item.quote_no ?? item.id ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700 max-w-[180px] truncate">
                    {item.customer_name ?? item.client ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-700">
                    {fmtVnd(item.total_amount ?? item.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResultBadge result={item.result} status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function BQMSUnifiedPage() {
  const queryClient = useQueryClient();
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Build year options (current year and past 2)
  const yearOptions = [currentDate.getFullYear(), currentDate.getFullYear() - 1, currentDate.getFullYear() - 2];
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  // Auto-refresh every 30s
  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bqms-records'] });
    queryClient.invalidateQueries({ queryKey: ['bqms-overview'] });
  }, [queryClient]);

  useEffect(() => {
    const interval = setInterval(refetchAll, 30000);
    return () => clearInterval(interval);
  }, [refetchAll]);

  // Fetch records
  const { data: recordsRaw, isLoading: recordsLoading, dataUpdatedAt } = useQuery({
    queryKey: ['bqms-records'],
    queryFn: () => api.get<any>('/api/v1/bqms/records'),
    retry: 1,
  });

  // Fetch overview stats
  const { data: overviewRaw, isLoading: overviewLoading } = useQuery({
    queryKey: ['bqms-overview'],
    queryFn: () => api.get<any>('/api/v1/price-analytics/overview?months=12'),
    retry: 1,
  });

  const allRecords: BQMSRecord[] = recordsRaw?.data ?? recordsRaw?.items ?? [];
  const overviewData: OverviewStats = overviewRaw?.data ?? overviewRaw ?? {};

  // Filter by selected month/year
  const filteredByPeriod = allRecords.filter((r) => {
    const d = new Date(getRecordDate(r));
    if (isNaN(d.getTime())) return true; // include records without date
    return d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear;
  });

  // Filter by search + status
  const filtered = filteredByPeriod.filter((r) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      (r.rfq_no ?? r.rfq_code ?? r.order_number ?? '').toLowerCase().includes(q) ||
      (r.bqms_code ?? r.reference_number ?? '').toLowerCase().includes(q) ||
      (r.product_name ?? r.project_name ?? '').toLowerCase().includes(q) ||
      (r.maker ?? '').toLowerCase().includes(q);

    const matchStatus =
      statusFilter === 'all' ||
      (r.result ?? r.status ?? '').toLowerCase() === statusFilter;

    return matchSearch && matchStatus;
  });

  // Group by month for display (when showing across all months, group; otherwise flat)
  const grouped = groupByMonth(filtered);

  // KPI data
  const totalRFQ = overviewData.total_rfq ?? overviewData.total_bids ?? allRecords.length;
  const processing =
    overviewData.processing ??
    allRecords.filter((r) => {
      const s = (r.result ?? r.status ?? '').toLowerCase();
      return s === 'pending' || s === 'processing' || s === 'submitted' || s === 'draft';
    }).length;
  const winRate = Number(overviewData.win_rate ?? 0);
  const avgPrice = overviewData.avg_price;

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">BQMS Thống nhất</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý RFQ, báo giá, lịch sử và template
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/bqms/rfq"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            RFQ
          </Link>
          <Link
            href="/bqms/quotation/templates"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Template
          </Link>
          <Link
            href="/bqms/quotation/new"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Tạo báo giá
          </Link>
          <button
            onClick={refetchAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            title="Làm mới"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-slate-400">
              {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </button>
        </div>
      </div>

      {/* ── KPI Bar ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <KPICard
          label="Tổng RFQ"
          value={totalRFQ}
          icon={ClipboardList}
          color="bg-brand-50 text-brand-600"
          loading={overviewLoading}
        />
        <KPICard
          label="Đang xử lý"
          value={processing}
          sub="chờ báo giá"
          icon={Clock}
          color="bg-amber-50 text-amber-600"
          loading={overviewLoading}
        />
        <KPICard
          label="Win rate"
          value={winRate > 0 ? `${winRate.toFixed(1)}%` : '—'}
          icon={Percent}
          color="bg-emerald-50 text-emerald-600"
          loading={overviewLoading}
        />
        <KPICard
          label="Giá trung bình"
          value={fmtVnd(avgPrice)}
          icon={DollarSign}
          color="bg-cyan-50 text-cyan-600"
          loading={overviewLoading}
        />
      </div>

      {/* ── Filter Bar ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* Month/Year selectors */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Tháng:</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Năm:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-slate-200" />

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo RFQ / BQMS code / tên hàng..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 w-full"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Đang xử lý</option>
            <option value="won">Trúng</option>
            <option value="lost">Trượt</option>
            <option value="draft">Nháp</option>
          </select>

          <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
            {filtered.length} bản ghi
          </span>
        </div>
      </div>

      {/* ── Main Table ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Danh sách BQMS — Tháng {selectedMonth}/{selectedYear}
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200" />
              Quá hạn/&lt;24h
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-100" />
              &lt;48h
            </span>
          </div>
        </div>

        {recordsLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Inbox className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              Không có dữ liệu cho kỳ này
            </p>
            <p className="text-xs text-slate-300 mt-1">
              Thử thay đổi bộ lọc tháng/năm hoặc tìm kiếm
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1100px]">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 w-10">STT</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Ngày</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">RFQ No.</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">BQMS Code</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Tên hàng</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Maker</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 text-right">SL</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">ĐVT</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 text-right">Giá v1</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 text-right">Giá v2</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 text-right">Giá v3</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400 text-right">Giá v4</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Kết quả</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Deadline</th>
                  <th className="px-3 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-400">Phụ trách</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(grouped.entries()).map(([monthKey, recs]) => (
                  <MonthGroup
                    key={monthKey}
                    monthKey={monthKey}
                    records={recs}
                    selectedRowId={selectedRowId}
                    onRowClick={setSelectedRowId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quotation History ─────────────────────────────────── */}
      <QuotationHistory />
    </div>
  );
}
