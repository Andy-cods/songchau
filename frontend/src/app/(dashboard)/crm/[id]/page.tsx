'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import {
  Contact,
  Plus,
  X,
  Loader2,
  Phone,
  Mail,
  ShoppingCart,
  MessageSquare,
  Clock,
  ArrowLeft,
  Inbox,
  TrendingUp,
  Edit2,
  Save,
} from 'lucide-react';
import Link from 'next/link';
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
  total_orders: number;
  total_revenue: number;
  last_order_date?: string;
  contacts?: ContactItem[];
  interactions?: InteractionItem[];
}

interface ContactItem {
  id: number;
  full_name: string;
  position?: string;
  email?: string;
  phone?: string;
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

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

const INTERACTION_TYPES = [
  { value: 'call', label: 'Gọi điện' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Gặp mặt' },
  { value: 'demo', label: 'Demo sản phẩm' },
  { value: 'support', label: 'Hỗ trợ kỹ thuật' },
  { value: 'other', label: 'Khác' },
];

const INTERACTION_ICON: Record<string, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: Contact,
  demo: TrendingUp,
  support: MessageSquare,
  other: MessageSquare,
};

// ─── Add Contact Modal ───────────────────────────────────────────

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
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      onClose();
    },
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
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

          <div className="grid grid-cols-2 gap-4">
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

          <div className="flex justify-end gap-3 pt-2">
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
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm liên hệ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Interaction Modal ───────────────────────────────────────

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
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-timeline', customerId] });
      onClose();
    },
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
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
                <option key={t.value} value={t.value}>{t.label}</option>
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

          <div className="flex justify-end gap-3 pt-2">
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
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ghi nhận
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Contacts Tab ────────────────────────────────────────────────

