'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarOff,
  Clock,
  Inbox,
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  X,
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import {
  leaveApi,
  attendanceApi,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_BADGE,
  INCIDENT_TYPE_LABELS,
  INCIDENT_TYPE_BADGE,
  formatMinutes,
  type LeaveRequest,
  type LeaveType,
  type AttendanceIncident,
  type IncidentType,
  type LeaveBalance,
} from '@/services/hr';

type Tab = 'leave' | 'attendance' | 'pending';

export default function HRPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('leave');
  const isManagerOrAdmin = user?.role === 'manager' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nhân sự</h1>
          <p className="text-sm text-slate-500">
            Quản lý đơn xin nghỉ phép, ghi nhận đi muộn / về sớm.
          </p>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'leave'} onClick={() => setTab('leave')} icon={<CalendarOff className="w-4 h-4" />}>
          Nghỉ phép
        </TabButton>
        <TabButton active={tab === 'attendance'} onClick={() => setTab('attendance')} icon={<Clock className="w-4 h-4" />}>
          Đi muộn / Về sớm
        </TabButton>
        {isManagerOrAdmin && (
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')} icon={<Inbox className="w-4 h-4" />}>
            Đợi xử lý
          </TabButton>
        )}
      </nav>

      {tab === 'leave' && <LeaveTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'pending' && isManagerOrAdmin && <PendingTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1 — LEAVE
// ═══════════════════════════════════════════════════════════════

function LeaveTab() {
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const year = new Date().getFullYear();

  const { data: balanceRes } = useQuery({
    queryKey: ['hr', 'leave', 'balance', user?.id, year],
    queryFn: () => leaveApi.balance(user!.id, year),
    enabled: !!user?.id,
  });
  const balance = balanceRes?.data;

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['hr', 'leave', 'list', user?.id],
    queryFn: () => leaveApi.list({ user_id: user!.id, limit: 50 }),
    enabled: !!user?.id,
  });
  const requests = listRes?.data.items ?? [];

  return (
    <div className="space-y-4">
      {balance && <BalanceCard balance={balance} />}

      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-slate-800">Đơn của tôi</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Xin nghỉ phép
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500">
          Bạn chưa có đơn xin nghỉ nào.
        </div>
      ) : (
        <LeaveTable requests={requests} />
      )}

      {showCreate && <LeaveCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const items: Array<{ label: string; total: number; used: number; remaining: number }> = [
    { label: 'Phép năm', total: balance.annual_total, used: balance.annual_used, remaining: balance.remaining.annual },
    { label: 'Nghỉ ốm', total: balance.sick_total, used: balance.sick_used, remaining: balance.remaining.sick },
    { label: 'Việc riêng', total: balance.personal_total, used: balance.personal_used, remaining: balance.remaining.personal },
    { label: 'Thai sản', total: balance.maternity_total, used: balance.maternity_used, remaining: balance.remaining.maternity },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{it.label} {balance.period_year}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{it.remaining}</span>
            <span className="text-xs text-slate-400">/ {it.total} ngày còn lại</span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${Math.min(100, (it.used / Math.max(1, it.total)) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaveTable({ requests }: { requests: LeaveRequest[] }) {
  const qc = useQueryClient();
  const cancelMut = useMutation({
    mutationFn: (id: number) => leaveApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
  });

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Loại</th>
            <th className="px-4 py-2.5">Từ ngày</th>
            <th className="px-4 py-2.5">Đến ngày</th>
            <th className="px-4 py-2.5">Số ngày</th>
            <th className="px-4 py-2.5">Trạng thái</th>
            <th className="px-4 py-2.5">Lý do</th>
            <th className="px-4 py-2.5 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {requests.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5">{LEAVE_TYPE_LABELS[r.leave_type]}</td>
              <td className="px-4 py-2.5 text-slate-600">{r.start_date}</td>
              <td className="px-4 py-2.5 text-slate-600">{r.end_date}</td>
              <td className="px-4 py-2.5 font-medium">{r.days_count}</td>
              <td className="px-4 py-2.5">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', LEAVE_STATUS_BADGE[r.status])}>
                  {LEAVE_STATUS_LABELS[r.status]}
                </span>
              </td>
              <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
              <td className="px-4 py-2.5 text-right">
                {r.status === 'pending' && (
                  <button
                    onClick={() => {
                      if (confirm('Hủy đơn xin nghỉ này?')) cancelMut.mutate(r.id);
                    }}
                    disabled={cancelMut.isPending}
                    className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                  >
                    Hủy
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveCreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    leave_type: 'annual' as LeaveType,
    start_date: today,
    end_date: today,
    half_day_start: false,
    half_day_end: false,
    reason: '',
  });

  const mut = useMutation({
    mutationFn: () => leaveApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'leave'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">Xin nghỉ phép</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Loại nghỉ">
            <select
              value={form.leave_type}
              onChange={(e) => setForm({ ...form, leave_type: e.target.value as LeaveType })}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            >
              {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Đến ngày">
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={form.half_day_start} onChange={(e) => setForm({ ...form, half_day_start: e.target.checked })} />
              Nửa ngày đầu
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={form.half_day_end} onChange={(e) => setForm({ ...form, half_day_end: e.target.checked })} />
              Nửa ngày cuối
            </label>
          </div>
          <Field label="Lý do">
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="(không bắt buộc)"
            />
          </Field>
          {mut.isError && (
            <p className="text-sm text-rose-600">
              {(mut.error as Error)?.message ?? 'Có lỗi xảy ra'}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
            Hủy
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
          >
            {mut.isPending ? 'Đang gửi...' : 'Gửi đơn'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2 — ATTENDANCE
// ═══════════════════════════════════════════════════════════════

function AttendanceTab() {
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);

  const { data: workHoursRes } = useQuery({
    queryKey: ['hr', 'work-hours'],
    queryFn: () => attendanceApi.workHours(),
  });
  const workHours = workHoursRes?.data;

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['hr', 'attendance', 'list', user?.id],
    queryFn: () => attendanceApi.listIncidents({ user_id: user!.id, limit: 50 }),
    enabled: !!user?.id,
  });
  const incidents = listRes?.data.items ?? [];

  return (
    <div className="space-y-4">
      {workHours && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm text-blue-900">
          <CalendarDays className="w-4 h-4 inline-block mr-1.5 align-text-bottom" />
          Giờ làm chuẩn: <b>{workHours.work_start_time}</b> – <b>{workHours.work_end_time}</b>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-slate-800">Ghi nhận của tôi</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Báo cáo đi muộn / về sớm
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : incidents.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500">
          Chưa có ghi nhận nào.
        </div>
      ) : (
        <IncidentTable incidents={incidents} />
      )}

      {showCreate && workHours && (
        <IncidentCreateModal
          workHours={workHours}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function IncidentTable({ incidents }: { incidents: AttendanceIncident[] }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Ngày</th>
            <th className="px-4 py-2.5">Loại</th>
            <th className="px-4 py-2.5">Giờ chuẩn</th>
            <th className="px-4 py-2.5">Giờ thực tế</th>
            <th className="px-4 py-2.5">Lệch</th>
            <th className="px-4 py-2.5">Lý do</th>
            <th className="px-4 py-2.5">Ghi nhận</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {incidents.map((it) => (
            <tr key={it.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-600">{it.incident_date}</td>
              <td className="px-4 py-2.5">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', INCIDENT_TYPE_BADGE[it.incident_type])}>
                  {INCIDENT_TYPE_LABELS[it.incident_type]}
                </span>
              </td>
              <td className="px-4 py-2.5 text-slate-600">{it.expected_time?.slice(0, 5) ?? '—'}</td>
              <td className="px-4 py-2.5 text-slate-600">{it.actual_time?.slice(0, 5) ?? '—'}</td>
              <td className="px-4 py-2.5 font-medium">{formatMinutes(it.minutes_off)}</td>
              <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{it.reason ?? '—'}</td>
              <td className="px-4 py-2.5">
                {it.acknowledged_at ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Đã ghi nhận
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                    Chưa ghi nhận
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentCreateModal({
  workHours,
  onClose,
}: {
  workHours: { work_start_time: string; work_end_time: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<IncidentType>('late');
  const [date, setDate] = useState(today);
  const [actualTime, setActualTime] = useState('');
  const [reason, setReason] = useState('');

  const expectedTime = type === 'late' ? workHours.work_start_time : workHours.work_end_time;

  const mut = useMutation({
    mutationFn: () =>
      attendanceApi.createIncident({
        incident_date: date,
        incident_type: type,
        expected_time: type === 'no_show' ? undefined : expectedTime,
        actual_time: type === 'no_show' ? undefined : actualTime,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'attendance'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">Ghi nhận chuyên cần</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Loại sự cố">
            <div className="flex gap-2">
              {(['late', 'early_leave', 'no_show'] as IncidentType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-sm rounded-md border transition',
                    type === t
                      ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {INCIDENT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Ngày">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </Field>
          {type !== 'no_show' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Giờ chuẩn">
                <input
                  type="time"
                  value={expectedTime}
                  disabled
                  className="w-full border border-slate-200 bg-slate-50 rounded-md px-3 py-2 text-sm text-slate-600"
                />
              </Field>
              <Field label={type === 'late' ? 'Giờ thực tế đến' : 'Giờ thực tế về'}>
                <input
                  type="time"
                  value={actualTime}
                  onChange={(e) => setActualTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  required
                />
              </Field>
            </div>
          )}
          <Field label="Lý do">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="(không bắt buộc)"
            />
          </Field>
          {mut.isError && (
            <p className="text-sm text-rose-600">
              {(mut.error as Error)?.message ?? 'Có lỗi xảy ra'}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
            Hủy
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (type !== 'no_show' && !actualTime)}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
          >
            {mut.isPending ? 'Đang gửi...' : 'Gửi'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3 — PENDING (manager / admin)
// ═══════════════════════════════════════════════════════════════

function PendingTab() {
  const qc = useQueryClient();

  const { data: leaveRes } = useQuery({
    queryKey: ['hr', 'leave', 'pending'],
    queryFn: () => leaveApi.list({ status: 'pending', limit: 100 }),
  });
  const pendingLeaves = leaveRes?.data.items ?? [];

  const { data: incidentRes } = useQuery({
    queryKey: ['hr', 'attendance', 'unacked'],
    queryFn: () => attendanceApi.listIncidents({ acknowledged: false, limit: 100 }),
  });
  const unacked = incidentRes?.data.items ?? [];

  const approveMut = useMutation({
    mutationFn: (id: number) => leaveApi.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      leaveApi.reject(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
  const ackMut = useMutation({
    mutationFn: (id: number) => attendanceApi.acknowledge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-2">
          Đơn xin nghỉ chờ duyệt ({pendingLeaves.length})
        </h2>
        {pendingLeaves.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-md px-4 py-3">
            Không có đơn nào đang chờ.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nhân viên</th>
                  <th className="px-4 py-2.5">Phòng</th>
                  <th className="px-4 py-2.5">Loại</th>
                  <th className="px-4 py-2.5">Khoảng ngày</th>
                  <th className="px-4 py-2.5">Số ngày</th>
                  <th className="px-4 py-2.5">Lý do</th>
                  <th className="px-4 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingLeaves.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{r.user_name ?? r.user_id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.department ?? '—'}</td>
                    <td className="px-4 py-2.5">{LEAVE_TYPE_LABELS[r.leave_type]}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.start_date} → {r.end_date}</td>
                    <td className="px-4 py-2.5">{r.days_count}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      <button
                        onClick={() => approveMut.mutate(r.id)}
                        disabled={approveMut.isPending}
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Duyệt
                      </button>
                      <button
                        onClick={() => {
                          const note = prompt('Lý do từ chối (tùy chọn):') || undefined;
                          rejectMut.mutate({ id: r.id, note });
                        }}
                        disabled={rejectMut.isPending}
                        className="inline-flex items-center gap-1 text-xs text-rose-700 hover:underline disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Từ chối
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-2">
          Ghi nhận chuyên cần chưa xem ({unacked.length})
        </h2>
        {unacked.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-md px-4 py-3">
            Không có ghi nhận chưa xử lý.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nhân viên</th>
                  <th className="px-4 py-2.5">Phòng</th>
                  <th className="px-4 py-2.5">Ngày</th>
                  <th className="px-4 py-2.5">Loại</th>
                  <th className="px-4 py-2.5">Lệch</th>
                  <th className="px-4 py-2.5">Lý do</th>
                  <th className="px-4 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unacked.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{it.user_name ?? it.user_id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{it.department ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{it.incident_date}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', INCIDENT_TYPE_BADGE[it.incident_type])}>
                        {INCIDENT_TYPE_LABELS[it.incident_type]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{formatMinutes(it.minutes_off)}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{it.reason ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => ackMut.mutate(it.id)}
                        disabled={ackMut.isPending}
                        className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Đã xem
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
