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
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
      <PageHeader
        icon={CalendarOff}
        title="Nhân sự"
        subtitle="Quản lý đơn xin nghỉ phép, ghi nhận đi muộn / về sớm."
      />

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
          ? 'border-brand-600 text-brand-700'
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-md font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Xin nghỉ phép
        </button>
      </div>

      {isLoading ? (
        <Card padded={false}>
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : requests.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={CalendarOff} heading="Bạn chưa có đơn xin nghỉ nào." />
        </Card>
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
              className="h-full bg-brand-500"
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
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const cancelMut = useMutation({
    mutationFn: (id: number) => leaveApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
    onSettled: () => setConfirmId(null),
  });

  return (
    <Card padded={false} className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loại</TableHead>
            <TableHead>Từ ngày</TableHead>
            <TableHead>Đến ngày</TableHead>
            <TableHead>Số ngày</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Lý do</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{LEAVE_TYPE_LABELS[r.leave_type]}</TableCell>
              <TableCell className="text-slate-600">{r.start_date}</TableCell>
              <TableCell className="text-slate-600">{r.end_date}</TableCell>
              <TableCell className="font-medium">{r.days_count}</TableCell>
              <TableCell>
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', LEAVE_STATUS_BADGE[r.status])}>
                  {LEAVE_STATUS_LABELS[r.status]}
                </span>
              </TableCell>
              <TableCell className="text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</TableCell>
              <TableCell className="text-right">
                {r.status === 'pending' && (
                  <button
                    onClick={() => setConfirmId(r.id)}
                    disabled={cancelMut.isPending}
                    className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                  >
                    Hủy
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(o) => { if (!o) setConfirmId(null); }}
        title="Hủy đơn xin nghỉ"
        description="Hủy đơn xin nghỉ này?"
        confirmLabel="Hủy đơn"
        cancelLabel="Đóng"
        destructive
        loading={cancelMut.isPending}
        onConfirm={() => { if (confirmId !== null) cancelMut.mutate(confirmId); }}
      />
    </Card>
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="flex-row items-center justify-between border-b border-slate-200 px-5 py-3">
          <DialogTitle>Xin nghỉ phép</DialogTitle>
        </DialogHeader>
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
        <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
            Hủy
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-3 py-1.5 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded-md disabled:opacity-50"
          >
            {mut.isPending ? 'Đang gửi...' : 'Gửi đơn'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-2.5 text-sm text-sky-900">
          <CalendarDays className="w-4 h-4 inline-block mr-1.5 align-text-bottom" />
          Giờ làm chuẩn: <b>{workHours.work_start_time}</b> – <b>{workHours.work_end_time}</b>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-slate-800">Ghi nhận của tôi</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-md font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Báo cáo đi muộn / về sớm
        </button>
      </div>

      {isLoading ? (
        <Card padded={false}>
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : incidents.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Clock} heading="Chưa có ghi nhận nào." />
        </Card>
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
    <Card padded={false} className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ngày</TableHead>
            <TableHead>Loại</TableHead>
            <TableHead>Giờ chuẩn</TableHead>
            <TableHead>Giờ thực tế</TableHead>
            <TableHead>Lệch</TableHead>
            <TableHead>Lý do</TableHead>
            <TableHead>Ghi nhận</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="text-slate-600">{it.incident_date}</TableCell>
              <TableCell>
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', INCIDENT_TYPE_BADGE[it.incident_type])}>
                  {INCIDENT_TYPE_LABELS[it.incident_type]}
                </span>
              </TableCell>
              <TableCell className="text-slate-600">{it.expected_time?.slice(0, 5) ?? '—'}</TableCell>
              <TableCell className="text-slate-600">{it.actual_time?.slice(0, 5) ?? '—'}</TableCell>
              <TableCell className="font-medium">{formatMinutes(it.minutes_off)}</TableCell>
              <TableCell className="text-slate-500 max-w-xs truncate">{it.reason ?? '—'}</TableCell>
              <TableCell>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="flex-row items-center justify-between border-b border-slate-200 px-5 py-3">
          <DialogTitle>Ghi nhận chuyên cần</DialogTitle>
        </DialogHeader>
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
                      ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
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
        <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
            Hủy
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (type !== 'no_show' && !actualTime)}
            className="px-3 py-1.5 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded-md disabled:opacity-50"
          >
            {mut.isPending ? 'Đang gửi...' : 'Gửi'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const approveMut = useMutation({
    mutationFn: (id: number) => leaveApi.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      leaveApi.reject(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
    onSettled: () => {
      setRejectTarget(null);
      setRejectNote('');
    },
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
          <Card padded={false} className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nhân viên</TableHead>
                  <TableHead>Phòng</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Khoảng ngày</TableHead>
                  <TableHead>Số ngày</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingLeaves.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.user_name ?? r.user_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-slate-600">{r.department ?? '—'}</TableCell>
                    <TableCell>{LEAVE_TYPE_LABELS[r.leave_type]}</TableCell>
                    <TableCell className="text-slate-600">{r.start_date} → {r.end_date}</TableCell>
                    <TableCell>{r.days_count}</TableCell>
                    <TableCell className="text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</TableCell>
                    <TableCell className="text-right space-x-2">
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
                          setRejectNote('');
                          setRejectTarget(r.id);
                        }}
                        disabled={rejectMut.isPending}
                        className="inline-flex items-center gap-1 text-xs text-rose-700 hover:underline disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Từ chối
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* Reject reason dialog (replaces native prompt) */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectNote('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Từ chối đơn xin nghỉ</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700">
              Lý do từ chối (tùy chọn)
            </label>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              autoFocus
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="(không bắt buộc)"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectNote('');
              }}
              disabled={rejectMut.isPending}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              loading={rejectMut.isPending}
              onClick={() => {
                if (rejectTarget !== null) {
                  rejectMut.mutate({
                    id: rejectTarget,
                    note: rejectNote.trim() || undefined,
                  });
                }
              }}
            >
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-2">
          Ghi nhận chuyên cần chưa xem ({unacked.length})
        </h2>
        {unacked.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-md px-4 py-3">
            Không có ghi nhận chưa xử lý.
          </div>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nhân viên</TableHead>
                  <TableHead>Phòng</TableHead>
                  <TableHead>Ngày</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Lệch</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unacked.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.user_name ?? it.user_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-slate-600">{it.department ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{it.incident_date}</TableCell>
                    <TableCell>
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', INCIDENT_TYPE_BADGE[it.incident_type])}>
                        {INCIDENT_TYPE_LABELS[it.incident_type]}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{formatMinutes(it.minutes_off)}</TableCell>
                    <TableCell className="text-slate-500 max-w-xs truncate">{it.reason ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => ackMut.mutate(it.id)}
                        disabled={ackMut.isPending}
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Đã xem
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}