function ContactsTab({
  contacts,
  customerId,
}: {
  contacts: ContactItem[];
  customerId: string;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      {showModal && (
        <AddContactModal customerId={customerId} onClose={() => setShowModal(false)} />
      )}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Người liên hệ ({contacts.length})
        </h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Thêm liên hệ
        </button>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-300 bg-white rounded-lg border border-slate-200">
          <Contact className="h-10 w-10 mb-2" />
          <p className="text-sm text-slate-400">Chưa có người liên hệ</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-700">
                    {contact.full_name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{contact.full_name}</p>
                  {contact.position && (
                    <p className="text-xs text-slate-400 mt-0.5">{contact.position}</p>
                  )}
                  <div className="mt-2 space-y-1">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Interactions Tab ────────────────────────────────────────────

function InteractionsTab({
  interactions,
  customerId,
}: {
  interactions: InteractionItem[];
  customerId: string;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      {showModal && (
        <AddInteractionModal customerId={customerId} onClose={() => setShowModal(false)} />
      )}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Lịch sử tương tác ({interactions.length})
        </h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Ghi nhận
        </button>
      </div>

      {interactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-300 bg-white rounded-lg border border-slate-200">
          <MessageSquare className="h-10 w-10 mb-2" />
          <p className="text-sm text-slate-400">Chưa có tương tác nào</p>
        </div>
      ) : (
        <div className="space-y-3">
          {interactions.map((item) => {
            const typeLabel = INTERACTION_TYPES.find((t) => t.value === item.interaction_type)?.label ?? item.interaction_type;
            const IconComponent = INTERACTION_ICON[item.interaction_type] ?? MessageSquare;
            return (
              <div
                key={item.id}
                className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <IconComponent className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">{item.subject}</p>
                      <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded">
                      {typeLabel}
                    </span>
                    {item.notes && (
                      <p className="mt-2 text-sm text-slate-500 line-clamp-2">{item.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Timeline Tab ────────────────────────────────────────────────

function TimelineTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery<{ data: TimelineEvent[] }>({
    queryKey: ['crm-timeline', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}/timeline`),
    retry: 1,
  });

  const events = data?.data ?? [];

  const TYPE_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
    order: { color: 'bg-blue-500', icon: ShoppingCart, label: 'Đơn hàng' },
    interaction: { color: 'bg-brand-500', icon: MessageSquare, label: 'Tương tác' },
    invoice: { color: 'bg-emerald-500', icon: TrendingUp, label: 'Hóa đơn' },
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-slate-200 flex-shrink-0" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-4 w-48 bg-slate-200 rounded" />
              <div className="h-3 w-32 bg-slate-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-300 bg-white rounded-lg border border-slate-200">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm text-slate-400">Chưa có hoạt động nào</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      {events.map((event, idx) => {
        const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.interaction;
        const IconComponent = cfg.icon;
        return (
          <div key={idx} className="flex gap-4">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`h-8 w-8 rounded-full ${cfg.color} flex items-center justify-center flex-shrink-0 z-10`}>
                <IconComponent className="h-4 w-4 text-white" />
              </div>
              {idx < events.length - 1 && (
                <div className="w-0.5 flex-1 bg-slate-200 mt-1 mb-1" />
              )}
            </div>
            {/* Content */}
            <div className={`flex-1 pb-4 ${idx < events.length - 1 ? '' : ''}`}>
              <div className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{event.title}</p>
                    {event.details && (
                      <p className="text-xs text-slate-500 mt-0.5">{event.details}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(event.date)}</span>
                </div>
                <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-xs font-medium text-white ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Edit Tab ────────────────────────────────────────────────────

interface EditCustomerForm {
  company_name: string;
  short_name: string;
  tax_code: string;
  address: string;
  phone: string;
  email: string;
}

function EditTab({
  customer,
  customerId,
}: {
  customer: CustomerDetail;
  customerId: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditCustomerForm>({
    company_name: customer.company_name ?? '',
    short_name: customer.short_name ?? '',
    tax_code: customer.tax_code ?? '',
    address: customer.address ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
  });

  const mutation = useMutation({
    mutationFn: (data: EditCustomerForm) =>
      api.put(`/api/v1/crm/customers/${customerId}`, data),
    onSuccess: () => {
      toast.success('Cập nhật thông tin thành công!');
      queryClient.invalidateQueries({ queryKey: ['crm-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['crm-customers'] });
    },
    onError: () => {
      toast.error('Không thể cập nhật thông tin');
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Chỉnh sửa thông tin
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Name */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tên công ty <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="company_name"
              value={form.company_name}
              onChange={handleChange}
              required
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          {/* Short Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tên viết tắt
            </label>
            <input
              type="text"
              name="short_name"
              value={form.short_name}
              onChange={handleChange}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          {/* Tax Code */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Mã số thuế
            </label>
            <input
              type="text"
              name="tax_code"
              value={form.tax_code}
              onChange={handleChange}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Số điện thoại
            </label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>

          {/* Address */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Địa chỉ
            </label>
            <textarea
              name="address"
              value={form.address}
              onChange={handleChange}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>
        </div>

        {mutation.isError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            Có lỗi xảy ra. Vui lòng thử lại.
          </p>
        )}

        {mutation.isSuccess && (
          <p className="mt-3 text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg">
            Đã cập nhật thành công!
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Lưu thay đổi
        </button>
      </div>
    </form>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

type Tab = 'contacts' | 'history' | 'timeline' | 'edit';

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const [activeTab, setActiveTab] = useState<Tab>('contacts');

  const { data, isLoading } = useQuery<{ data: CustomerDetail }>({
    queryKey: ['crm-customer', customerId],
    queryFn: () => api.get(`/api/v1/crm/customers/${customerId}`),
    retry: 1,
  });

  const customer = data?.data;
  const contacts = customer?.contacts ?? [];
  const interactions = customer?.interactions ?? [];

  const TABS: { key: Tab; label: string }[] = [
    { key: 'contacts', label: `Liên hệ (${contacts.length})` },
    { key: 'history', label: `Lịch sử (${interactions.length})` },
    { key: 'timeline', label: 'Timeline' },
    { key: 'edit', label: 'Chỉnh sửa' },
  ];

  return (
    <div>
      {/* Back link */}
      <Link
        href="/crm"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Danh sách khách hàng
      </Link>

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-24 bg-white rounded-lg border border-slate-200" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-white rounded-lg border border-slate-200" />
            ))}
          </div>
        </div>
      ) : !customer ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-300">
          <Contact className="h-12 w-12 mb-3" />
          <p className="text-sm text-slate-400">Không tìm thấy khách hàng</p>
        </div>
      ) : (
        <>
          {/* Header Card */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-brand-700">
                  {customer.company_name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-display font-bold text-slate-900">
                  {customer.company_name}
                </h2>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  {customer.short_name && (
                    <span className="text-sm text-slate-400">{customer.short_name}</span>
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
                <div className="flex flex-wrap gap-4 mt-2">
                  {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600 transition-colors">
                      <Phone className="h-3 w-3" />
                      {customer.phone}
                    </a>
                  )}
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600 transition-colors">
                      <Mail className="h-3 w-3" />
                      {customer.email}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Tổng đơn hàng</p>
              <p className="text-2xl font-bold font-mono text-slate-900 mt-1">{customer.total_orders}</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Tổng doanh thu</p>
              <p className="text-2xl font-bold font-mono text-emerald-700 mt-1">
                {fmtVnd(customer.total_revenue)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Đơn gần nhất</p>
              <p className="text-xl font-bold text-slate-700 mt-1">
                {customer.last_order_date ? formatDate(customer.last_order_date) : '—'}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-200 mb-4">
            <div className="flex gap-0">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'contacts' && (
            <ContactsTab contacts={contacts} customerId={customerId} />
          )}
          {activeTab === 'history' && (
            <InteractionsTab interactions={interactions} customerId={customerId} />
          )}
          {activeTab === 'timeline' && (
            <TimelineTab customerId={customerId} />
          )}
          {activeTab === 'edit' && (
            <EditTab customer={customer} customerId={customerId} />
          )}
        </>
      )}
    </div>
  );
}
