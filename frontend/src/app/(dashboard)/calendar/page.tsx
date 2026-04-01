'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────

type EventType = 'meeting' | 'deadline' | 'holiday' | 'leave' | 'delivery';
type LeaveType = 'annual' | 'sick' | 'personal' | 'other';
type LeaveStatus = 'pending' | 'approved' | 'rejected';

interface CalendarEvent {
  id: string;
  title: string;
  event_type: EventType;
  start_time: string;
  end_time: string;
  all_day: boolean;
  color: string;
}

interface LeaveRequest {
  id: string;
  user_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days_count: number;
  status: LeaveStatus;
}

// ─── Constants ─────────────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<EventType, string> = {
  meeting: 'bg-blue-100 text-blue-700 border-blue-200',
  deadline: 'bg-red-100 text-red-700 border-red-200',
  holiday: 'bg-green-100 text-green-700 border-green-200',
  leave: 'bg-amber-100 text-amber-700 border-amber-200',
  delivery: 'bg-purple-100 text-purple-700 border-purple-200',
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  meeting: 'Họp',
  deadline: 'Hạn chót',
  holiday: 'Nghỉ lễ',
  leave: 'Nghỉ phép',
  delivery: 'Giao hàng',
};

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Nghỉ phép năm',
  sick: 'Nghỉ ốm',
  personal: 'Việc cá nhân',
  other: 'Khác',
};

const LEAVE_STATUS_CONFIG: Record<
  LeaveStatus,
  { label: string; class: string }
> = {
  pending: {
    label: 'Chờ duyệt',
    class: 'bg-amber-100 text-amber-700',
  },
  approved: {
    label: 'Đã duyệt',
    class: 'bg-emerald-100 text-emerald-700',
  },
  rejected: {
    label: 'Từ chối',
    class: 'bg-red-100 text-red-700',
  },
};

const DAYS_OF_WEEK = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// ─── Page ───────────────────────────────────────────────────────

