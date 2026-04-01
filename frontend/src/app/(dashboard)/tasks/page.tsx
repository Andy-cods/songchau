'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ListTodo,
  Plus,
  Play,
  CheckCircle,
  Loader2,
  X,
  Calendar,
  User,
  Filter,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { formatRelativeTime } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  priority: 1 | 2 | 3 | 4;
  status: 'pending' | 'in_progress' | 'completed';
  assigned_to_name?: string;
  assigned_to?: string;
  due_date?: string;
  created_at: string;
}

interface TasksResponse {
  data: {
    items: TaskItem[];
    total: number;
  };
}

interface UserOption {
  id: string;
  full_name: string;
}

// ─── Config ─────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  number,
  { label: string; className: string }
> = {
  1: { label: 'Khẩn', className: 'bg-red-100 text-red-700' },
  2: { label: 'Cao', className: 'bg-orange-100 text-orange-700' },
  3: { label: 'Bình thường', className: 'bg-blue-100 text-blue-700' },
  4: { label: 'Thấp', className: 'bg-slate-100 text-slate-500' },
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: 'Chờ xử lý', className: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'Đang làm', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Hoàn thành', className: 'bg-green-100 text-green-700' },
};

const TASK_TYPES = [
  { value: 'rfq_processing', label: 'Xử lý RFQ' },
  { value: 'supplier_contact', label: 'Liên hệ NCC' },
  { value: 'quotation_review', label: 'Duyệt báo giá' },
  { value: 'delivery_tracking', label: 'Theo dõi giao hàng' },
  { value: 'payment_follow', label: 'Theo dõi thanh toán' },
  { value: 'general', label: 'Chung' },
];

// ─── Create Task Modal ───────────────────────────────────────────

function CreateTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    task_type: 'general',
    priority: 3,
    assigned_to: '',
    due_date: '',
  });

  const { data: usersData } = useQuery<{ items: UserOption[] }>({
    queryKey: ['users-list-tasks'],
    queryFn: () => api.get('/api/v1/users?page_size=100'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => api.post('/api/v1/task-assignments', payload),
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });

  const users = usersData?.items ?? [];

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'priority' ? Number(value) : value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-slate-900">Tạo công việc mới</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tiêu đề <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              type="text"
              value={form.title}
              onChange={handleChange}
              placeholder="Nhập tiêu đề công việc..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Mô tả chi tiết công việc..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Loại công việc</label>
              <select
                name="task_type"
                value={form.task_type}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Độ ưu tiên</label>
              <select
                name="priority"
                value={form.priority}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
              >
                <option value={1}>1 - Khẩn</option>
                <option value={2}>2 - Cao</option>
                <option value={3}>3 - Bình thường</option>
                <option value={4}>4 - Thấp</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giao cho</label>
              <select
                name="assigned_to"
                value={form.assigned_to}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Chưa phân công</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hạn hoàn thành</label>
              <input
                name="due_date"
                type="date"
                value={form.due_date}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
              />
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">Tạo công việc thất bại. Vui lòng thử lại.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.title || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Tạo công việc
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');

  const isManager =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'director';

  const { data: usersData } = useQuery<{ items: UserOption[] }>({
    queryKey: ['users-list-filter'],
    queryFn: () => api.get('/api/v1/users?page_size=100'),
    enabled: isManager,
    retry: false,
  });

  const { data, isLoading } = useQuery<TasksResponse>({
    queryKey: ['task-assignments', statusFilter, priorityFilter, assignedFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (assignedFilter) params.set('assigned_to', assignedFilter);
      return api.get(`/api/v1/task-assignments?${params}`);
    },
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/task-assignments/${id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-assignments'] }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/task-assignments/${id}/complete`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-assignments'] }),
  });

  const tasks = data?.data?.items ?? [];
  const total = data?.data?.total ?? 0;
  const users = usersData?.items ?? [];

  const taskTypeLabel = (type: string) =>
    TASK_TYPES.find((t) => t.value === type)?.label ?? type;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-brand-600" />
            Quản lý công việc
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {total > 0 ? `${total} công việc` : 'Phân công và theo dõi tiến độ'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo task
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-slate-400">
            <Filter className="h-4 w-4" />
            <span className="text-sm">Lọc:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="pending">Chờ xử lý</option>
            <option value="in_progress">Đang làm</option>
            <option value="completed">Hoàn thành</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="">Tất cả ưu tiên</option>
            <option value="1">Khẩn</option>
            <option value="2">Cao</option>
            <option value="3">Bình thường</option>
            <option value="4">Thấp</option>
          </select>
          {isManager && users.length > 0 && (
            <select
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="">Tất cả nhân viên</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          )}
          {(statusFilter || priorityFilter || assignedFilter) && (
            <button
              onClick={() => {
                setStatusFilter('');
                setPriorityFilter('');
                setAssignedFilter('');
              }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <X className="h-3 w-3" />
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ListTodo className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm font-medium">Không có công việc nào</p>
            <p className="text-xs mt-1">Nhấn "Tạo task" để thêm công việc mới</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tiêu đề</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Loại</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ưu tiên</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Người thực hiện</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Hạn</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => {
                  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG[3];
                  const statusCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG['pending'];
                  const isOverdue =
                    task.due_date &&
                    task.status !== 'completed' &&
                    new Date(task.due_date) < new Date();

                  return (
                    <tr key={task.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                              {task.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {taskTypeLabel(task.task_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityCfg.className}`}
                        >
                          {priorityCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-sm text-slate-600">
                            {task.assigned_to_name ?? 'Chưa phân công'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.className}`}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {task.due_date ? (
                          <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                            <Calendar className="h-3 w-3" />
                            {new Date(task.due_date).toLocaleDateString('vi-VN')}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {task.status === 'pending' && (
                          <button
                            onClick={() => startMutation.mutate(task.id)}
                            disabled={
                              startMutation.isPending && startMutation.variables === task.id
                            }
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60 transition-colors"
                          >
                            {startMutation.isPending && startMutation.variables === task.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Bắt đầu
                          </button>
                        )}
                        {task.status === 'in_progress' && (
                          <button
                            onClick={() => completeMutation.mutate(task.id)}
                            disabled={
                              completeMutation.isPending && completeMutation.variables === task.id
                            }
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-60 transition-colors"
                          >
                            {completeMutation.isPending &&
                            completeMutation.variables === task.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3 w-3" />
                            )}
                            Hoàn thành
                          </button>
                        )}
                        {task.status === 'completed' && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Xong
                          </span>
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

      {/* Create Modal */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['task-assignments'] });
          }}
        />
      )}
    </div>
  );
}
