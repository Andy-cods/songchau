'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Calendar,
  Plus,
  Play,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface Schedule {
  id: number;
  report_type: string;
  report_name: string;
  schedule_cron: string;
  recipients: string[];
  email_subject: string;
  is_active: boolean;
  last_run_at: string | null;
  execution_count: number;
  last_status: string | null;
  created_by_name: string;
  created_at: string;
}

const REPORT_TYPES: Record<string, { label: string; cls: string }> = {
  daily_kpi: { label: 'KPI Hàng ngày', cls: 'bg-blue-100 text-blue-700' },
  weekly_summary: { label: 'Tổng hợp tuần', cls: 'bg-green-100 text-green-700' },
  monthly_revenue: { label: 'Doanh thu tháng', cls: 'bg-purple-100 text-purple-700' },
  custom: { label: 'Tùy chỉnh', cls: 'bg-slate-100 text-slate-700' },
};

const CRON_PRESETS = [
  { label: 'Hàng ngày 7h', value: '0 7 * * *' },
  { label: 'Thứ Hai hàng tuần', value: '0 7 * * 1' },
  { label: 'Ngày 1 hàng tháng', value: '0 7 1 * *' },
  { label: 'Thứ 6 hàng tuần', value: '0 17 * * 5' },
];

export default function ScheduledReportsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery<{ data: Schedule[] }>({
    queryKey: ['scheduled-reports'],
    queryFn: () => api.get('/api/v1/scheduled-reports'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/api/v1/scheduled-reports', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] });
      setShowCreate(false);
    },
  });

  const triggerMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/scheduled-reports/${id}/trigger`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/scheduled-reports/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.put(`/api/v1/scheduled-reports/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] }),
  });

  const schedules = data?.data ?? [];

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      report_type: form.get('report_type'),
      report_name: form.get('report_name'),
      schedule_cron: form.get('schedule_cron'),
      recipients: [],
      email_subject: form.get('email_subject') || undefined,
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <Calendar className="h-5 w-5 inline mr-2 text-brand-600" />
            Báo Cáo Tự Động
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Lên lịch báo cáo hàng ngày/tuần/tháng, gửi email tự động</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />Tạo lịch mới
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Tạo lịch báo cáo mới</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tên báo cáo</label>
                <input name="report_name" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="VD: KPI Hàng Ngày" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Loại báo cáo</label>
                <select name="report_type" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  <option value="daily_kpi">KPI Hàng ngày</option>
                  <option value="weekly_summary">Tổng hợp tuần</option>
                  <option value="monthly_revenue">Doanh thu tháng</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Lịch chạy (Cron)</label>
                <select name="schedule_cron" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {CRON_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tiêu đề email</label>
                <input name="email_subject" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="[Song Châu ERP] ..." />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={createMutation.isPending} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {createMutation.isPending ? <><Loader2 className="h-4 w-4 inline animate-spin mr-1" />Đang tạo...</> : 'Tạo lịch'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Hủy</button>
            </div>
          </form>
        </div>
      )}

      {/* Schedules List */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Đang tải...</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Calendar className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            Chưa có lịch báo cáo nào
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {schedules.map((s) => {
              const type = REPORT_TYPES[s.report_type] || REPORT_TYPES.custom;
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-4 flex-1">
                    <button
                      onClick={() => toggleMutation.mutate({ id: s.id, is_active: !s.is_active })}
                      className="text-slate-400 hover:text-brand-600"
                    >
                      {s.is_active ? <ToggleRight className="h-6 w-6 text-green-600" /> : <ToggleLeft className="h-6 w-6" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${s.is_active ? 'text-slate-800' : 'text-slate-400'}`}>{s.report_name}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${type.cls}`}>{type.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span><Clock className="h-3 w-3 inline mr-1" />{s.schedule_cron}</span>
                        <span>Đã chạy: {s.execution_count}</span>
                        {s.last_run_at && (
                          <span>Lần cuối: {new Date(s.last_run_at).toLocaleDateString('vi-VN')}</span>
                        )}
                        {s.last_status && (
                          <span className="flex items-center gap-1">
                            {s.last_status === 'completed'
                              ? <CheckCircle className="h-3 w-3 text-green-500" />
                              : <XCircle className="h-3 w-3 text-red-500" />}
                            {s.last_status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => triggerMutation.mutate(s.id)}
                      disabled={triggerMutation.isPending}
                      className="p-2 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"
                      title="Chạy ngay"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm('Xóa lịch báo cáo này?')) deleteMutation.mutate(s.id); }}
                      className="p-2 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"
                      title="Xóa"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
