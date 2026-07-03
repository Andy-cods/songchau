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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  1: { label: 'Khẩn', className: 'bg-rose-100 text-rose-700' },
  2: { label: 'Cao', className: 'bg-amber-100 text-amber-700' },
  3: { label: 'Bình thường', className: 'bg-sky-100 text-sky-700' },
  4: { label: 'Thấp', className: 'bg-slate-100 text-slate-500' },
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: 'Chờ xử lý', className: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'Đang làm', className: 'bg-sky-100 text-sky-700' },
  completed: { label: 'Hoàn thành', className: 'bg-emerald-100 text-emerald-700' },
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

  const usersModalRaw = usersData?.items ?? (usersData as any)?.data?.items ?? (usersData as any)?.data ?? [];
  const users = Array.isArray(usersModalRaw) ? usersModalRaw : [];

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'priority' ? Number(value) : value }));
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 flex-row items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <DialogTitle className="text-base">Tạo công việc mới</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tiêu đề <span className="text-rose-500">*</span>
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
                <option value="">-- Chọn người --</option>
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
            <p className="text-sm text-rose-600">Tạo công việc thất bại. Vui lòng thử lại.</p>
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
            disabled={!form.title || !form.assigned_to || createMutation.isPending}
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
      </DialogContent>
    </Dialog>
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

  // Handle both {data:{items:[]}} and {items:[]} response shapes
  const tasksRaw = data?.data?.items ?? (data as any)?.items ?? (data as any)?.data ?? [];
  const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];
  const total = data?.data?.total ?? (data as any)?.total ?? 0;
  const usersRaw = usersData?.items ?? (usersData as any)?.data?.items ?? (usersData as any)?.data ?? [];
  const users = Array.isArray(usersRaw) ? usersRaw : [];

  const taskTypeLabel = (type: string) =>
    TASK_TYPES.find((t) => t.value === type)?.label ?? type;

  return (
    <div>
      {/* Header */}
      <PageHeader
        className="mb-6"
        icon={ListTodo}
        title="Quản lý công việc"
        subtitle={total > 0 ? `${total} công việc` : 'Phân công và theo dõi tiến độ'}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo công việc
          </button>
        }
      />

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
      <Card padded={false}>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            heading="Không có công việc nào"
            description='Nhấn "Tạo công việc" để thêm công việc mới'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tiêu đề</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Ưu tiên</TableHead>
                <TableHead>Người thực hiện</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Hạn</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {tasks.map((task) => {
                  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG[3];
                  const statusCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG['pending'];
                  const isOverdue =
                    task.due_date &&
                    task.status !== 'completed' &&
                    new Date(task.due_date) < new Date();

                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                              {task.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {taskTypeLabel(task.task_type)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityCfg.className}`}
                        >
                          {priorityCfg.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-sm text-slate-600">
                            {task.assigned_to_name ?? 'Chưa phân công'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.className}`}
                        >
                          {statusCfg.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {task.due_date ? (
                          <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-rose-600' : 'text-slate-500'}`}>
                            <Calendar className="h-3 w-3" />
                            {new Date(task.due_date).toLocaleDateString('vi-VN')}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.status === 'pending' && (
                          <button
                            onClick={() => startMutation.mutate(task.id)}
                            disabled={
                              startMutation.isPending && startMutation.variables === task.id
                            }
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-60 transition-colors"
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
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-60 transition-colors"
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
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Xong
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        )}
      </Card>

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
