/**
 * HR services — Leave + Attendance + Employee KPI (M40 + M41).
 *
 * Backend: app/api/v1/leave.py, attendance.py, employee_kpi.py
 */
import { api } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────

export type LeaveType = 'annual' | 'sick' | 'personal' | 'maternity' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type IncidentType = 'late' | 'early_leave' | 'no_show';

export interface LeaveRequest {
  id: number;
  user_id: string;
  user_name?: string;
  user_email?: string;
  department: string | null;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days_count: number;
  half_day_start: boolean;
  half_day_end: boolean;
  reason: string | null;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LeaveBalance {
  user_id: string;
  period_year: number;
  annual_total: number;
  annual_used: number;
  sick_total: number;
  sick_used: number;
  personal_total: number;
  personal_used: number;
  maternity_total: number;
  maternity_used: number;
  other_used: number;
  remaining: Record<'annual' | 'sick' | 'personal' | 'maternity', number>;
}

export interface AttendanceIncident {
  id: number;
  user_id: string;
  user_name?: string;
  department: string | null;
  incident_date: string;
  incident_type: IncidentType;
  expected_time: string | null;
  actual_time: string | null;
  minutes_off: number;
  reason: string | null;
  created_by: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface WorkHours {
  work_start_time: string;
  work_end_time: string;
  full_day_minutes: number;
}

export interface KpiRow {
  user_id: string;
  user_name?: string;
  user_email?: string;
  department: string | null;
  period: { year: number; month: number; is_final: boolean };
  revenue_vnd: number;
  orders_count: number;
  avg_order_value: number;
  new_customers: number;
  new_products: number;
  new_supplier_codes: number;
  quotes_sent: number;
  quotes_won: number;
  deals_closed: number;
  daily_reports_submitted: number;
  leave_days_taken: number;
  active_days: number;
  total_actions: number;
  workdays_present: number;
  late_count?: number;
  total_late_minutes?: number;
  computed_at?: string;
}

export interface KpiTrendPoint {
  year: number;
  month: number;
  is_final: boolean;
  revenue_vnd: number;
  orders_count: number;
  avg_order_value: number;
  new_customers: number;
  new_products: number;
  quotes_won: number;
  deals_closed: number;
  daily_reports_submitted: number;
  leave_days_taken: number;
  active_days: number;
  workdays_present: number;
}

export interface DepartmentKpi {
  department: string;
  period: { year: number; month: number };
  totals: {
    revenue_vnd: number;
    orders_count: number;
    new_customers: number;
    quotes_won: number;
    head_count: number;
  };
  items: Array<KpiRow & { is_final: boolean }>;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  user_name: string;
  user_email: string;
  department: string | null;
  metric_value: number;
  revenue_vnd: number;
  orders_count: number;
  new_customers: number;
  quotes_won: number;
  deals_closed: number;
  active_days: number;
}

export type LeaderboardMetric =
  | 'revenue'
  | 'orders'
  | 'customers'
  | 'products'
  | 'quotes_won'
  | 'deals_closed'
  | 'active_days';

// ─── Envelope helper ─────────────────────────────────────────────

interface Envelope<T> {
  data: T;
  message?: string;
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// ─── Leave ───────────────────────────────────────────────────────

export const leaveApi = {
  async create(payload: {
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    half_day_start?: boolean;
    half_day_end?: boolean;
    reason?: string;
  }) {
    return api.post<Envelope<{ id: number; days_count: number; status: LeaveStatus }>>(
      '/api/v1/leave',
      payload
    );
  },

  async list(params: {
    user_id?: string;
    department?: string;
    status?: LeaveStatus;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
  } = {}) {
    return api.get<Envelope<{ items: LeaveRequest[]; total: number; page: number; limit: number }>>(
      `/api/v1/leave${buildQuery(params)}`
    );
  },

  async get(id: number) {
    return api.get<Envelope<LeaveRequest>>(`/api/v1/leave/${id}`);
  },

  async patch(id: number, body: Partial<{
    start_date: string;
    end_date: string;
    half_day_start: boolean;
    half_day_end: boolean;
    leave_type: LeaveType;
    reason: string;
  }>) {
    return api.patch<Envelope<{ id: number; days_count: number }>>(`/api/v1/leave/${id}`, body);
  },

  async cancel(id: number) {
    return api.delete<Envelope<{ id: number; status: LeaveStatus }>>(`/api/v1/leave/${id}`);
  },

  async approve(id: number, decision_note?: string) {
    return api.post<Envelope<{ id: number; status: 'approved' }>>(
      `/api/v1/leave/${id}/approve`,
      { decision_note }
    );
  },

  async reject(id: number, decision_note?: string) {
    return api.post<Envelope<{ id: number; status: 'rejected' }>>(
      `/api/v1/leave/${id}/reject`,
      { decision_note }
    );
  },

  async balance(user_id: string, year?: number) {
    return api.get<Envelope<LeaveBalance>>(
      `/api/v1/leave/balance/${user_id}${buildQuery({ year })}`
    );
  },

  async myPolicy(user_id?: string) {
    return api.get<Envelope<{
      annual_days: number;
      sick_days: number;
      personal_days: number;
      maternity_days: number;
      carry_over_max_days: number;
    } | null>>(`/api/v1/leave/policy${buildQuery({ user_id })}`);
  },
};

// ─── Attendance ──────────────────────────────────────────────────

export const attendanceApi = {
  async workHours() {
    return api.get<Envelope<WorkHours>>('/api/v1/attendance/work-hours');
  },

  async createIncident(payload: {
    user_id?: string;
    incident_date: string;
    incident_type: IncidentType;
    expected_time?: string;
    actual_time?: string;
    reason?: string;
  }) {
    return api.post<Envelope<AttendanceIncident>>('/api/v1/attendance/incidents', payload);
  },

  async listIncidents(params: {
    user_id?: string;
    department?: string;
    incident_type?: IncidentType;
    date_from?: string;
    date_to?: string;
    acknowledged?: boolean;
    page?: number;
    limit?: number;
  } = {}) {
    return api.get<Envelope<{
      items: AttendanceIncident[];
      total: number;
      page: number;
      limit: number;
    }>>(`/api/v1/attendance/incidents${buildQuery(params)}`);
  },

  async getIncident(id: number) {
    return api.get<Envelope<AttendanceIncident>>(`/api/v1/attendance/incidents/${id}`);
  },

  async patchIncident(id: number, body: Partial<{
    expected_time: string;
    actual_time: string;
    reason: string;
  }>) {
    return api.patch<Envelope<{ id: number; minutes_off: number }>>(
      `/api/v1/attendance/incidents/${id}`,
      body
    );
  },

  async deleteIncident(id: number) {
    return api.delete<Envelope<{ id: number }>>(`/api/v1/attendance/incidents/${id}`);
  },

  async acknowledge(id: number) {
    return api.post<Envelope<{ id: number }>>(
      `/api/v1/attendance/incidents/${id}/acknowledge`
    );
  },
};

// ─── Employee KPI (M40) ──────────────────────────────────────────

export const kpiApi = {
  async monthly(params: { user_id?: string; year?: number; month?: number } = {}) {
    return api.get<Envelope<KpiRow>>(`/api/v1/employee-kpi/monthly${buildQuery(params)}`);
  },

  async department(department: string, params: { year?: number; month?: number } = {}) {
    return api.get<Envelope<DepartmentKpi>>(
      `/api/v1/employee-kpi/department/${encodeURIComponent(department)}${buildQuery(params)}`
    );
  },

  async leaderboard(params: {
    year?: number;
    month?: number;
    metric?: LeaderboardMetric;
    department?: string;
    limit?: number;
  } = {}) {
    return api.get<Envelope<{
      period: { year: number; month: number; is_current: boolean };
      metric: LeaderboardMetric;
      department: string | null;
      items: LeaderboardEntry[];
    }>>(`/api/v1/employee-kpi/leaderboard${buildQuery(params)}`);
  },

  async trend(user_id: string, months = 6) {
    return api.get<Envelope<{
      user_id: string;
      department: string | null;
      months: number;
      series: KpiTrendPoint[];
    }>>(`/api/v1/employee-kpi/user/${user_id}/trend${buildQuery({ months })}`);
  },

  async recompute(year: number, month: number) {
    return api.post<Envelope<{ deferred: boolean; year: number; month: number }>>(
      '/api/v1/employee-kpi/recompute',
      { year, month }
    );
  },
};

// ─── Constants for UI labels ─────────────────────────────────────

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Phép năm',
  sick: 'Nghỉ ốm',
  personal: 'Việc riêng',
  maternity: 'Nghỉ thai sản',
  other: 'Khác',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  cancelled: 'Đã hủy',
};

export const LEAVE_STATUS_BADGE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  approved: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  rejected: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  late: 'Đi muộn',
  early_leave: 'Về sớm',
  no_show: 'Vắng mặt',
};

export const INCIDENT_TYPE_BADGE: Record<IncidentType, string> = {
  late: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  early_leave: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
  no_show: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
};

export function formatVND(n: number | null | undefined): string {
  if (n == null) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatMinutes(m: number): string {
  if (!m) return '0 phút';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}'`;
  if (h) return `${h}h`;
  return `${r} phút`;
}
