'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Trophy,
  RefreshCw,
  TrendingUp,
  Users as UsersIcon,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import {
  kpiApi,
  formatVND,
  formatMinutes,
  type LeaderboardMetric,
  type KpiTrendPoint,
} from '@/services/hr';

const METRIC_OPTIONS: Array<{ key: LeaderboardMetric; label: string }> = [
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'orders', label: 'Số đơn' },
  { key: 'customers', label: 'KH mới' },
  { key: 'quotes_won', label: 'Báo giá thắng' },
  { key: 'deals_closed', label: 'Deal đóng' },
  { key: 'active_days', label: 'Ngày hoạt động' },
];

export default function PerformancePage() {
  const { user } = useAuth();
  const isAuthorized = user?.role === 'manager' || user?.role === 'admin';

  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [metric, setMetric] = useState<LeaderboardMetric>('revenue');
  const [department, setDepartment] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const { data: lbRes, isLoading } = useQuery({
    queryKey: ['kpi', 'leaderboard', period, metric, department],
    queryFn: () => kpiApi.leaderboard({
      year: period.year,
      month: period.month,
      metric,
      department: department || undefined,
      limit: 30,
    }),
    enabled: isAuthorized,
  });

  const lb = lbRes?.data;
  const items = lb?.items ?? [];

  const recomputeMut = useMutation({
    mutationFn: () => kpiApi.recompute(period.year, period.month),
  });

  if (!isAuthorized) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-md px-4 py-3 text-sm text-rose-700">
        Trang này chỉ dành cho manager / admin.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Năng suất nhân viên</h1>
          <p className="text-sm text-slate-500">
            KPI tháng theo từng nhân viên — bảng xếp hạng và chi tiết.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker period={period} onChange={setPeriod} />
          {user?.role === 'admin' && (
            <button
              onClick={() => recomputeMut.mutate()}
              disabled={recomputeMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-50"
              title="Đặt lịch tính lại KPI cho tháng đang chọn"
            >
              <RefreshCw className={cn('w-4 h-4', recomputeMut.isPending && 'animate-spin')} />
              Tính lại
            </button>
          )}
        </div>
      </header>

      {recomputeMut.isSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-sm text-emerald-700">
          Đã đặt lịch tính lại — kết quả sẽ cập nhật trong vài phút.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Sắp xếp theo:</span>
        {METRIC_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setMetric(opt.key)}
            className={cn(
              'px-3 py-1 rounded-full text-sm border transition',
              metric === opt.key
                ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            )}
          >
            {opt.label}
          </button>
        ))}
        {user?.role === 'admin' && (
          <input
            type="text"
            placeholder="Lọc phòng ban..."
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="ml-auto px-3 py-1 border border-slate-300 rounded-md text-sm w-48"
          />
        )}
      </div>

      {/* Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <h2 className="font-semibold text-slate-800">
                Bảng xếp hạng {METRIC_OPTIONS.find((m) => m.key === metric)?.label} — {period.month}/{period.year}
                {lb?.period.is_current && <span className="ml-2 text-xs text-amber-600">(tháng đang chạy — số tạm thời)</span>}
              </h2>
            </div>
            {isLoading ? (
              <div className="text-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto" />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-slate-500">Không có dữ liệu cho kỳ này.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">Nhân viên</th>
                    <th className="px-3 py-2">Phòng</th>
                    <th className="px-3 py-2 text-right">Doanh thu</th>
                    <th className="px-3 py-2 text-right">Đơn</th>
                    <th className="px-3 py-2 text-right">KH mới</th>
                    <th className="px-3 py-2 text-right">BG thắng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr
                      key={it.user_id}
                      onClick={() => setSelectedUser(it.user_id)}
                      className={cn(
                        'cursor-pointer hover:bg-slate-50',
                        selectedUser === it.user_id && 'bg-blue-50'
                      )}
                    >
                      <td className="px-3 py-2.5 text-slate-500">
                        {it.rank === 1 ? '🥇' : it.rank === 2 ? '🥈' : it.rank === 3 ? '🥉' : it.rank}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{it.user_name}</td>
                      <td className="px-3 py-2.5 text-slate-600">{it.department ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatVND(it.revenue_vnd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{it.orders_count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{it.new_customers}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{it.quotes_won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          {selectedUser ? (
            <UserDetailCard userId={selectedUser} year={period.year} month={period.month} />
          ) : (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center text-sm text-slate-500">
              <UsersIcon className="w-8 h-8 mx-auto mb-2 text-slate-400" />
              Chọn 1 nhân viên trong bảng để xem chi tiết và xu hướng 6 tháng.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodPicker({
  period,
  onChange,
}: {
  period: { year: number; month: number };
  onChange: (p: { year: number; month: number }) => void;
}) {
  function shift(delta: number) {
    let m = period.month + delta;
    let y = period.year;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    onChange({ year: y, month: m });
  }
  return (
    <div className="inline-flex items-center border border-slate-300 rounded-md">
      <button onClick={() => shift(-1)} className="px-2 py-1.5 hover:bg-slate-50">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="px-3 py-1.5 text-sm font-medium tabular-nums">
        Tháng {period.month}/{period.year}
      </div>
      <button onClick={() => shift(1)} className="px-2 py-1.5 hover:bg-slate-50">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function UserDetailCard({
  userId,
  year,
  month,
}: {
  userId: string;
  year: number;
  month: number;
}) {
  const { data: monthlyRes, isLoading: monthlyLoading } = useQuery({
    queryKey: ['kpi', 'monthly', userId, year, month],
    queryFn: () => kpiApi.monthly({ user_id: userId, year, month }),
  });
  const { data: trendRes, isLoading: trendLoading } = useQuery({
    queryKey: ['kpi', 'trend', userId, 6],
    queryFn: () => kpiApi.trend(userId, 6),
  });

  const k = monthlyRes?.data;
  const series = trendRes?.data.series ?? [];

  if (monthlyLoading || trendLoading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" />
      </div>
    );
  }

  if (!k) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900">{k.user_name ?? userId.slice(0, 8)}</h3>
        <p className="text-xs text-slate-500">{k.department ?? '(không phòng)'}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Metric label="Doanh thu" value={formatVND(k.revenue_vnd)} />
        <Metric label="Số đơn" value={k.orders_count.toString()} />
        <Metric label="Khách mới" value={k.new_customers.toString()} />
        <Metric label="Mã mới" value={k.new_products.toString()} />
        <Metric label="BG đã gửi" value={k.quotes_sent.toString()} />
        <Metric label="BG thắng" value={k.quotes_won.toString()} />
        <Metric label="Deal đóng" value={k.deals_closed.toString()} />
        <Metric label="Báo cáo ngày" value={k.daily_reports_submitted.toString()} />
        <Metric label="Ngày hoạt động" value={k.active_days.toString()} />
        <Metric label="Ngày công" value={`${k.workdays_present}`} hint="chưa trừ lễ" />
        <Metric label="Ngày nghỉ" value={k.leave_days_taken.toString()} />
        <Metric
          label="Đi muộn"
          value={`${k.late_count ?? 0} lần`}
          hint={k.total_late_minutes ? formatMinutes(k.total_late_minutes) : undefined}
        />
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1">
          <TrendingUp className="w-3.5 h-3.5" />
          Doanh thu 6 tháng gần nhất
        </div>
        <SparkBar series={series} />
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-50 rounded-md px-2.5 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900 text-sm tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}

function SparkBar({ series }: { series: KpiTrendPoint[] }) {
  if (!series.length) {
    return <div className="text-xs text-slate-400">Chưa có dữ liệu trend.</div>;
  }
  const max = Math.max(...series.map((s) => s.revenue_vnd), 1);
  return (
    <div className="flex items-end gap-1.5 h-24">
      {series.map((s, idx) => {
        const h = Math.max(2, (s.revenue_vnd / max) * 100);
        return (
          <div key={idx} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={cn(
                'w-full rounded-t',
                s.is_final ? 'bg-blue-500' : 'bg-blue-300'
              )}
              style={{ height: `${h}%` }}
              title={`${s.month}/${s.year}: ${formatVND(s.revenue_vnd)}`}
            />
            <span className="text-[10px] text-slate-500 tabular-nums">{s.month}/{String(s.year).slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}