export default function CalendarPage() {
  const queryClient = useQueryClient();

  // Calendar navigation
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed

  // Modals
  const [showEventModal, setShowEventModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Leave filter
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<LeaveStatus | 'all'>('all');

  // Event form state
  const [eventForm, setEventForm] = useState({
    title: '',
    event_type: 'meeting' as EventType,
    start_time: '',
    end_time: '',
    description: '',
  });

  // Leave form state
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'annual' as LeaveType,
    start_date: '',
    end_date: '',
    reason: '',
  });

  // Date range for current month
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const fromStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const toStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  // Fetch events
  const { data: eventsRaw, isLoading: eventsLoading } = useQuery<{
    data: CalendarEvent[];
  }>({
    queryKey: ['calendar', 'events', fromStr, toStr],
    queryFn: () => api.get(`/api/v1/calendar/events?from=${fromStr}&to=${toStr}`),
    retry: 1,
  });

  // Fetch leave requests
  const { data: leavesRaw, isLoading: leavesLoading } = useQuery<{
    data: LeaveRequest[];
  }>({
    queryKey: ['calendar', 'leaves', leaveStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (leaveStatusFilter !== 'all') params.set('status', leaveStatusFilter);
      return api.get(`/api/v1/calendar/leaves?${params}`);
    },
    retry: 1,
  });

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: (body: typeof eventForm) => api.post('/api/v1/calendar/events', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
      setShowEventModal(false);
      setEventForm({
        title: '',
        event_type: 'meeting',
        start_time: '',
        end_time: '',
        description: '',
      });
    },
  });

  // Create leave mutation
  const createLeaveMutation = useMutation({
    mutationFn: (body: typeof leaveForm) => api.post('/api/v1/calendar/leaves', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'leaves'] });
      setShowLeaveModal(false);
      setLeaveForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' });
    },
  });

  // Approve leave mutation
  const approveLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/calendar/leaves/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar', 'leaves'] }),
  });

  // Reject leave mutation
  const rejectLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/calendar/leaves/${id}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar', 'leaves'] }),
  });

  const events = eventsRaw?.data ?? [];
  const leaves = leavesRaw?.data ?? [];

  // Build calendar grid
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  // Group events by date
  const eventsByDate: Record<string, CalendarEvent[]> = {};
  events.forEach((ev) => {
    const dateStr = ev.start_time.split('T')[0];
    if (!eventsByDate[dateStr]) eventsByDate[dateStr] = [];
    eventsByDate[dateStr].push(ev);
  });

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('vi-VN', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <CalendarDays className="h-5 w-5 inline mr-2 text-brand-600" />
            Lịch & Nghỉ phép
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý sự kiện và đơn nghỉ phép
          </p>
        </div>
        <button
          onClick={() => setShowEventModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo sự kiện
        </button>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mb-6">
        {/* Month Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-slate-600" />
          </button>
          <h3 className="text-base font-semibold text-slate-800 capitalize">
            {monthLabel}
          </h3>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronRight className="h-5 w-5 text-slate-600" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {DAYS_OF_WEEK.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {eventsLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {Array.from({ length: totalCells }).map((_, idx) => {
              const dayNum = idx - startDow + 1;
              const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const dateStr = isCurrentMonth
                ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
                : '';
              const dayEvents = dateStr ? (eventsByDate[dateStr] ?? []) : [];
              const isToday =
                isCurrentMonth &&
                dayNum === today.getDate() &&
                viewMonth === today.getMonth() &&
                viewYear === today.getFullYear();

              return (
                <div
                  key={idx}
                  className={cn(
                    'min-h-[88px] p-1.5 border-b border-r border-slate-100 last:border-r-0',
                    !isCurrentMonth && 'bg-slate-50/50',
                    idx % 7 === 6 && 'border-r-0'
                  )}
                >
                  {isCurrentMonth && (
                    <>
                      <span
                        className={cn(
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium mb-1',
                          isToday
                            ? 'bg-brand-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        )}
                      >
                        {dayNum}
                      </span>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            title={ev.title}
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded truncate border',
                              EVENT_TYPE_COLORS[ev.event_type] ??
                                'bg-slate-100 text-slate-700 border-slate-200'
                            )}
                          >
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <p className="text-xs text-slate-400 pl-1">
                            +{dayEvents.length - 3} khác
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
          {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((type) => (
            <span
              key={type}
              className={cn(
                'text-xs px-2 py-0.5 rounded border font-medium',
                EVENT_TYPE_COLORS[type]
              )}
            >
              {EVENT_TYPE_LABELS[type]}
            </span>
          ))}
        </div>
      </div>

      {/* Leave Requests */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Đơn nghỉ phép</h3>
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setLeaveStatusFilter(s)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    leaveStatusFilter === s
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {s === 'all'
                    ? 'Tất cả'
                    : s === 'pending'
                    ? 'Chờ duyệt'
                    : s === 'approved'
                    ? 'Đã duyệt'
                    : 'Từ chối'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowLeaveModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Xin nghỉ phép
            </button>
          </div>
        </div>

        {leavesLoading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        ) : leaves.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <CalendarDays className="h-8 w-8 mb-2 text-slate-300" />
            <p className="text-sm">Không có đơn nghỉ phép</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Nhân viên
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Loại nghỉ
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Thời gian
                  </th>
                  <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Số ngày
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Trạng thái
                  </th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaves.map((leave) => {
                  const statusCfg = LEAVE_STATUS_CONFIG[leave.status];
                  const isProcessing =
                    approveLeaveMutation.isPending || rejectLeaveMutation.isPending;

                  return (
                    <tr key={leave.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">
                        {leave.user_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {LEAVE_TYPE_LABELS[leave.leave_type]}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {new Date(leave.start_date).toLocaleDateString('vi-VN')} →{' '}
                        {new Date(leave.end_date).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-semibold text-slate-700">
                        {leave.days_count}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded-full',
                            statusCfg.class
                          )}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {leave.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => approveLeaveMutation.mutate(leave.id)}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {approveLeaveMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle className="h-3 w-3" />
                              )}
                              Duyệt
                            </button>
                            <button
                              onClick={() => rejectLeaveMutation.mutate(leave.id)}
                              disabled={isProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {rejectLeaveMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              Từ chối
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Event Modal */}
      {showEventModal && (
        <Modal title="Tạo sự kiện" onClose={() => setShowEventModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createEventMutation.mutate(eventForm);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Tiêu đề <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                value={eventForm.title}
                onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Nhập tiêu đề sự kiện"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Loại sự kiện
              </label>
              <select
                value={eventForm.event_type}
                onChange={(e) =>
                  setEventForm((f) => ({
                    ...f,
                    event_type: e.target.value as EventType,
                  }))
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Bắt đầu <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="datetime-local"
                  value={eventForm.start_time}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, start_time: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Kết thúc <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="datetime-local"
                  value={eventForm.end_time}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, end_time: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Mô tả
              </label>
              <textarea
                rows={3}
                value={eventForm.description}
                onChange={(e) =>
                  setEventForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Mô tả chi tiết (tuỳ chọn)"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            {createEventMutation.isError && (
              <p className="text-sm text-red-600">Có lỗi xảy ra. Thử lại sau.</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEventModal(false)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={createEventMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {createEventMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Tạo sự kiện
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Leave Modal */}
      {showLeaveModal && (
        <Modal title="Xin nghỉ phép" onClose={() => setShowLeaveModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createLeaveMutation.mutate(leaveForm);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Loại nghỉ
              </label>
              <select
                value={leaveForm.leave_type}
                onChange={(e) =>
                  setLeaveForm((f) => ({
                    ...f,
                    leave_type: e.target.value as LeaveType,
                  }))
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
                  <option key={t} value={t}>
                    {LEAVE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Từ ngày <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) =>
                    setLeaveForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Đến ngày <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(e) =>
                    setLeaveForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Lý do <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={leaveForm.reason}
                onChange={(e) =>
                  setLeaveForm((f) => ({ ...f, reason: e.target.value }))
                }
                placeholder="Nhập lý do xin nghỉ"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            {createLeaveMutation.isError && (
              <p className="text-sm text-red-600">Có lỗi xảy ra. Thử lại sau.</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={createLeaveMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {createLeaveMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Gửi đơn
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Modal Helper ───────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
