'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────

interface CustomerDetail {
  id: number;
  company_name: string;
  short_name?: string;
  customer_code?: string;
  tax_code?: string;
  address?: string;
  phone?: string;
  email?: string;
  business_system?: string;
  total_orders: number;
  total_revenue: number;
  last_order_date?: string;
  contacts?: ContactItem[];
  interactions?: InteractionItem[];
  ar_summary?: {
    outstanding: number;
    overdue_count: number;
  };
}

interface ExternalMapItem {
  id: number;
  customer_id: number;
  source_system: string;
  match_field: string;
  match_value: string;
  is_primary: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

interface ExternalMapForm {
  source_system: string;
  match_field: string;
  match_value: string;
  notes: string;
  is_primary: boolean;
}

interface ContactItem {
  id: number;
  full_name: string;
  position?: string;
  department?: string;
  email?: string;
  phone?: string;
  last_contacted?: string;
}

interface InteractionItem {
  id: number;
  interaction_type: string;
  subject: string;
  notes?: string;
  created_at: string;
}

interface TimelineEvent {
  type: string;
  date: string;
  title: string;
  details?: string;
}

interface POItem {
  id: number;
  po_number: string;
  bqms_code?: string;
  spec?: string;
  po_date?: string;
  amount?: number;
  status?: string;
}

interface DeliveryItem {
  id: number;
  po_number: string;
  bqms_code?: string;
  delivery_date?: string;
  quantity?: number | string;
  status?: string;
}

interface FinancialData {
  ar_aging: {
    current_amount: number;
    days_1_30: number;
    days_31_60: number;
    days_over_60: number;
    total_outstanding: number;
  };
  recent_payments: PaymentItem[];
  revenue: {
    total_revenue: number;
    revenue_this_month: number;
    total_pos: number;
  };
}

interface PaymentItem {
  id: number;
  payment_date?: string;
  amount: number;
  reference?: string;
  notes?: string;
}

interface QuoteStats {
  total_rfqs: number;
  won: number;
  lost: number;
  pending: number;
  win_rate: number;
}

interface RFQItem {
  id: number;
  rfq_number: string;
  bqms_code?: string;
  spec?: string;
  maker?: string;
  result?: string;
  inquiry_date?: string;
}

interface AddContactForm {
  full_name: string;
  position: string;
  email: string;
  phone: string;
}

interface AddInteractionForm {
  interaction_type: string;
  subject: string;
  notes: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function lastContactedColor(dateStr?: string): string {
  if (!dateStr) return 'text-slate-400';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
  if (diff < 7) return 'text-emerald-600';
  if (diff < 30) return 'text-amber-600';
  return 'text-red-600';
}

function lastContactedLabel(dateStr?: string): string {
  if (!dateStr) return 'Chưa liên hệ';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return `${diff} ngày trước`;
}

const INTERACTION_TYPES = [
  { value: 'call', label: 'Gọi điện' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Gặp mặt' },
  { value: 'demo', label: 'Demo sản phẩm' },
  { value: 'support', label: 'Hỗ trợ kỹ thuật' },
  { value: 'other', label: 'Khác' },
];

const INTERACTION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  INTERACTION_TYPES.map((t) => [t.value, t.label])
);

const EXTERNAL_MAP_PRESETS = [
  {
    source_system: 'bqms_samsung_po',
    match_field: 'company',
    label: 'BQMS PO / Company',
    hint: 'Dùng để nối doanh thu và PO Samsung.',
  },
  {
    source_system: 'bqms_deliveries',
    match_field: 'sev_type',
    label: 'BQMS Deliveries / Sev Type',
    hint: 'Dùng để nối giao hàng.',
  },
  {
    source_system: 'bqms_orders',
    match_field: 'customer_name',
    label: 'BQMS Orders / Customer Name',
    hint: 'Dùng để nối RFQ và đơn hàng BQMS.',
  },
] as const;

const EXTERNAL_MAP_LABELS: Record<string, string> = Object.fromEntries(
  EXTERNAL_MAP_PRESETS.map((item) => [
    `${item.source_system}:${item.match_field}`,
    item.label,
  ])
);

function resultBadge(result?: string) {
  if (!result) return <span className="text-xs text-slate-400">—</span>;
  const map: Record<string, string> = {
    won: 'bg-emerald-100 text-emerald-700',
    lost: 'bg-red-100 text-red-600',
    pending: 'bg-amber-100 text-amber-700',
  };
  const labelMap: Record<string, string> = {
    won: 'Trúng',
    lost: 'Thua',
    pending: 'Chờ',
  };
  const cls = map[result] ?? 'bg-slate-100 text-slate-500';
  const label = labelMap[result] ?? result;
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', cls)}>
      {label}
    </span>
  );
}

function statusBadge(status?: string) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const map: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    delivered: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-600',
    processing: 'bg-blue-100 text-blue-700',
  };
  const labelMap: Record<string, string> = {
    completed: 'Hoàn thành',
    delivered: 'Đã giao',
    pending: 'Chờ',
    cancelled: 'Hủy',
    processing: 'Đang xử lý',
  };
  const cls = map[status] ?? 'bg-slate-100 text-slate-500';
  const label = labelMap[status] ?? status;
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', cls)}>
      {label}
    </span>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function SkeletonRow({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className={cn(
                'h-4 bg-slate-200 rounded animate-pulse',
                j === 0 ? 'w-40' : j === cols - 1 ? 'ml-auto w-20' : 'w-28'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonKpi() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
          <div className="h-3 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p
        className={cn(
          'text-2xl font-bold font-mono',
          highlight ? 'text-brand-700' : warn ? 'text-red-600' : 'text-slate-900'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────

function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
      <span className="text-xs text-slate-400">
        Trang {page}/{totalPages} — {total} bản ghi
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Trước
        </button>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Tiếp
        </button>
      </div>
    </div>
  );
}

// ─── Modal: Thêm liên hệ ─────────────────────────────────────────

function AddContactModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddContactForm>({
    full_name: '',
    position: '',
    email: '',
    phone: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: AddContactForm & { customer_id: string }) =>
      api.post('/api/v1/crm/contacts', payload),
    onSuccess: () => {
      toast.success('Thêm liên hệ thành công');
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      onClose();
    },
    onError: () => toast.error('Không thể thêm liên hệ'),
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    mutation.mutate({ ...form, customer_id: customerId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Thêm người liên hệ</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Họ tên <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="full_name"
              value={form.full_name}
              onChange={handleChange}
              required
              placeholder="Nguyễn Văn A"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Chức vụ</label>
            <input
              type="text"
              name="position"
              value={form.position}
              onChange={handleChange}
              placeholder="Giám đốc mua hàng"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="email@company.com"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Điện thoại</label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="0901234567"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              Có lỗi xảy ra. Vui lòng thử lại.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? 'Đang lưu...' : 'Thêm liên hệ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Ghi nhận tương tác ───────────────────────────────────

function AddInteractionModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddInteractionForm>({
    interaction_type: 'call',
    subject: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: AddInteractionForm & { customer_id: string }) =>
      api.post('/api/v1/crm/interactions', payload),
    onSuccess: () => {
      toast.success('Đã ghi nhận tương tác');
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-timeline', customerId] });
      onClose();
    },
    onError: () => toast.error('Không thể ghi nhận tương tác'),
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim()) return;
    mutation.mutate({ ...form, customer_id: customerId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Ghi nhận tương tác</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Loại tương tác <span className="text-red-500">*</span>
            </label>
            <select
              name="interaction_type"
              value={form.interaction_type}
              onChange={handleChange}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              {INTERACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Chủ đề <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              required
              placeholder="Thảo luận về đơn hàng..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Nội dung chi tiết..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              Có lỗi xảy ra. Vui lòng thử lại.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? 'Đang lưu...' : 'Ghi nhận'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab 1: Tổng quan ────────────────────────────────────────────

function ExternalMapsCard({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExternalMapForm>({
    source_system: EXTERNAL_MAP_PRESETS[0].source_system,
    match_field: EXTERNAL_MAP_PRESETS[0].match_field,
    match_value: '',
    notes: '',
    is_primary: true,
  });

  const { data, isLoading } = useQuery<{ data: { mappings: ExternalMapItem[] } }>({
    queryKey: ['crm-external-maps', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/external-maps`),
    retry: 1,
  });

  const invalidateDependentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['crm-external-maps', customerId] });
    queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
    queryClient.invalidateQueries({ queryKey: ['crm-orders', customerId] });
    queryClient.invalidateQueries({ queryKey: ['crm-financials', customerId] });
    queryClient.invalidateQueries({ queryKey: ['crm-quotes', customerId] });
    queryClient.invalidateQueries({ queryKey: ['crm-board'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: ExternalMapForm) =>
      api.post(`/api/v1/crm/customers/${customerId}/external-maps`, payload),
    onSuccess: () => {
      toast.success('Đã lưu mapping');
      setForm((prev) => ({ ...prev, match_value: '', notes: '' }));
      setShowForm(false);
      invalidateDependentQueries();
    },
    onError: () => toast.error('Không thể lưu mapping'),
  });

  const deleteMutation = useMutation({
    mutationFn: (mappingId: number) =>
      api.delete(`/api/v1/crm/customers/${customerId}/external-maps/${mappingId}`),
    onSuccess: () => {
      toast.success('Đã xóa mapping');
      invalidateDependentQueries();
    },
    onError: () => toast.error('Không thể xóa mapping'),
  });

  const mappings = data?.data?.mappings ?? [];

  const handlePresetChange = (value: string) => {
    const selected = EXTERNAL_MAP_PRESETS.find(
      (item) => `${item.source_system}:${item.match_field}` === value
    );
    if (!selected) return;
    setForm((prev) => ({
      ...prev,
      source_system: selected.source_system,
      match_field: selected.match_field,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.match_value.trim()) return;
    const normalizedValue = form.match_value.trim().replace(/\s+/g, ' ');
    createMutation.mutate({
      ...form,
      match_value: normalizedValue,
      notes: form.notes.trim().replace(/\s+/g, ' '),
    });
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Liên kết dữ liệu</h3>
          <p className="text-xs text-slate-400 mt-1">
            Mapping dùng để nối khách hàng này với PO, giao hàng và RFQ thực tế.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          {showForm ? 'Đóng' : 'Thêm mapping'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nguồn dữ liệu</label>
              <select
                value={`${form.source_system}:${form.match_field}`}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                {EXTERNAL_MAP_PRESETS.map((item) => (
                  <option
                    key={`${item.source_system}:${item.match_field}`}
                    value={`${item.source_system}:${item.match_field}`}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {EXTERNAL_MAP_PRESETS.find(
                  (item) =>
                    item.source_system === form.source_system &&
                    item.match_field === form.match_field
                )?.hint ?? 'Chọn đúng nguồn để tránh nối nhầm dữ liệu.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Giá trị match</label>
              <input
                type="text"
                value={form.match_value}
                onChange={(e) => setForm((prev) => ({ ...prev, match_value: e.target.value }))}
                placeholder="Ví dụ: Canon VN"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Ví dụ: Alias PO Samsung đang dùng"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
              <input
                type="checkbox"
                checked={form.is_primary}
                onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-300"
              />
              Đặt làm chính
            </label>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
            Chỉ thêm mapping đã được xác nhận từ dữ liệu thật. Mapping sai sẽ làm lệch PO, giao hàng và RFQ của khách hàng này.
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !form.match_value.trim()}
              className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'Đang lưu...' : 'Lưu mapping'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <SkeletonRow rows={3} cols={4} />
      ) : mappings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <p className="text-sm text-slate-400">Chưa có mapping nào cho khách hàng này</p>
        </div>
      ) : (
        <div className="space-y-2">
          {mappings.map((mapping) => {
            const label =
              EXTERNAL_MAP_LABELS[`${mapping.source_system}:${mapping.match_field}`] ??
              `${mapping.source_system} / ${mapping.match_field}`;
            return (
              <div
                key={mapping.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">{label}</p>
                    {mapping.is_primary && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-medium">
                        Chính
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-mono text-brand-700 mt-1 break-all">{mapping.match_value}</p>
                  {mapping.notes && <p className="text-xs text-slate-500 mt-1">{mapping.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Xóa mapping "${mapping.match_value}"?`)) return;
                    deleteMutation.mutate(mapping.id);
                  }}
                  disabled={deleteMutation.isPending}
                  className="px-2.5 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Xóa
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabTongQuan({
  customer,
  customerId,
}: {
  customer: CustomerDetail;
  customerId: string;
}) {
  const { data: timelineData, isLoading: timelineLoading } = useQuery<{
    data: { events: TimelineEvent[] };
  }>({
    queryKey: ['crm-timeline', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/timeline?limit=10`),
    retry: 1,
  });

  const events = (timelineData?.data?.events ?? []).slice(0, 5);
  const interactions = (customer.interactions ?? []).slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick info */}
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Thông tin nhanh</h3>
          <dl className="space-y-3">
            {customer.address && (
              <div className="flex gap-3">
                <dt className="text-xs text-slate-400 w-24 flex-shrink-0 pt-0.5">Địa chỉ</dt>
                <dd className="text-sm text-slate-700">{customer.address}</dd>
              </div>
            )}
            {customer.phone && (
              <div className="flex gap-3">
                <dt className="text-xs text-slate-400 w-24 flex-shrink-0">Điện thoại</dt>
                <dd className="text-sm text-slate-700">
                  <a href={`tel:${customer.phone}`} className="text-brand-600 hover:underline">
                    {customer.phone}
                  </a>
                </dd>
              </div>
            )}
            {customer.email && (
              <div className="flex gap-3">
                <dt className="text-xs text-slate-400 w-24 flex-shrink-0">Email</dt>
                <dd className="text-sm text-slate-700">
                  <a href={`mailto:${customer.email}`} className="text-brand-600 hover:underline">
                    {customer.email}
                  </a>
                </dd>
              </div>
            )}
            {customer.business_system && (
              <div className="flex gap-3">
                <dt className="text-xs text-slate-400 w-24 flex-shrink-0">Hệ thống</dt>
                <dd className="text-sm text-slate-700">{customer.business_system}</dd>
              </div>
            )}
            {customer.last_order_date && (
              <div className="flex gap-3">
                <dt className="text-xs text-slate-400 w-24 flex-shrink-0">Đơn gần nhất</dt>
                <dd className="text-sm text-slate-700">{formatDate(customer.last_order_date)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Recent interactions */}
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Tương tác gần đây</h3>
          {interactions.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Chưa có tương tác nào</p>
          ) : (
            <div className="space-y-3">
              {interactions.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.subject}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">
                        {INTERACTION_TYPE_LABEL[item.interaction_type] ?? item.interaction_type}
                      </span>
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    {item.notes && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ExternalMapsCard customerId={customerId} />

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Hoạt động gần đây (5 sự kiện)
        </h3>
        {timelineLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-2 w-2 rounded-full bg-slate-200 mt-2 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-56 bg-slate-200 rounded" />
                  <div className="h-3 w-32 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">Chưa có hoạt động nào</p>
        ) : (
          <div className="space-y-0">
            {events.map((event, idx) => (
              <div key={idx} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="h-2 w-2 rounded-full bg-brand-500 mt-2 flex-shrink-0" />
                  {idx < events.length - 1 && (
                    <div className="w-px flex-1 bg-slate-200 mt-1 mb-0 min-h-[16px]" />
                  )}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-800">{event.title}</p>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {formatDate(event.date)}
                    </span>
                  </div>
                  {event.details && (
                    <p className="text-xs text-slate-500 mt-0.5">{event.details}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Đơn hàng ─────────────────────────────────────────────

function TabDonHang({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const limit = 5;

  const { data, isLoading } = useQuery<{
    data: {
      pos: POItem[];
      total_pos: number;
      deliveries: DeliveryItem[];
      total_deliveries: number;
    };
  }>({
    queryKey: ['crm-orders', customerId, page],
    queryFn: () =>
      api.get(`/api/v1/crm/customers/${customerId}/orders?page=${page}&limit=${limit}`),
    retry: 1,
  });

  const pos = data?.data?.pos ?? [];
  const totalPos = data?.data?.total_pos ?? 0;
  const deliveries = data?.data?.deliveries ?? [];
  const totalDeliveries = data?.data?.total_deliveries ?? 0;

  return (
    <div className="space-y-6">
      {/* PO Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">PO Samsung</h3>
          <span className="text-xs text-slate-400">{totalPos} đơn hàng</span>
        </div>

        {isLoading ? (
          <SkeletonRow rows={5} cols={5} />
        ) : pos.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Chưa có đơn hàng nào</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/60">
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Số PO
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Mã BQMS
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Thông số
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Ngày PO
                    </th>
                    <th className="text-right text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Giá trị
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Trạng thái
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pos.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-mono text-slate-800 whitespace-nowrap">
                        {po.po_number}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono text-slate-500 whitespace-nowrap">
                        {po.bqms_code ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 max-w-[200px] truncate">
                        {po.spec ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-500 whitespace-nowrap">
                        {formatDate(po.po_date)}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono font-medium text-emerald-700 text-right whitespace-nowrap">
                        {fmtVnd(po.amount ?? 0)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{statusBadge(po.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={totalPos}
              limit={limit}
              onChange={(p) => setPage(p)}
            />
          </>
        )}
      </div>

      {/* Deliveries Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Giao hàng</h3>
          <span className="text-xs text-slate-400">{totalDeliveries} lô hàng</span>
        </div>

        {isLoading ? (
          <SkeletonRow rows={5} cols={4} />
        ) : deliveries.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Chưa có dữ liệu giao hàng</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/60">
                  <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                    Số PO
                  </th>
                  <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                    Mã BQMS
                  </th>
                  <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                    Ngày giao
                  </th>
                  <th className="text-right text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                    Số lượng
                  </th>
                  <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-mono text-slate-800 whitespace-nowrap">
                      {d.po_number}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-mono text-slate-500 whitespace-nowrap">
                      {d.bqms_code ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-500 whitespace-nowrap">
                      {formatDate(d.delivery_date)}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-mono text-slate-700 text-right whitespace-nowrap">
                      {d.quantity ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{statusBadge(d.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 3: Tài chính ─────────────────────────────────────────────

function TabTaiChinh({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery<{ data: FinancialData }>({
    queryKey: ['crm-financials', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/financials`),
    retry: 1,
  });

  const fin = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonKpi />
        <SkeletonRow rows={5} cols={3} />
      </div>
    );
  }

  if (!fin) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">Không tải được dữ liệu tài chính</div>
    );
  }

  const aging = fin.ar_aging;
  const totalAging =
    (aging?.current_amount ?? 0) +
    (aging?.days_1_30 ?? 0) +
    (aging?.days_31_60 ?? 0) +
    (aging?.days_over_60 ?? 0) || 1;

  const agingBuckets = [
    {
      label: 'Hiện tại',
      value: aging?.current_amount ?? 0,
      barColor: 'bg-emerald-500',
      textColor: 'text-emerald-700',
    },
    {
      label: '1–30 ngày',
      value: aging?.days_1_30 ?? 0,
      barColor: 'bg-amber-400',
      textColor: 'text-amber-700',
    },
    {
      label: '31–60 ngày',
      value: aging?.days_31_60 ?? 0,
      barColor: 'bg-orange-500',
      textColor: 'text-orange-700',
    },
    {
      label: '>60 ngày',
      value: aging?.days_over_60 ?? 0,
      barColor: 'bg-red-500',
      textColor: 'text-red-700',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Revenue summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Tổng doanh thu"
          value={fmtVnd(fin.revenue?.total_revenue)}
          sub={`${fin.revenue?.total_pos ?? 0} PO`}
          highlight
        />
        <KpiCard
          label="Doanh thu tháng này"
          value={fmtVnd(fin.revenue?.revenue_this_month)}
        />
        <KpiCard
          label="Tổng công nợ"
          value={fmtVnd(aging?.total_outstanding)}
          warn={(aging?.total_outstanding ?? 0) > 0}
        />
      </div>

      {/* AR Aging */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">Phân tích công nợ (AR Aging)</h3>
          <span className="text-sm font-mono font-semibold text-slate-800">
            Tổng: {fmtVnd(aging?.total_outstanding)}
          </span>
        </div>
        <div className="space-y-3">
          {agingBuckets.map((bucket) => {
            const pct = (bucket.value / totalAging) * 100;
            return (
              <div key={bucket.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">{bucket.label}</span>
                  <span className={cn('text-xs font-mono font-medium', bucket.textColor)}>
                    {fmtVnd(bucket.value)}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', bucket.barColor)}
                    style={{ width: `${Math.max(pct, 0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent payments */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Thanh toán gần đây</h3>
        </div>
        {!fin.recent_payments?.length ? (
          <div className="py-10 text-center text-sm text-slate-400">Chưa có thanh toán nào</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/60">
                <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5">
                  Ngày thanh toán
                </th>
                <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5">
                  Tham chiếu
                </th>
                <th className="text-right text-xs font-medium text-slate-400 px-4 py-2.5">
                  Số tiền
                </th>
                <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5">
                  Ghi chú
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fin.recent_payments.slice(0, 5).map((payment) => (
                <tr key={payment.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">
                    {formatDate(payment.payment_date)}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-mono text-slate-500">
                    {payment.reference ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-mono font-semibold text-emerald-700 text-right whitespace-nowrap">
                    {fmtVnd(payment.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-400 truncate max-w-[180px]">
                    {payment.notes ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Tab 4: Liên hệ ──────────────────────────────────────────────

function TabLienHe({
  customer,
  customerId,
}: {
  customer: CustomerDetail;
  customerId: string;
}) {
  const [showContactModal, setShowContactModal] = useState(false);
  const [showInteractionModal, setShowInteractionModal] = useState(false);

  const contacts: ContactItem[] = customer.contacts ?? [];

  return (
    <div className="space-y-5">
      {showContactModal && (
        <AddContactModal customerId={customerId} onClose={() => setShowContactModal(false)} />
      )}
      {showInteractionModal && (
        <AddInteractionModal
          customerId={customerId}
          onClose={() => setShowInteractionModal(false)}
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{contacts.length} người liên hệ</p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowInteractionModal(true)}
            className="px-3 py-1.5 text-sm text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Thêm tương tác
          </button>
          <button
            onClick={() => setShowContactModal(true)}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Thêm liên hệ
          </button>
        </div>
      </div>

      {/* Contact cards */}
      {contacts.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 py-14 text-center">
          <p className="text-sm text-slate-400">Chưa có người liên hệ nào</p>
          <button
            onClick={() => setShowContactModal(true)}
            className="mt-3 text-sm text-brand-600 hover:text-brand-700 underline"
          >
            Thêm ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{contact.full_name}</p>
                  {contact.position && (
                    <p className="text-xs text-slate-500 mt-0.5">{contact.position}</p>
                  )}
                  {contact.department && (
                    <p className="text-xs text-slate-400">{contact.department}</p>
                  )}
                </div>
                <span
                  className={cn('text-xs flex-shrink-0', lastContactedColor(contact.last_contacted))}
                >
                  {lastContactedLabel(contact.last_contacted)}
                </span>
              </div>

              <div className="space-y-1 border-t border-slate-100 pt-2 mt-2">
                {contact.email && (
                  <p className="text-xs text-slate-600">
                    <a href={`mailto:${contact.email}`} className="hover:text-brand-600 transition-colors">
                      {contact.email}
                    </a>
                  </p>
                )}
                {contact.phone && (
                  <p className="text-xs text-slate-600">
                    <a href={`tel:${contact.phone}`} className="hover:text-brand-600 transition-colors">
                      {contact.phone}
                    </a>
                  </p>
                )}
                {!contact.email && !contact.phone && (
                  <p className="text-xs text-slate-400">Chưa có thông tin liên lạc</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Báo giá ──────────────────────────────────────────────

function TabBaoGia({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const limit = 5;

  const { data, isLoading } = useQuery<{
    data: { stats: QuoteStats; rfqs: RFQItem[]; total: number };
  }>({
    queryKey: ['crm-quotes', customerId, page],
    queryFn: () =>
      api.get(`/api/v1/crm/customers/${customerId}/quotes?page=${page}&limit=${limit}`),
    retry: 1,
  });

  const stats = data?.data?.stats;
  const rfqs = data?.data?.rfqs ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Tổng RFQ"
            value={String(stats.total_rfqs)}
          />
          <KpiCard
            label="Trúng thầu"
            value={String(stats.won)}
            highlight
          />
          <KpiCard
            label="Thua thầu"
            value={String(stats.lost)}
            warn={stats.lost > 0}
          />
          <KpiCard
            label="Đang chờ"
            value={String(stats.pending)}
          />
          <KpiCard
            label="Tỷ lệ trúng"
            value={`${(stats.win_rate ?? 0).toFixed(1)}%`}
            highlight={(stats.win_rate ?? 0) >= 50}
          />
        </div>
      )}

      {/* RFQ table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Danh sách báo giá</h3>
          <span className="text-xs text-slate-400">{total} RFQ</span>
        </div>

        {isLoading ? (
          <SkeletonRow rows={5} cols={5} />
        ) : rfqs.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Chưa có báo giá nào</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/60">
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Số RFQ
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Mã BQMS
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Thông số
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Kết quả
                    </th>
                    <th className="text-left text-xs font-medium text-slate-400 px-4 py-2.5 whitespace-nowrap">
                      Ngày hỏi giá
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rfqs.map((rfq) => (
                    <tr key={rfq.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-mono text-slate-800 whitespace-nowrap">
                        {rfq.rfq_number}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-mono text-slate-500 whitespace-nowrap">
                        {rfq.bqms_code ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 max-w-[200px] truncate">
                        {rfq.spec ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">{resultBadge(rfq.result)}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-500 whitespace-nowrap">
                        {formatDate(rfq.inquiry_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={total}
              limit={limit}
              onChange={(p) => setPage(p)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

type TabKey = 'tongquan' | 'donhang' | 'taichinh' | 'lienhe' | 'baogía';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tongquan', label: 'Tổng quan' },
  { key: 'donhang', label: 'Đơn hàng' },
  { key: 'taichinh', label: 'Tài chính' },
  { key: 'lienhe', label: 'Liên hệ' },
  { key: 'baogía', label: 'Báo giá' },
];

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [activeTab, setActiveTab] = useState<TabKey>('tongquan');

  const { data, isLoading } = useQuery<{ data: CustomerDetail }>({
    queryKey: ['crm-customer', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}`),
    retry: 1,
  });

  const customer = data?.data;

  // KPI values derived from customer data
  const arOutstanding = customer?.ar_summary?.outstanding ?? 0;
  const winRateDisplay = '—'; // loaded per-tab in Báo giá

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => router.push('/crm')}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
      >
        <span className="text-base leading-none">&#8592;</span>
        Quay lại
      </button>

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-24 bg-white rounded-lg border border-slate-200" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-white rounded-lg border border-slate-200" />
            ))}
          </div>
        </div>
      ) : !customer ? (
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-sm text-slate-400">Không tìm thấy khách hàng</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-brand-700">
                  {customer.company_name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-slate-900 leading-tight">
                  {customer.company_name}
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                  {customer.short_name && (
                    <span className="text-sm text-slate-500">{customer.short_name}</span>
                  )}
                  {customer.customer_code && (
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                      {customer.customer_code}
                    </span>
                  )}
                  {customer.tax_code && (
                    <span className="text-xs text-slate-400">MST: {customer.tax_code}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <KpiCard
              label="Doanh thu"
              value={fmtVnd(customer.total_revenue)}
              sub={`Đơn gần nhất: ${formatDate(customer.last_order_date)}`}
              highlight
            />
            <KpiCard
              label="Số PO"
              value={String(customer.total_orders)}
              sub="Tổng đơn hàng"
            />
            <KpiCard
              label="Công nợ"
              value={fmtVnd(arOutstanding)}
              sub={
                (customer.ar_summary?.overdue_count ?? 0) > 0
                  ? `${customer.ar_summary?.overdue_count} khoản quá hạn`
                  : 'Không có quá hạn'
              }
              warn={arOutstanding > 0}
            />
            <KpiCard
              label="Tỷ lệ trúng"
              value={winRateDisplay}
              sub="Xem trong tab Báo giá"
            />
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-slate-200 mb-6">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === tab.key
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'tongquan' && (
            <TabTongQuan customer={customer} customerId={customerId} />
          )}
          {activeTab === 'donhang' && <TabDonHang customerId={customerId} />}
          {activeTab === 'taichinh' && <TabTaiChinh customerId={customerId} />}
          {activeTab === 'lienhe' && (
            <TabLienHe customer={customer} customerId={customerId} />
          )}
          {activeTab === 'baogía' && <TabBaoGia customerId={customerId} />}
        </>
      )}
    </div>
  );
}
