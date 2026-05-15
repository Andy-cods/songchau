'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Download, RefreshCcw, BarChart3, TrendingUp, Truck,
  Package, DollarSign, Clock,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RevenueStats {
  summary: {
    total_orders: number;
    total_amount_vnd: number;
    delivered_amount_vnd: number;
    delivered_count: number;
    in_transit_count: number;
    pending_count: number;
    pending_amount_vnd: number;
    in_transit_amount_vnd: number;
    delivery_rate: number;
    avg_order_value: number;
    total_qty: number;
    delivered_qty: number;
  };
  timeseries: Array<{
    bucket: string; label: string; count: number;
    total_amount: number; delivered_amount: number; delivered_count: number;
  }>;
  breakdown: Array<{
    key: string; group_id?: number | null; count: number;
    total_amount: number; delivered_amount: number;
    delivered_count: number; pending_count: number;
  }>;
  group_by: string;
  filters_applied: Record<string, unknown>;
}

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: 'day', label: 'Theo ngày' },
  { value: 'month', label: 'Theo tháng' },
  { value: 'driver', label: 'Theo người giao' },
  { value: 'po', label: 'Theo mã PO' },
  { value: 'bqms', label: 'Theo BQMS code' },
  { value: 'recipient', label: 'Theo người nhận' },
  { value: 'origin', label: 'Theo xuất xứ' },
  { value: 'status', label: 'Theo trạng thái' },
];

