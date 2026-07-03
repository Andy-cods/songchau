'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ChevronLeft, ChevronRight, Pencil, Building2, User2, X, MessageSquare,
  Plus, Send, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-permissions';
import { toast } from 'sonner';
import {
  PageShellHeader, CockpitTabs, DataPanel, StatusPill, StatStrip,
  SkeletonBlock, TrackingRail, RailCard,
  TYPE, BUTTON, SHELL, ELEVATION, DEPTH, ROW_PADDING, BADGE,
  type StatChip, type BadgeTone,
} from '@/components/cockpit';
import { Pagination } from '../_components/Pagination';
import { HoSoTab } from '../_components/HoSoTab';

// Code-splitting (W3-16): QuoteBatchModal is 1669 lines and only opens on
// click (state-gated below) — defer its chunk out of this route's bundle.
const QuoteBatchModal = dynamic(
  () => import('@/components/sourcing/QuoteBatchModal').then((m) => m.QuoteBatchModal),
  { ssr: false, loading: () => null },
);

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
  owner_id?: string | null;
  owner_name?: string | null;
  notes?: string;
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

interface CustomerDetailResponse {
  customer: CustomerDetail;
  contacts: ContactItem[];
  recent_interactions: InteractionItem[];
  recent_orders: POItem[];
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

interface ExternalMapPreviewResult {
  source_system: string;
  match_field: string;
  normalized_value: string;
  matched_count: number;
  samples: Array<{
    id: number;
    record_no?: string;
    bqms_code?: string;
    matched_value?: string;
    event_date?: string;
    amount?: number;
  }>;
  duplicate_for_customer: number;
  used_by_other_customers: Array<{
    customer_id: number;
    company_name?: string;
    customer_code?: string;
  }>;
  risk_level: 'ok' | 'no_match' | 'too_wide' | 'duplicate' | 'conflict';
  warning?: string;
}

interface ContactItem {
  id: number;
  full_name: string;
  position?: string;
  department?: string;
  email?: string;
  phone?: string;
  last_contacted?: string;
  last_contacted_at?: string;
}

interface InteractionItem {
  id: number;
  interaction_type: string;
  subject: string;
  notes?: string;
  created_at: string;
}

interface TimelineEvent {
  type?: string;
  event_type?: string;
  date?: string;
  created_at?: string;
  title: string;
  details?: string;
  detail?: string;
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

const MANAGER_ROLES = new Set(['manager', 'admin']);

function fmtVnd(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function recencyTone(dateStr?: string): BadgeTone {
  if (!dateStr) return 'slate';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
  if (diff < 7) return 'emerald';
  if (diff < 30) return 'amber';
  return 'rose';
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

const RESULT_TONE: Record<string, BadgeTone> = { won: 'emerald', lost: 'rose', pending: 'amber' };
const RESULT_LABEL: Record<string, string> = { won: 'Trúng', lost: 'Thua', pending: 'Chờ' };

const STATUS_TONE: Record<string, BadgeTone> = {
  completed: 'emerald', delivered: 'emerald', pending: 'amber',
  cancelled: 'rose', processing: 'sky',
};
const STATUS_LABEL: Record<string, string> = {
  completed: 'Hoàn thành', delivered: 'Đã giao', pending: 'Chờ',
  cancelled: 'Hủy', processing: 'Đang xử lý',
};

function resultBadge(result?: string) {
  if (!result) return <span className="text-[12px] text-slate-300">—</span>;
  return (
    <StatusPill
      label={RESULT_LABEL[result] ?? result}
      tone={RESULT_TONE[result] ?? 'slate'}
      variant="bare"
      size="sm"
    />
  );
}

function statusBadge(status?: string) {
  if (!status) return <span className="text-[12px] text-slate-300">—</span>;
  return (
    <StatusPill
      label={STATUS_LABEL[status] ?? status}
      tone={STATUS_TONE[status] ?? 'slate'}
      variant="bare"
      size="sm"
    />
  );
}

// ─── Dense table shells ─────────────────────────────────────────

function Th({ children, alignEnd }: { children: React.ReactNode; alignEnd?: boolean }) {
  return (
    <th className={cn(TYPE.th, 'whitespace-nowrap px-3 py-2', alignEnd ? 'text-right' : 'text-left')}>
      {children}
    </th>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-3 text-[12px] text-slate-400">{children}</div>;
}

function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <div className="space-y-px p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className={cn(
                'h-3 animate-pulse rounded bg-slate-200',
                j === 0 ? 'w-32' : j === cols - 1 ? 'ml-auto w-16' : 'w-24'
              )}
            />
          ))}
        </div>
      ))}
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
    mutationFn: (payload: AddContactForm & { customer_id: number }) =>
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
    mutation.mutate({ ...form, customer_id: Number(customerId) });
  };

  return (
    <ModalShell icon={<User2 className="h-5 w-5 text-white" />} title="Thêm người liên hệ"
      subtitle="Bổ sung đầu mối liên hệ cho khách hàng" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        <Field label="Họ tên" required>
          <input type="text" name="full_name" value={form.full_name} onChange={handleChange}
            required placeholder="Nguyễn Văn A" className={INPUT_CLS} />
        </Field>
        <Field label="Chức vụ">
          <input type="text" name="position" value={form.position} onChange={handleChange}
            placeholder="Giám đốc mua hàng" className={INPUT_CLS} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input type="email" name="email" value={form.email} onChange={handleChange}
              placeholder="email@company.com" className={INPUT_CLS} />
          </Field>
          <Field label="Điện thoại">
            <input type="tel" name="phone" value={form.phone} onChange={handleChange}
              placeholder="0901234567" className={INPUT_CLS} />
          </Field>
        </div>
        {mutation.isError && <ErrorLine />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>Hủy</button>
          <button type="submit" disabled={mutation.isPending} className={BUTTON.primary}>
            {mutation.isPending ? 'Đang lưu…' : 'Thêm liên hệ'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Modal: Ghi nhận tương tác (also used by Ghi nhanh) ──────────

function AddInteractionModal({
  customerId,
  initialSubject,
  onClose,
}: {
  customerId: string;
  initialSubject?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddInteractionForm>({
    interaction_type: 'call',
    subject: initialSubject ?? '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: AddInteractionForm & { customer_id: number }) =>
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
    mutation.mutate({ ...form, customer_id: Number(customerId) });
  };

  return (
    <ModalShell icon={<MessageSquare className="h-5 w-5 text-white" />} title="Ghi nhận tương tác"
      subtitle="Lưu lại lần liên hệ với khách hàng" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        <Field label="Loại tương tác" required>
          <select name="interaction_type" value={form.interaction_type} onChange={handleChange}
            className={cn(INPUT_CLS, 'text-slate-700')}>
            {INTERACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Chủ đề" required>
          <input type="text" name="subject" value={form.subject} onChange={handleChange}
            required placeholder="Thảo luận về đơn hàng..." className={INPUT_CLS} />
        </Field>
        <Field label="Ghi chú">
          <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
            placeholder="Nội dung chi tiết..." className={cn(INPUT_CLS, 'resize-none')} />
        </Field>
        {mutation.isError && <ErrorLine />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>Hủy</button>
          <button type="submit" disabled={mutation.isPending} className={BUTTON.primary}>
            {mutation.isPending ? 'Đang lưu…' : 'Ghi nhận'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Slide-over: Sửa khách hàng (REAL inline edit) ───────────────

interface EditCustomerForm {
  company_name: string;
  short_name: string;
  tax_code: string;
  address: string;
  notes: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  contact_phone: string;
}

function EditCustomerSlideOver({
  customer,
  customerId,
  canEditTax,
  onClose,
}: {
  customer: CustomerDetail;
  customerId: string;
  canEditTax: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const primaryContact = (customer.contacts ?? [])[0];
  const [form, setForm] = useState<EditCustomerForm>({
    company_name: customer.company_name ?? '',
    short_name: customer.short_name ?? '',
    tax_code: customer.tax_code ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
    contact_name: primaryContact?.full_name ?? '',
    contact_role: primaryContact?.position ?? '',
    contact_email: primaryContact?.email ?? customer.email ?? '',
    contact_phone: primaryContact?.phone ?? customer.phone ?? '',
  });

  const mutation = useMutation({
    mutationFn: (payload: Partial<EditCustomerForm>) =>
      api.put(`/api/v1/crm/customers/${customerId}`, payload),
    onSuccess: () => {
      toast.success('Đã cập nhật khách hàng');
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-board'] });
      onClose();
    },
    onError: () => toast.error('Không thể cập nhật khách hàng'),
  });

  const set = (k: keyof EditCustomerForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) {
      toast.error('Tên công ty không được trống');
      return;
    }
    const payload: Partial<EditCustomerForm> = {
      company_name: form.company_name.trim(),
      short_name: form.short_name.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      contact_name: form.contact_name.trim(),
      contact_role: form.contact_role.trim(),
      contact_email: form.contact_email.trim(),
      contact_phone: form.contact_phone.trim(),
    };
    // tax_code chỉ manager/admin được sửa (staff không gửi để không đổi giá trị)
    if (canEditTax) payload.tax_code = form.tax_code.trim();
    mutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn('h-full w-full max-w-md bg-white ring-1 ring-slate-200 flex flex-col', ELEVATION.modal)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <div className={cn(TYPE.eyebrow, 'leading-none')}>Sửa khách hàng</div>
            <h3 className={cn(TYPE.h2, 'truncate mt-0.5')}>{customer.company_name}</h3>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={BUTTON.icon}>
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Tên công ty" required>
            <input value={form.company_name} onChange={set('company_name')} required className={INPUT_CLS} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tên rút gọn">
              <input value={form.short_name} onChange={set('short_name')} className={INPUT_CLS} />
            </Field>
            <Field label={canEditTax ? 'MST' : 'MST (chỉ quản lý)'}>
              <input value={form.tax_code} onChange={set('tax_code')} disabled={!canEditTax}
                className={cn(INPUT_CLS, !canEditTax && 'bg-slate-50 text-slate-400 cursor-not-allowed')} />
            </Field>
          </div>
          <Field label="Địa chỉ">
            <input value={form.address} onChange={set('address')} className={INPUT_CLS} />
          </Field>
          <Field label="Ghi chú">
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cn(INPUT_CLS, 'resize-none')} />
          </Field>

          <div className="pt-1">
            <div className={cn(TYPE.eyebrow, 'mb-2')}>Người liên hệ chính</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Họ tên">
                  <input value={form.contact_name} onChange={set('contact_name')} className={INPUT_CLS} />
                </Field>
                <Field label="Chức vụ">
                  <input value={form.contact_role} onChange={set('contact_role')} className={INPUT_CLS} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <input type="email" value={form.contact_email} onChange={set('contact_email')} className={INPUT_CLS} />
                </Field>
                <Field label="Điện thoại">
                  <input type="tel" value={form.contact_phone} onChange={set('contact_phone')} className={INPUT_CLS} />
                </Field>
              </div>
            </div>
          </div>

          {!canEditTax && (
            <p className="rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 text-[12px] text-slate-500">
              Bạn có thể chỉnh tên, địa chỉ, ghi chú và người liên hệ. MST và người phụ trách do quản lý cập nhật.
            </p>
          )}
          {mutation.isError && <ErrorLine />}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>Hủy</button>
          <button onClick={handleSubmit} disabled={mutation.isPending} className={BUTTON.primary}>
            {mutation.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Liên kết dữ liệu (External maps) ────────────────────────────

function ExternalMapsCard({ customerId, canManage }: { customerId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<ExternalMapPreviewResult | null>(null);
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
      setPreview(null);
      setShowForm(false);
      invalidateDependentQueries();
    },
    onError: () => toast.error('Không thể lưu mapping'),
  });

  const previewMutation = useMutation({
    mutationFn: (payload: Pick<ExternalMapForm, 'source_system' | 'match_field' | 'match_value'>) =>
      api.post<{ data: ExternalMapPreviewResult }>(
        `/api/v1/crm/customers/${customerId}/external-maps/preview`,
        payload
      ),
    onSuccess: (response) => {
      setPreview(response.data);
      if (response.data.warning) {
        toast.warning(response.data.warning);
      } else {
        toast.success(`Preview OK: ${response.data.matched_count} dòng khớp`);
      }
    },
    onError: () => {
      setPreview(null);
      toast.error('Không thể preview mapping');
    },
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
    setPreview(null);
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
    if (!preview || preview.normalized_value !== normalizedValue.toLowerCase()) {
      toast.error('Hãy preview mapping trước khi lưu');
      return;
    }
    if (preview.risk_level === 'no_match' || preview.risk_level === 'too_wide') {
      toast.error('Mapping này chưa đủ an toàn để lưu');
      return;
    }
    createMutation.mutate({
      ...form,
      match_value: normalizedValue,
      notes: form.notes.trim().replace(/\s+/g, ' '),
    });
  };

  const runPreview = () => {
    const normalizedValue = form.match_value.trim().replace(/\s+/g, ' ');
    if (!normalizedValue) {
      toast.error('Nhập giá trị match trước khi preview');
      return;
    }
    previewMutation.mutate({
      source_system: form.source_system,
      match_field: form.match_field,
      match_value: normalizedValue,
    });
  };

  const saveDisabled =
    createMutation.isPending ||
    !form.match_value.trim() ||
    !preview ||
    preview.normalized_value !== form.match_value.trim().replace(/\s+/g, ' ').toLowerCase() ||
    preview.risk_level === 'no_match' ||
    preview.risk_level === 'too_wide';

  const previewTone =
    preview?.risk_level === 'ok'
      ? 'ring-emerald-200 bg-emerald-50 text-emerald-800'
      : preview?.risk_level === 'duplicate' || preview?.risk_level === 'conflict'
        ? 'ring-amber-200 bg-amber-50 text-amber-800'
        : 'ring-rose-200 bg-rose-50 text-rose-700';

  return (
    <DataPanel
      title="Liên kết dữ liệu"
      eyebrow="Nối PO · giao hàng · RFQ thực tế"
      actions={
        canManage && (
          <button type="button" onClick={() => setShowForm((p) => !p)} className={BUTTON.secondary}>
            {showForm ? 'Đóng' : 'Thêm mapping'}
          </button>
        )
      }
    >
      {showForm && canManage && (
        <form onSubmit={handleSubmit} className="mb-4 rounded-lg ring-1 ring-slate-200 bg-slate-50/70 p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nguồn dữ liệu" small>
              <select value={`${form.source_system}:${form.match_field}`}
                onChange={(e) => handlePresetChange(e.target.value)} className={cn(INPUT_CLS, 'bg-white')}>
                {EXTERNAL_MAP_PRESETS.map((item) => (
                  <option key={`${item.source_system}:${item.match_field}`}
                    value={`${item.source_system}:${item.match_field}`}>{item.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {EXTERNAL_MAP_PRESETS.find(
                  (item) => item.source_system === form.source_system && item.match_field === form.match_field
                )?.hint ?? 'Chọn đúng nguồn để tránh nối nhầm dữ liệu.'}
              </p>
            </Field>
            <Field label="Giá trị match" small>
              <input type="text" value={form.match_value}
                onChange={(e) => { setPreview(null); setForm((prev) => ({ ...prev, match_value: e.target.value })); }}
                placeholder="Ví dụ: Canon VN" className={cn(INPUT_CLS, 'bg-white')} />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <Field label="Ghi chú" small>
              <input type="text" value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Ví dụ: Alias PO Samsung đang dùng" className={cn(INPUT_CLS, 'bg-white')} />
            </Field>
            <label className="inline-flex items-center gap-2 text-[13px] text-slate-600 whitespace-nowrap pb-2">
              <input type="checkbox" checked={form.is_primary}
                onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-300" />
              Đặt làm chính
            </label>
          </div>
          <div className="rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-100 px-3 py-2 text-[12px] text-amber-800">
            Chỉ thêm mapping đã xác nhận từ dữ liệu thật. Mapping sai sẽ làm lệch PO, giao hàng và RFQ.
          </div>
          {preview && (
            <div className={cn('rounded-lg ring-1 ring-inset px-3 py-3 text-[12px]', previewTone)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  Preview: {preview.matched_count} dòng khớp với "{preview.normalized_value}"
                </div>
                <div className="uppercase tracking-wide">
                  {preview.risk_level === 'ok' ? 'Ổn'
                    : preview.risk_level === 'duplicate' ? 'Trùng'
                    : preview.risk_level === 'conflict' ? 'Xung đột'
                    : preview.risk_level === 'too_wide' ? 'Quá rộng' : 'Không khớp'}
                </div>
              </div>
              {preview.warning && <p className="mt-2">{preview.warning}</p>}
              {!!preview.used_by_other_customers.length && (
                <p className="mt-2">
                  Đang được dùng ở: {preview.used_by_other_customers.map((item) => item.company_name || item.customer_code || `ID ${item.customer_id}`).join(', ')}
                </p>
              )}
              {!!preview.samples.length && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[11px] opacity-70">
                        <th className="py-1 pr-3">Số dòng</th>
                        <th className="py-1 pr-3">Mã</th>
                        <th className="py-1 pr-3">BQMS</th>
                        <th className="py-1 pr-3">Ngày</th>
                        <th className="py-1 text-right">Giá trị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.samples.map((sample) => (
                        <tr key={sample.id} className="border-t border-black/5">
                          <td className="py-1 pr-3 font-mono">{sample.record_no ?? sample.id}</td>
                          <td className="py-1 pr-3 truncate max-w-[160px]">{sample.matched_value ?? '—'}</td>
                          <td className="py-1 pr-3 font-mono">{sample.bqms_code ?? '—'}</td>
                          <td className="py-1 pr-3">{formatDate(sample.event_date)}</td>
                          <td className="py-1 text-right font-mono">{typeof sample.amount === 'number' ? fmtVnd(sample.amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={runPreview} disabled={previewMutation.isPending || !form.match_value.trim()}
              className={BUTTON.secondary}>
              {previewMutation.isPending ? 'Đang preview...' : 'Xem preview'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className={BUTTON.ghost}>Hủy</button>
            <button type="submit" disabled={saveDisabled} className={BUTTON.primary}>
              {createMutation.isPending ? 'Đang lưu...' : 'Lưu mapping'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <TableSkeleton cols={3} rows={3} />
      ) : mappings.length === 0 ? (
        <EmptyLine>Chưa có mapping nào cho khách hàng này.</EmptyLine>
      ) : (
        <div className="space-y-2">
          {mappings.map((mapping) => {
            const label =
              EXTERNAL_MAP_LABELS[`${mapping.source_system}:${mapping.match_field}`] ??
              `${mapping.source_system} / ${mapping.match_field}`;
            return (
              <div key={mapping.id}
                className="flex items-start justify-between gap-3 rounded-lg ring-1 ring-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-medium text-slate-800">{label}</p>
                    {mapping.is_primary && <StatusPill label="Chính" tone="emerald" variant="bare" size="sm" />}
                  </div>
                  <p className={cn(TYPE.code, 'mt-1 break-all')}>{mapping.match_value}</p>
                  {mapping.notes && <p className="text-[12px] text-slate-500 mt-1">{mapping.notes}</p>}
                </div>
                {canManage && (
                  <button type="button"
                    onClick={() => {
                      if (!window.confirm(`Xóa mapping "${mapping.match_value}"?`)) return;
                      deleteMutation.mutate(mapping.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="px-2 py-1 text-[12px] text-rose-700 ring-1 ring-inset ring-rose-200 rounded-md hover:bg-rose-50 transition-colors disabled:opacity-50">
                    Xóa
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </DataPanel>
  );
}

// ─── Tab: Tổng quan (info + finance + báo-giá folded in) ─────────

function TabTongQuan({
  customer,
  customerId,
  canManageMaps,
}: {
  customer: CustomerDetail;
  customerId: string;
  canManageMaps: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick info */}
        <DataPanel title="Thông tin nhanh">
          <dl className="space-y-2.5">
            {customer.address && <InfoRow label="Địa chỉ" value={customer.address} />}
            {customer.phone && (
              <InfoRow label="Điện thoại" value={
                <a href={`tel:${customer.phone}`} className="text-brand-600 hover:underline">{customer.phone}</a>
              } />
            )}
            {customer.email && (
              <InfoRow label="Email" value={
                <a href={`mailto:${customer.email}`} className="text-brand-600 hover:underline">{customer.email}</a>
              } />
            )}
            {customer.business_system && <InfoRow label="Hệ thống" value={customer.business_system} />}
            {customer.owner_name && <InfoRow label="Phụ trách" value={customer.owner_name} />}
            {customer.last_order_date && <InfoRow label="Đơn gần nhất" value={formatDate(customer.last_order_date)} />}
            {customer.notes && <InfoRow label="Ghi chú" value={customer.notes} />}
            {!customer.address && !customer.phone && !customer.email && (
              <p className="text-[12px] text-slate-400">Chưa có thông tin chi tiết. Bấm "Sửa" để bổ sung.</p>
            )}
          </dl>
        </DataPanel>

        {/* Báo giá summary (folded from old Báo-giá tab) */}
        <BaoGiaSummaryPanel customerId={customerId} />
      </div>

      {/* Tài chính (folded from old Tài-chính tab) */}
      <TaiChinhPanel customerId={customerId} />

      <ExternalMapsCard customerId={customerId} canManage={canManageMaps} />
    </div>
  );
}

function BaoGiaSummaryPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const limit = 15;

  const { data, isLoading } = useQuery<{
    data: { stats: QuoteStats; rfqs: RFQItem[]; total: number };
  }>({
    queryKey: ['crm-quotes', customerId, page],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/quotes?page=${page}&limit=${limit}`),
    retry: 1,
  });

  const stats = data?.data?.stats;
  const rfqs = data?.data?.rfqs ?? [];
  const total = data?.data?.total ?? 0;
  const winRate = Number(stats?.win_rate ?? 0);

  return (
    <DataPanel
      title="Báo giá"
      eyebrow="RFQ · tỷ lệ trúng"
      flush
      actions={stats ? (
        <div className="flex items-center gap-3 text-[12px]">
          <StatusPill label={`Trúng ${stats.won}`} tone="emerald" variant="bare" size="sm" />
          <StatusPill label={`Thua ${stats.lost}`} tone="rose" variant="bare" size="sm" />
          <StatusPill label={`Chờ ${stats.pending}`} tone="amber" variant="bare" size="sm" />
          <span className="font-semibold tabular-nums text-slate-900">{winRate.toFixed(0)}%</span>
        </div>
      ) : null}
    >
      {isLoading ? (
        <TableSkeleton cols={4} />
      ) : rfqs.length === 0 ? (
        <EmptyLine>Chưa có báo giá nào cho khách hàng này.</EmptyLine>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/60">
                <tr><Th>Số RFQ</Th><Th>BQMS</Th><Th>Kết quả</Th><Th>Ngày hỏi</Th></tr>
              </thead>
              <tbody className={DEPTH.divider}>
                {rfqs.map((rfq) => (
                  <tr key={rfq.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                    <td className={cn(ROW_PADDING.compact, TYPE.code, 'whitespace-nowrap')}>{rfq.rfq_number}</td>
                    <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] text-slate-500 whitespace-nowrap')}>{rfq.bqms_code ?? '—'}</td>
                    <td className={ROW_PADDING.compact}>{resultBadge(rfq.result)}</td>
                    <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>{formatDate(rfq.inquiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > limit && (
            <div className="border-t border-slate-100 px-3 py-2">
              <Pagination page={page} pageSize={limit} total={total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </DataPanel>
  );
}

function TaiChinhPanel({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery<{ data: FinancialData }>({
    queryKey: ['crm-financials', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/financials`),
    retry: 1,
  });

  const fin = data?.data;

  if (isLoading) return <DataPanel title="Tài chính"><TableSkeleton cols={3} /></DataPanel>;
  if (!fin) return <DataPanel title="Tài chính"><EmptyLine>Không tải được dữ liệu tài chính.</EmptyLine></DataPanel>;

  const aging = fin.ar_aging;
  const totalAging =
    (aging?.current_amount ?? 0) + (aging?.days_1_30 ?? 0) +
    (aging?.days_31_60 ?? 0) + (aging?.days_over_60 ?? 0) || 1;

  const agingBuckets: { label: string; value: number; tone: BadgeTone }[] = [
    { label: 'Hiện tại', value: aging?.current_amount ?? 0, tone: 'emerald' },
    { label: '1–30 ngày', value: aging?.days_1_30 ?? 0, tone: 'amber' },
    { label: '31–60 ngày', value: aging?.days_31_60 ?? 0, tone: 'amber' },
    { label: '>60 ngày', value: aging?.days_over_60 ?? 0, tone: 'rose' },
  ];

  return (
    <DataPanel
      title="Tài chính"
      eyebrow="Doanh thu · công nợ"
      actions={
        <span className="text-[13px] font-semibold tabular-nums text-slate-800">
          Công nợ: {fmtVnd(aging?.total_outstanding)}
        </span>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-4">
        {/* AR aging bars */}
        <div className="space-y-2.5">
          <div className={cn(TYPE.eyebrow, 'mb-1')}>Phân tích công nợ (AR Aging)</div>
          {agingBuckets.map((bucket) => {
            const pct = (bucket.value / totalAging) * 100;
            return (
              <div key={bucket.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] text-slate-500">{bucket.label}</span>
                  <span className={cn('text-[12px] font-mono font-medium tabular-nums', BADGE[bucket.tone].text)}>
                    {fmtVnd(bucket.value)}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', BADGE[bucket.tone].dot)}
                    style={{ width: `${Math.max(pct, 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden lg:block bg-slate-100" />

        {/* Revenue + payments */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Tổng doanh thu" value={fmtVnd(fin.revenue?.total_revenue)} tone="emerald" sub={`${fin.revenue?.total_pos ?? 0} PO`} />
            <MiniStat label="Tháng này" value={fmtVnd(fin.revenue?.revenue_this_month)} tone="slate" />
          </div>
          <div>
            <div className={cn(TYPE.eyebrow, 'mb-1')}>Thanh toán gần đây</div>
            {!fin.recent_payments?.length ? (
              <p className="text-[12px] text-slate-400">Chưa có thanh toán nào.</p>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/60"><tr><Th>Ngày</Th><Th>Tham chiếu</Th><Th alignEnd>Số tiền</Th></tr></thead>
                <tbody className={DEPTH.divider}>
                  {fin.recent_payments.slice(0, 15).map((p) => (
                    <tr key={p.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                      <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-600 whitespace-nowrap')}>{formatDate(p.payment_date)}</td>
                      <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] text-slate-500')}>{p.reference ?? '—'}</td>
                      <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] font-semibold text-emerald-700 text-right whitespace-nowrap')}>{fmtVnd(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </DataPanel>
  );
}

// ─── Tab: 📁 Hồ sơ → see ../_components/HoSoTab.tsx (Quote Hub D4-6) ──

// ─── Tab: Đơn hàng (PO + deliveries, dense + paged) ──────────────

function TabDonHang({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const limit = 15;

  const { data, isLoading } = useQuery<{
    data: { pos: POItem[]; total_pos: number; deliveries: DeliveryItem[]; total_deliveries: number };
  }>({
    queryKey: ['crm-orders', customerId, page],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/orders?page=${page}&limit=${limit}`),
    retry: 1,
  });

  const pos = data?.data?.pos ?? [];
  const totalPos = data?.data?.total_pos ?? 0;
  const deliveries = data?.data?.deliveries ?? [];
  const totalDeliveries = data?.data?.total_deliveries ?? 0;

  return (
    <div className="space-y-4">
      <DataPanel title="PO Samsung" eyebrow={`${totalPos} đơn hàng`} flush>
        {isLoading ? <TableSkeleton cols={5} /> : pos.length === 0 ? (
          <EmptyLine>Chưa có đơn hàng nào.</EmptyLine>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/60">
                  <tr><Th>Số PO</Th><Th>BQMS</Th><Th>Thông số</Th><Th>Ngày PO</Th><Th alignEnd>Giá trị</Th><Th>Trạng thái</Th></tr>
                </thead>
                <tbody className={DEPTH.divider}>
                  {pos.map((po) => (
                    <tr key={po.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                      <td className={cn(ROW_PADDING.compact, TYPE.code, 'whitespace-nowrap')}>{po.po_number}</td>
                      <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] text-slate-500 whitespace-nowrap')}>{po.bqms_code ?? '—'}</td>
                      <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-600 max-w-[220px] truncate')}>{po.spec ?? '—'}</td>
                      <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>{formatDate(po.po_date)}</td>
                      <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] font-medium text-emerald-700 text-right whitespace-nowrap')}>{fmtVnd(po.amount ?? 0)}</td>
                      <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>{statusBadge(po.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPos > limit && (
              <div className="border-t border-slate-100 px-3 py-2">
                <Pagination page={page} pageSize={limit} total={totalPos} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </DataPanel>

      <DataPanel title="Giao hàng" eyebrow={`${totalDeliveries} lô hàng`} flush>
        {isLoading ? <TableSkeleton cols={4} /> : deliveries.length === 0 ? (
          <EmptyLine>Chưa có dữ liệu giao hàng.</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/60">
                <tr><Th>Số PO</Th><Th>BQMS</Th><Th>Ngày giao</Th><Th alignEnd>Số lượng</Th><Th>Trạng thái</Th></tr>
              </thead>
              <tbody className={DEPTH.divider}>
                {deliveries.map((d) => (
                  <tr key={d.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                    <td className={cn(ROW_PADDING.compact, TYPE.code, 'whitespace-nowrap')}>{d.po_number}</td>
                    <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] text-slate-500 whitespace-nowrap')}>{d.bqms_code ?? '—'}</td>
                    <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>{formatDate(d.delivery_date)}</td>
                    <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] text-slate-700 text-right whitespace-nowrap')}>{d.quantity ?? '—'}</td>
                    <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>{statusBadge(d.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
    </div>
  );
}

// ─── Tab: Liên hệ ────────────────────────────────────────────────

function TabLienHe({
  customer,
  customerId,
  onQuickLog,
}: {
  customer: CustomerDetail;
  customerId: string;
  onQuickLog: () => void;
}) {
  const [showContactModal, setShowContactModal] = useState(false);
  const contacts: ContactItem[] = customer.contacts ?? [];

  return (
    <div className="space-y-3">
      {showContactModal && (
        <AddContactModal customerId={customerId} onClose={() => setShowContactModal(false)} />
      )}

      <DataPanel title="Người liên hệ" eyebrow={`${contacts.length} đầu mối`} flush
        actions={
          <div className="flex gap-2">
            <button onClick={onQuickLog} className={BUTTON.secondary}>Ghi tương tác</button>
            <button onClick={() => setShowContactModal(true)} className={BUTTON.primary}>
              <Plus className="h-4 w-4" /> Thêm liên hệ
            </button>
          </div>
        }
      >
        {contacts.length === 0 ? (
          <EmptyLine>
            Chưa có người liên hệ nào.{' '}
            <button onClick={() => setShowContactModal(true)} className="text-brand-600 hover:underline">Thêm ngay</button>
          </EmptyLine>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50/60">
              <tr><Th>Họ tên</Th><Th>Chức vụ</Th><Th>Email</Th><Th>Điện thoại</Th><Th alignEnd>Lần cuối</Th></tr>
            </thead>
            <tbody className={DEPTH.divider}>
              {contacts.map((c) => {
                const last = c.last_contacted_at ?? c.last_contacted;
                return (
                  <tr key={c.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                    <td className={cn(ROW_PADDING.compact, 'text-[13px] font-semibold text-slate-900 whitespace-nowrap')}>{c.full_name}</td>
                    <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>{c.position ?? '—'}</td>
                    <td className={cn(ROW_PADDING.compact, 'text-[12px]')}>
                      {c.email ? <a href={`mailto:${c.email}`} className="text-slate-600 hover:text-brand-600">{c.email}</a> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cn(ROW_PADDING.compact, 'text-[12px]')}>
                      {c.phone ? <a href={`tel:${c.phone}`} className="text-slate-600 hover:text-brand-600">{c.phone}</a> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cn(ROW_PADDING.compact, 'text-right whitespace-nowrap')}>
                      <StatusPill label={lastContactedLabel(last)} tone={recencyTone(last)} variant="bare" size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DataPanel>
    </div>
  );
}

// ─── Activity Rail (full timeline + inline Ghi nhanh composer) ───

interface InlineLogForm { interaction_type: string; subject: string }

function ActivityRail({
  customerId,
  collapsed,
  onToggleCollapse,
  onOpenFullLog,
}: {
  customerId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenFullLog: () => void;
}) {
  const queryClient = useQueryClient();
  const PAGE = 15;
  const [limit, setLimit] = useState(PAGE);
  const [composer, setComposer] = useState<InlineLogForm>({ interaction_type: 'call', subject: '' });

  const { data, isLoading, isFetching } = useQuery<{
    data: { events: TimelineEvent[]; total: number; has_more: boolean };
  }>({
    queryKey: ['crm-timeline', customerId, limit],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/timeline?limit=${limit}&offset=0`),
    retry: 1,
  });

  const events = data?.data?.events ?? [];
  const total = data?.data?.total ?? events.length;
  const hasMore = data?.data?.has_more ?? false;

  const quickLog = useMutation({
    mutationFn: (payload: { interaction_type: string; subject: string; customer_id: number }) =>
      api.post('/api/v1/crm/interactions', payload),
    onSuccess: () => {
      toast.success('Đã ghi nhanh');
      setComposer((p) => ({ ...p, subject: '' }));
      queryClient.invalidateQueries({ queryKey: ['crm-timeline', customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
    },
    onError: () => toast.error('Không thể ghi nhanh'),
  });

  const submitComposer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composer.subject.trim()) return;
    quickLog.mutate({ ...composer, subject: composer.subject.trim(), customer_id: Number(customerId) });
  };

  if (collapsed) {
    return (
      <aside className="flex w-11 flex-col items-center gap-2 bg-white ring-1 ring-slate-200 rounded-lg py-2">
        <button onClick={onToggleCollapse} aria-label="Mở thanh hoạt động" title="Hoạt động"
          className={cn(BUTTON.icon)}>
          <PanelRightOpen className="h-4.5 w-4.5" />
        </button>
        <div className="rotate-180 [writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-wider text-slate-400 select-none">
          Hoạt động
        </div>
        <span className="mt-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-slate-100 px-1 text-[11px] font-bold tabular-nums text-slate-600">
          {total}
        </span>
      </aside>
    );
  }

  return (
    <TrackingRail
      title={
        <div className="flex items-center justify-between gap-2">
          <span>Hoạt động · {total}</span>
          <button onClick={onToggleCollapse} aria-label="Thu gọn thanh hoạt động" title="Thu gọn"
            className="text-slate-400 hover:text-slate-700 transition-colors">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      }
      className="rounded-lg ring-1 ring-slate-200 max-h-[calc(100vh-7rem)] sticky top-[4.75rem]"
    >
      {/* Inline Ghi nhanh composer */}
      <RailCard title="Ghi nhanh" actions={
        <button onClick={onOpenFullLog} className="text-[11px] font-semibold text-brand-700 hover:underline">Chi tiết</button>
      }>
        <form onSubmit={submitComposer} className="space-y-2">
          <div className="flex gap-1.5">
            <select value={composer.interaction_type}
              onChange={(e) => setComposer((p) => ({ ...p, interaction_type: e.target.value }))}
              className="rounded-md ring-1 ring-inset ring-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400">
              {INTERACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex gap-1.5">
            <input value={composer.subject}
              onChange={(e) => setComposer((p) => ({ ...p, subject: e.target.value }))}
              placeholder="Nội dung liên hệ…"
              className="min-w-0 flex-1 rounded-md ring-1 ring-inset ring-slate-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <button type="submit" disabled={quickLog.isPending || !composer.subject.trim()}
              className={cn(BUTTON.primary, 'px-2.5 py-1.5')} aria-label="Ghi">
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </RailCard>

      {/* Full timeline */}
      {isLoading ? (
        <div className="space-y-3 px-1 py-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-200" />
              <div className="flex-1 space-y-1">
                <SkeletonBlock className="h-3 w-3/4" />
                <SkeletonBlock className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="px-1 py-2 text-[12px] text-slate-400">Chưa có hoạt động nào.</p>
      ) : (
        <ol className="space-y-0 px-0.5">
          {events.map((ev, idx) => {
            const date = ev.date ?? ev.created_at;
            const detail = ev.details ?? ev.detail;
            const tone = eventTone(ev.event_type ?? ev.type);
            return (
              <li key={idx} className="flex gap-2.5">
                <div className="flex flex-col items-center">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', BADGE[tone].dot)} />
                  {idx < events.length - 1 && <span className="w-px flex-1 bg-slate-200 my-0.5 min-h-[12px]" />}
                </div>
                <div className="flex-1 pb-2.5 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] text-slate-800 leading-snug">{ev.title}</p>
                    <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{formatRelativeTime(date)}</span>
                  </div>
                  {detail && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && (
        <button onClick={() => setLimit((l) => l + PAGE)} disabled={isFetching}
          className={cn(BUTTON.ghost, 'w-full justify-center text-[12px]')}>
          {isFetching ? 'Đang tải…' : 'Xem thêm'}
        </button>
      )}
    </TrackingRail>
  );
}

function eventTone(type?: string): BadgeTone {
  switch (type) {
    case 'order': return 'emerald';
    case 'invoice': return 'sky';
    case 'interaction': return 'slate';
    default: return 'slate';
  }
}

// ─── Shared small primitives ─────────────────────────────────────

const INPUT_CLS =
  'w-full rounded-lg ring-1 ring-inset ring-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-400';

function Field({ label, required, small, children }: {
  label: React.ReactNode; required?: boolean; small?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className={cn('block mb-1 font-medium text-slate-600', small ? 'text-[11px]' : 'text-[12px]')}>
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 pt-0.5 text-[12px] text-slate-400">{label}</dt>
      <dd className="text-[13px] text-slate-700 min-w-0">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value, tone, sub }: { label: string; value: string; tone: BadgeTone; sub?: string }) {
  return (
    <div className={cn('rounded-lg ring-1 ring-slate-200 p-3 border-l-2', BADGE[tone].dot.replace('bg-', 'border-'))}>
      <p className={cn(TYPE.eyebrow, 'leading-none')}>{label}</p>
      <p className="mt-1.5 text-[18px] font-bold font-display tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ModalShell({ icon, title, subtitle, onClose, children }: {
  icon: React.ReactNode; title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={cn('w-full max-w-md overflow-hidden rounded-xl bg-white', ELEVATION.modal)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">{icon}</div>
            <div className="min-w-0">
              <h3 className={TYPE.h2}>{title}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={BUTTON.icon}><X className="h-4.5 w-4.5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorLine() {
  return (
    <p className="rounded-lg bg-rose-50 ring-1 ring-inset ring-rose-100 px-3 py-2 text-[13px] text-rose-700">
      Có lỗi xảy ra. Vui lòng thử lại.
    </p>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100">
        <Building2 className="h-8 w-8 text-slate-400" />
      </div>
      <p className={TYPE.h2}>{title}</p>
      {hint && <p className="text-[13px] text-slate-500">{hint}</p>}
    </div>
  );
}

// ─── Quick-record dropdown (Ghi nhanh ▾) ─────────────────────────

function QuickRecordMenu({ onLogInteraction, onAddContact }: {
  onLogInteraction: () => void; onAddContact: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} className={BUTTON.secondary}>
        Ghi nhanh <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open ? 'rotate-90' : 'rotate-90 opacity-60')} />
      </button>
      {open && (
        <div className={cn('absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200', ELEVATION.floating)}>
          <button onClick={() => { setOpen(false); onLogInteraction(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
            <MessageSquare className="h-4 w-4 text-slate-400" /> Ghi tương tác
          </button>
          <button onClick={() => { setOpen(false); onAddContact(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
            <User2 className="h-4 w-4 text-slate-400" /> Thêm liên hệ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

type TabKey = 'tongquan' | 'hoso' | 'donhang' | 'lienhe';

const RAIL_COLLAPSE_KEY = 'crm-detail-rail-collapsed';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const role = useUserRole();
  const isManager = MANAGER_ROLES.has(role);

  const [activeTab, setActiveTab] = useState<TabKey>('tongquan');
  const [showEdit, setShowEdit] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [interactionSubject, setInteractionSubject] = useState<string | null>(null); // null = closed
  const [showQuote, setShowQuote] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Persist rail collapse in localStorage.
  useEffect(() => {
    try {
      const v = localStorage.getItem(RAIL_COLLAPSE_KEY);
      if (v != null) setRailCollapsed(v === '1');
    } catch { /* ignore */ }
  }, []);
  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(RAIL_COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const { data, isLoading, isFetching } = useQuery<{ data: CustomerDetailResponse }>({
    queryKey: ['crm-customer', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}`),
    retry: 1,
  });

  const customerPayload = data?.data;
  const customer = useMemo(() => (
    customerPayload
      ? {
          ...customerPayload.customer,
          contacts: customerPayload.contacts ?? [],
          interactions: customerPayload.recent_interactions ?? [],
          ar_summary: customerPayload.ar_summary ?? customerPayload.customer.ar_summary,
        }
      : undefined
  ), [customerPayload]);

  // Win-rate is loaded per-customer from the quotes endpoint (LIVE).
  const { data: quoteData } = useQuery<{ data: { stats: QuoteStats; total: number } }>({
    queryKey: ['crm-quotes', customerId, 1],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/quotes?page=1&limit=15`),
    enabled: !!customerId,
    retry: 1,
  });
  const quoteStats = quoteData?.data?.stats;

  // Counts for tab badges.
  const { data: ordersData } = useQuery<{ data: { total_pos: number } }>({
    queryKey: ['crm-orders', customerId, 1],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/orders?page=1&limit=15`),
    enabled: !!customerId,
    retry: 1,
  });

  const arOutstanding = customer?.ar_summary?.outstanding ?? 0;
  const overdueCount = customer?.ar_summary?.overdue_count ?? 0;
  const openQuotes = quoteStats?.pending ?? 0;
  const winRate = Number(quoteStats?.win_rate ?? 0);
  const hasWinRate = !!quoteStats && (quoteStats.won + quoteStats.lost) > 0;

  const eyebrow = useMemo(() => {
    if (!customer) return 'Khách hàng';
    const parts = [
      customer.customer_code,
      customer.tax_code ? `MST ${customer.tax_code}` : null,
      customer.owner_name ?? (customer.owner_id ? null : 'Chưa có phụ trách'),
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Khách hàng';
  }, [customer]);

  const statItems: StatChip[] = useMemo(() => {
    if (!customer) return [];
    return [
      { label: 'Doanh thu kỳ', value: fmtVnd(customer.total_revenue), tone: 'emerald', emphasizeValue: true, title: 'Tổng doanh thu' },
      { label: 'PO', value: customer.total_orders, divider: true, tone: 'sky', onClick: () => setActiveTab('donhang') },
      {
        label: 'Công nợ',
        value: fmtVnd(arOutstanding),
        divider: true,
        tone: arOutstanding > 0 ? 'rose' : 'slate',
        pulse: overdueCount > 0,
        emphasizeValue: arOutstanding > 0,
        title: overdueCount > 0 ? `${overdueCount} khoản quá hạn` : 'Không có quá hạn',
      },
      {
        label: 'Báo giá mở',
        value: openQuotes,
        divider: true,
        tone: openQuotes > 0 ? 'amber' : 'slate',
        onClick: () => setActiveTab('hoso'),
      },
      {
        label: 'Tỷ lệ trúng',
        value: hasWinRate ? `${winRate.toFixed(0)}%` : '—',
        divider: true,
        tone: hasWinRate ? (winRate >= 50 ? 'emerald' : 'amber') : 'slate',
        emphasizeValue: hasWinRate,
        title: 'Tỷ lệ trúng thầu (LIVE)',
      },
    ];
  }, [customer, arOutstanding, overdueCount, openQuotes, winRate, hasWinRate]);

  const tabs = useMemo(() => [
    { id: 'tongquan' as TabKey, label: 'Tổng quan' },
    { id: 'hoso' as TabKey, label: '📁 Hồ sơ', count: (ordersData?.data?.total_pos ?? 0) + (quoteData?.data?.total ?? 0) || undefined },
    { id: 'donhang' as TabKey, label: 'Đơn hàng', count: ordersData?.data?.total_pos || undefined },
    { id: 'lienhe' as TabKey, label: 'Liên hệ', count: customer?.contacts?.length || undefined },
  ], [ordersData, quoteData, customer]);

  const openLog = useCallback((subject?: string) => setInteractionSubject(subject ?? ''), []);

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      <PageShellHeader
        title={customer?.company_name ?? 'Khách hàng'}
        eyebrow={eyebrow}
        isFetching={isFetching}
        leading={
          <button onClick={() => router.push('/crm')} aria-label="Quay lại"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700 transition-colors">
            <ChevronLeft className="h-4.5 w-4.5" />
          </button>
        }
        actions={customer && (
          <>
            <button onClick={() => setShowEdit(true)} className={BUTTON.secondary}>
              <Pencil className="h-4 w-4" /> Sửa
            </button>
            <button onClick={() => setShowQuote(true)} className={BUTTON.primary}>
              <Plus className="h-4 w-4" /> Báo giá
            </button>
            <QuickRecordMenu onLogInteraction={() => openLog()} onAddContact={() => setShowContact(true)} />
          </>
        )}
      />

      {customer && <StatStrip items={statItems} sticky />}

      <div className={cn(SHELL.content, 'pt-4 pb-8')}>
        {isLoading ? (
          <div className="space-y-4">
            <SkeletonBlock className="h-11" />
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
              <SkeletonBlock className="h-72" />
              <SkeletonBlock className="h-72" />
            </div>
          </div>
        ) : !customer ? (
          <div className="py-16">
            <EmptyState title="Không tìm thấy khách hàng" hint="Khách hàng có thể đã bị xoá hoặc đường dẫn không đúng." />
          </div>
        ) : (
          <>
            {showEdit && (
              <EditCustomerSlideOver customer={customer} customerId={customerId}
                canEditTax={isManager} onClose={() => setShowEdit(false)} />
            )}
            {showContact && (
              <AddContactModal customerId={customerId} onClose={() => setShowContact(false)} />
            )}
            {interactionSubject !== null && (
              <AddInteractionModal customerId={customerId} initialSubject={interactionSubject || undefined}
                onClose={() => setInteractionSubject(null)} />
            )}
            {showQuote && (
              <QuoteBatchModal
                initialCustomerId={Number(customerId)}
                onClose={() => setShowQuote(false)}
                onCreated={() => setActiveTab('hoso')}
              />
            )}

            {/* Tabs */}
            <div className="mb-4">
              <CockpitTabs<TabKey>
                layoutGroup="crm-detail-tabs"
                value={activeTab}
                onChange={setActiveTab}
                tabs={tabs}
              />
            </div>

            {/* Split-pane: center tab + collapsible right activity rail */}
            <div className={cn(
              'grid gap-4',
              railCollapsed ? 'xl:grid-cols-[1fr_44px]' : 'xl:grid-cols-[1fr_300px]',
            )}>
              <div className="min-w-0">
                {activeTab === 'tongquan' && (
                  <TabTongQuan customer={customer} customerId={customerId} canManageMaps={isManager} />
                )}
                {activeTab === 'hoso' && <HoSoTab customerId={Number(customerId)} />}
                {activeTab === 'donhang' && <TabDonHang customerId={customerId} />}
                {activeTab === 'lienhe' && (
                  <TabLienHe customer={customer} customerId={customerId} onQuickLog={() => openLog()} />
                )}
              </div>

              <div className="hidden xl:block">
                <ActivityRail
                  customerId={customerId}
                  collapsed={railCollapsed}
                  onToggleCollapse={toggleRail}
                  onOpenFullLog={() => openLog()}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
