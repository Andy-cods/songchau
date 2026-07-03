'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardList,
  ShoppingCart,
  Truck,
  AlertCircle,
  AtSign,
  Send,
  Loader2,
  X,
  Users,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';

// ─── Types ─────────────────────────────────────────────────────

interface SmartNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  ref_type?: string;
  ref_id?: string;
  created_at: string;
}

interface NotificationsResponse {
  data: {
    items: SmartNotification[];
    total: number;
    unread_count: number;
  };
}

interface UserOption {
  id: string;
  full_name: string;
  email: string;
}

// ─── Type Icon Map ───────────────────────────────────────────────

function getTypeIcon(type: string): React.ElementType {
  if (type.includes('rfq') || type.includes('quotation')) return ClipboardList;
  if (type.includes('po') || type.includes('purchase')) return ShoppingCart;
  if (type.includes('delivery') || type.includes('shipment')) return Truck;
  if (type.includes('mention')) return AtSign;
  return AlertCircle;
}

function getTypeColor(type: string): string {
  if (type.includes('rfq') || type.includes('quotation')) return 'bg-amber-50 text-amber-600';
  if (type.includes('po') || type.includes('purchase')) return 'bg-cyan-50 text-cyan-600';
  if (type.includes('delivery') || type.includes('shipment')) return 'bg-cyan-50 text-cyan-600';
  if (type.includes('mention')) return 'bg-brand-50 text-brand-600';
  return 'bg-slate-50 text-slate-600';
}

// ─── Ref Type Link ───────────────────────────────────────────────

function getRefLink(ref_type?: string, ref_id?: string): string | null {
  if (!ref_type || !ref_id) return null;
  const map: Record<string, string> = {
    rfq: `/bqms/rfq`,
    quotation: `/bqms/quotation/${ref_id}`,
    purchase_order: `/purchase-orders/${ref_id}`,
    delivery: `/deliveries`,
    shipment: `/shipments/${ref_id}`,
    invoice: `/invoices/${ref_id}`,
  };
  return map[ref_type] ?? null;
}

// ─── Send Notification Modal ─────────────────────────────────────

function SendNotificationModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [recipientId, setRecipientId] = useState('');

  const { data: usersData } = useQuery<{ items: UserOption[] }>({
    queryKey: ['users-list'],
    queryFn: () => api.get('/api/v1/users?page_size=100'),
    retry: false,
  });

  const sendMutation = useMutation({
    mutationFn: (payload: { title: string; body: string; recipient_id?: string }) =>
      api.post('/api/v1/smart-notifications/send', payload),
    onSuccess: () => {
      onSent();
      onClose();
    },
  });

  const users = usersData?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Gửi thông báo</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Người nhận (để trống = gửi tất cả)
            </label>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Tất cả người dùng</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tiêu đề</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề thông báo..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nội dung</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Nhập nội dung thông báo..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>
          {sendMutation.isError && (
            <p className="text-sm text-red-600">Gửi thông báo thất bại. Vui lòng thử lại.</p>
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
            onClick={() =>
              sendMutation.mutate({
                title,
                body,
                ...(recipientId ? { recipient_id: recipientId } : {}),
              })
            }
            disabled={!title || !body || sendMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Gửi thông báo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
  const [showSendModal, setShowSendModal] = useState(false);
  const [page, setPage] = useState(1);

  const isAdminOrManager =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'director';

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ['smart-notifications', activeTab, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (activeTab === 'unread') params.set('unread', 'true');
      if (activeTab === 'read') params.set('unread', 'false');
      return api.get(`/api/v1/smart-notifications?${params}`);
    },
    retry: false,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/smart-notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post('/api/v1/smart-notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const notifications = data?.data?.items ?? [];
  const total = data?.data?.total ?? 0;
  const unreadCount = data?.data?.unread_count ?? 0;

  const tabs = [
    { id: 'all' as const, label: 'Tất cả' },
    { id: 'unread' as const, label: 'Chưa đọc', count: unreadCount },
    { id: 'read' as const, label: 'Đã đọc' },
  ];

  return (
    <div>
      {/* Header */}
      <PageHeader
        icon={Bell}
        title="Trung tâm thông báo"
        subtitle="Quản lý thông báo hệ thống"
        actions={
          <>
            {isAdminOrManager && (
              <button
                onClick={() => setShowSendModal(true)}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Users className="h-4 w-4" />
                Gửi thông báo
              </button>
            )}
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
              >
                {markAllReadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4" />
                )}
                Đánh dấu tất cả đã đọc
              </button>
            )}
          </>
        }
        className="mb-6"
      />

      {/* Success feedback */}
      {markAllReadMutation.isSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          Tất cả thông báo đã được đánh dấu đã đọc.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notification List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 bg-white rounded-lg border border-slate-200 animate-pulse"
            >
              <div className="h-10 w-10 bg-slate-200 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-slate-200 rounded" />
                <div className="h-3 w-1/2 bg-slate-200 rounded" />
                <div className="h-3 w-24 bg-slate-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={BellOff}
            heading="Không có thông báo"
            description={
              activeTab === 'unread' ? 'Bạn đã đọc tất cả thông báo' : 'Chưa có thông báo nào'
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const Icon = getTypeIcon(notif.type);
            const iconColor = getTypeColor(notif.type);
            const refLink = getRefLink(notif.ref_type, notif.ref_id);

            return (
              <div
                key={notif.id}
                className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                  notif.is_read
                    ? 'bg-white border-slate-200'
                    : 'bg-brand-50/30 border-brand-200'
                }`}
              >
                {/* Icon */}
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconColor}`}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4
                      className={`text-sm ${
                        notif.is_read ? 'text-slate-700' : 'text-slate-900 font-medium'
                      }`}
                    >
                      {notif.title}
                    </h4>
                    {!notif.is_read && (
                      <span className="h-2 w-2 rounded-full bg-brand-500 shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notif.body}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-slate-400">
                      {formatRelativeTime(notif.created_at)}
                    </span>
                    {refLink && (
                      <a
                        href={refLink}
                        className="text-xs text-brand-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Xem chi tiết →
                      </a>
                    )}
                  </div>
                </div>

                {/* Mark Read Button */}
                {!notif.is_read && (
                  <button
                    onClick={() => markReadMutation.mutate(notif.id)}
                    disabled={markReadMutation.isPending && markReadMutation.variables === notif.id}
                    className="shrink-0 text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors text-slate-500"
                    title="Đánh dấu đã đọc"
                  >
                    {markReadMutation.isPending && markReadMutation.variables === notif.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCheck className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            Trước
          </button>
          <span className="text-sm text-slate-600">
            Trang {page} · {total} thông báo
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={notifications.length < 20}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            Sau
          </button>
        </div>
      )}

      {/* Send Modal */}
      {showSendModal && (
        <SendNotificationModal
          onClose={() => setShowSendModal(false)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['smart-notifications'] });
          }}
        />
      )}
    </div>
  );
}