const DATE_PRESETS: { key: string; label: string }[] = [
  { key: 'this_month', label: 'Tháng này' },
  { key: 'last_month', label: 'Tháng trước' },
  { key: 'last_30', label: '30 ngày' },
  { key: 'last_90', label: '90 ngày' },
  { key: 'this_year', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
];

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtVnd(v: number | null | undefined): string {
  if (v == null) return '0';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('vi-VN');
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '0';
  return Number(v).toLocaleString('vi-VN');
}

export function RevenueDashboardModal({
  initialMonth, initialYear, initialStatus, onClose,
}: {
  initialMonth?: string; initialYear?: string; initialStatus?: string;
  onClose: () => void;
}) {
  const initRange = useMemo(() => {
    const now = new Date();
    if (initialMonth && initialYear) {
      const m = parseInt(initialMonth) - 1;
      const y = parseInt(initialYear);
      return { from: isoDate(new Date(y, m, 1)), to: isoDate(new Date(y, m + 1, 0)) };
    }
    if (initialYear) {
      const y = parseInt(initialYear);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return {
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }, [initialMonth, initialYear]);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [status, setStatus] = useState<string>(
    initialStatus && initialStatus !== 'all' ? initialStatus : ''
  );
  const [groupBy, setGroupBy] = useState<string>('day');
  const [searchQ, setSearchQ] = useState('');

  const applyPreset = (key: string) => {
    const now = new Date();
    if (key === 'this_month') {
      setDateFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
      setGroupBy('day');
    } else if (key === 'last_month') {
      setDateFrom(isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setDateTo(isoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
      setGroupBy('day');
    } else if (key === 'last_30') {
      const from = new Date(); from.setDate(from.getDate() - 29);
      setDateFrom(isoDate(from)); setDateTo(isoDate(now));
      setGroupBy('day');
    } else if (key === 'last_90') {
      const from = new Date(); from.setDate(from.getDate() - 89);
      setDateFrom(isoDate(from)); setDateTo(isoDate(now));
      setGroupBy('day');
    } else if (key === 'this_year') {
      setDateFrom(`${now.getFullYear()}-01-01`);
      setDateTo(`${now.getFullYear()}-12-31`);
      setGroupBy('month');
    } else if (key === 'all') {
      setDateFrom(''); setDateTo('');
      setGroupBy('month');
    }
  };

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (status) p.set('status', status);
    if (searchQ.trim()) p.set('q', searchQ.trim());
    p.set('group_by', groupBy);
    p.set('breakdown_limit', '20');
    return p.toString();
  }, [dateFrom, dateTo, status, searchQ, groupBy]);

  const { data, isLoading, refetch, isFetching } = useQuery<RevenueStats>({
    queryKey: ['delivery-revenue-stats', queryParams],
    queryFn: () =>
      api.get<RevenueStats>(`/api/v1/bqms/deliveries/revenue-stats?${queryParams}`),
    retry: 1,
  });

  const summary = data?.summary;
  const timeseries = data?.timeseries ?? [];
  const breakdown = data?.breakdown ?? [];
  const isCategoricalGroup =
    groupBy !== 'day' && groupBy !== 'month';

  const handleExportCsv = () => {
    if (!data) return;
    const groupLabel =
      GROUP_OPTIONS.find(g => g.value === groupBy)?.label ?? groupBy;
    const headerRow = [
      groupLabel.replace('Theo ', ''),
      'Số đơn',
      'Tổng GT PO (VND)',
      'Đã giao (VND)',
      'Số đơn đã giao',
      'Tỷ lệ giao (%)',
      'Số đơn chưa giao',
    ];
    const dataRows = breakdown.map(b => {
      const rate = b.count > 0 ? (b.delivered_count / b.count) * 100 : 0;
      return [
        b.key,
        b.count,
        b.total_amount,
        b.delivered_amount,
        b.delivered_count,
        rate.toFixed(2),
        b.pending_count,
      ];
    });
    const csv = [headerRow, ...dataRows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Doanh_thu_PO_${groupBy}_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-lg">
              <BarChart3 className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-lg">
                Dashboard Doanh thu PO
              </h2>
              <p className="text-xs text-slate-500">
                Thống kê doanh thu, tỷ lệ giao —{' '}
                {GROUP_OPTIONS.find(g => g.value === groupBy)?.label.toLowerCase()}
                {dateFrom && dateTo && (
                  <>
                    {' '}· {dateFrom} → {dateTo}
                  </>
                )}
                {isFetching && (
                  <span className="ml-2 text-violet-500">cập nhật...</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50"
              title="Làm mới"
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              Làm mới
            </button>
            <button
              onClick={handleExportCsv}
              disabled={!data || breakdown.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Xuất CSV
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100"
            >
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Filter strip */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
            {DATE_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className="px-2.5 py-1 rounded text-xs font-medium text-slate-600 hover:bg-white hover:shadow-sm transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-slate-500">Từ</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1 border border-slate-200 rounded text-xs"
            />
            <span className="text-xs text-slate-500">đến</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1 border border-slate-200 rounded text-xs"
            />
          </div>

          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded text-xs bg-white"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="pending">Chưa giao</option>
            <option value="in_transit">Đang giao</option>
            <option value="delivered">Đã giao</option>
          </select>

          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            className="px-2 py-1 border border-violet-200 rounded text-xs bg-violet-50 font-semibold text-violet-700"
          >
            {GROUP_OPTIONS.map(g => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Tìm PO / BQMS / người nhận / spec..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded text-xs w-64 ml-auto"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              Đang tải dữ liệu...
            </div>
          ) : !summary ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              Không có dữ liệu cho bộ lọc này
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard
                  icon={Package} label="Tổng đơn PO"
                  value={fmtNum(summary.total_orders)}
                  sub={`${fmtNum(summary.total_qty)} sản phẩm`}
                  accent="blue"
                />
                <KpiCard
                  icon={DollarSign} label="Tổng GT PO"
                  value={fmtVnd(summary.total_amount_vnd)}
                  sub="VND (theo amount)"
                  accent="violet"
                />
                <KpiCard
                  icon={TrendingUp} label="Doanh thu đã giao"
                  value={fmtVnd(summary.delivered_amount_vnd)}
                  sub={`${summary.delivered_count} đơn`}
                  accent="emerald"
                />
                <KpiCard
                  icon={Clock} label="Chưa giao"
                  value={fmtVnd(summary.pending_amount_vnd)}
                  sub={`${summary.pending_count} đơn`}
                  accent="amber"
                />
                <KpiCard
                  icon={Truck} label="Đang giao"
                  value={fmtVnd(summary.in_transit_amount_vnd)}
                  sub={`${summary.in_transit_count} đơn`}
                  accent="cyan"
                />
                <KpiCard
                  icon={BarChart3} label="Tỷ lệ giao"
                  value={`${summary.delivery_rate.toFixed(1)}%`}
                  sub={`TB ${fmtVnd(summary.avg_order_value)}/đơn`}
                  accent="rose"
                />
              </div>

              {/* Timeseries chart */}
              {timeseries.length > 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">
                        Doanh thu theo {groupBy === 'month' ? 'tháng' : 'ngày'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {timeseries.length} điểm dữ liệu
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <Legend2 color="#8b5cf6" label="Tổng GT PO" />
                      <Legend2 color="#10b981" label="Đã giao" />
                      <Legend2 color="#f59e0b" label="Số đơn (trục phải)" />
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={timeseries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        yAxisId="left"
                        tickFormatter={(v) => fmtVnd(v as number)}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value: unknown, name: unknown) => {
                          const num = typeof value === 'number' ? value : Number(value);
                          if (name === 'count' || name === 'delivered_count') {
                            return [fmtNum(num), name === 'count' ? '# đơn' : '# đã giao'];
                          }
                          return [
                            fmtVnd(num),
                            name === 'total_amount' ? 'Tổng GT PO' : 'Đã giao',
                          ];
                        }}
                        labelStyle={{ fontSize: 12, fontWeight: 600 }}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar yAxisId="left" dataKey="total_amount" fill="#8b5cf6" />
                      <Bar yAxisId="left" dataKey="delivered_amount" fill="#10b981" />
                      <Line
                        yAxisId="right" type="monotone" dataKey="count"
                        stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
                  Không có timeseries (po_date / delivery_date đều rỗng cho khoảng này)
                </div>
              )}

              {/* Breakdown table */}
              {isCategoricalGroup && breakdown.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 text-sm">
                      Phân tích {GROUP_OPTIONS.find(g => g.value === groupBy)?.label.toLowerCase()}
                      <span className="ml-2 text-xs text-slate-400 font-normal">
                        (top {breakdown.length} theo Tổng GT PO)
                      </span>
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-xs uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2 text-left w-10">#</th>
                          <th className="px-4 py-2 text-left">
                            {GROUP_OPTIONS.find(g => g.value === groupBy)?.label.replace('Theo ', '')}
                          </th>
                          <th className="px-4 py-2 text-right">Số đơn</th>
                          <th className="px-4 py-2 text-right">Tổng GT PO</th>
                          <th className="px-4 py-2 text-right">Đã giao</th>
                          <th className="px-4 py-2 text-right">% giao</th>
                          <th className="px-4 py-2 text-right">Chưa giao</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {breakdown.map((b, idx) => {
                          const rate = b.count > 0
                            ? (b.delivered_count / b.count) * 100 : 0;
                          return (
                            <tr key={`${b.key}-${idx}`} className="hover:bg-slate-50">
                              <td className="px-4 py-2 text-xs text-slate-400 font-mono">
                                {idx + 1}
                              </td>
                              <td className="px-4 py-2 font-medium text-slate-900">
                                {b.key}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                {fmtNum(b.count)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-violet-700 tabular-nums">
                                {fmtVnd(b.total_amount)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-emerald-700 tabular-nums">
                                {fmtVnd(b.delivered_amount)}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <span className={cn(
                                  'inline-flex px-1.5 py-0.5 rounded text-xs font-semibold',
                                  rate >= 80 ? 'bg-emerald-50 text-emerald-700'
                                  : rate >= 40 ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                                )}>
                                  {rate.toFixed(0)}%
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                                {fmtNum(b.pending_count)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr className="text-sm font-semibold">
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 text-slate-700">Tổng (top hiển thị)</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {fmtNum(breakdown.reduce((s, b) => s + b.count, 0))}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-violet-700 tabular-nums">
                            {fmtVnd(breakdown.reduce((s, b) => s + b.total_amount, 0))}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-emerald-700 tabular-nums">
                            {fmtVnd(breakdown.reduce((s, b) => s + b.delivered_amount, 0))}
                          </td>
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {fmtNum(breakdown.reduce((s, b) => s + b.pending_count, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {!isCategoricalGroup && (
                <p className="text-xs text-slate-400 text-center pt-2">
                  Chuyển <strong>Group by</strong> sang Người giao / PO / BQMS / Người nhận / Xuất xứ / Trạng thái để xem bảng phân tích.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof Package;
  label: string; value: string; sub?: string;
  accent: 'blue' | 'violet' | 'emerald' | 'amber' | 'cyan' | 'rose';
}) {
  const cardClass = {
    blue: 'border-l-blue-500',
    violet: 'border-l-violet-500',
    emerald: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    cyan: 'border-l-cyan-500',
    rose: 'border-l-rose-500',
  }[accent];
  const iconClass = {
    blue: 'text-blue-600',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    cyan: 'text-cyan-600',
    rose: 'text-rose-600',
  }[accent];
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 border-l-4 p-3', cardClass)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('h-3.5 w-3.5', iconClass)} />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
          {label}
        </span>
      </div>
      <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
