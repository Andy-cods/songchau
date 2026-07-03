'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellOff,
  FileCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  Truck,
  FileText,
  Boxes,
  Gavel,
  Quote,
  FileSignature,
  CheckCheck,
} from 'lucide-react';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  type NotificationListResult,
} from '@/services/notifications';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Notification, NotificationType } from '@/types/models';

// ─── Notification type icons ───────────────────────────────────
// Aligned to the real backend `notification_type` enum values
// (init_v3.sql + migrations m41 + procurement_v2_004).

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  workflow_request: FileCheck,
  workflow_approved: CheckCircle2,
  workflow_rejected: XCircle,
  deadline_reminder: Clock,
  stock_alert: Boxes,
  po_received: Package,
  bqms_rfq_new: FileText,
  report_ready: FileText,
  leave_request: Clock,
  leave_approved: CheckCircle2,
  leave_rejected: XCircle,
  leave_cancelled: XCircle,
  procurement_award: Gavel,
  procurement_quote: Quote,
  procurement_contract: FileSignature,
  procurement_po: Package,
  procurement_delivery: Truck,
};

const TYPE_COLOR: Record<NotificationType, string> = {
  workflow_request: 'bg-amber-50 text-amber-600',
  workflow_approved: 'bg-emerald-50 text-emerald-600',
  workflow_rejected: 'bg-rose-50 text-rose-600',
  deadline_reminder: 'bg-amber-50 text-amber-600',
  stock_alert: 'bg-rose-50 text-rose-600',
  po_received: 'bg-cyan-50 text-cyan-600',
  bqms_rfq_new: 'bg-brand-50 text-brand-600',
  report_ready: 'bg-slate-50 text-slate-600',
  leave_request: 'bg-amber-50 text-amber-600',
  leave_approved: 'bg-emerald-50 text-emerald-600',
  leave_rejected: 'bg-rose-50 text-rose-600',
  leave_cancelled: 'bg-slate-50 text-slate-600',
  procurement_award: 'bg-brand-50 text-brand-600',
  procurement_quote: 'bg-cyan-50 text-cyan-600',
  procurement_contract: 'bg-brand-50 text-brand-600',
  procurement_po: 'bg-cyan-50 text-cyan-600',
  procurement_delivery: 'bg-emerald-50 text-emerald-600',
};

// ─── Loading skeleton ──────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-4 bg-white rounded-lg border border-slate-200">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Single notification item ──────────────────────────────────

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  const router = useRouter();
  const Icon = TYPE_ICON[notification.type] || Bell;
  const iconColor = TYPE_COLOR[notification.type] || 'bg-slate-50 text-slate-600';

  return (
    <button
      onClick={() => {
        if (!notification.is_read) {
          onMarkRead(notification.id);
        }
        // Backend computes `link` (notifications.py _compute_notification_link).
        router.push(notification.link || '/notifications');
      }}
      className={cn(
        'w-full flex items-start gap-3 p-4 rounded-lg border transition-colors text-left',
        notification.is_read
          ? 'bg-white border-slate-200 hover:bg-slate-50'
          : 'bg-brand-50/30 border-brand-200 hover:bg-brand-50/50'
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          iconColor
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4
            className={cn(
              'text-sm',
              notification.is_read
                ? 'text-slate-700'
                : 'text-slate-900 font-medium'
            )}
          >
            {notification.title}
          </h4>
          {!notification.is_read && (
            <span className="h-2 w-2 rounded-full bg-brand-500 shrink-0 mt-1.5" />
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <span className="text-xs text-slate-400 mt-1 block">
          {formatRelativeTime(notification.created_at)}
        </span>
      </div>
    </button>
  );
}

// ─── Page Component ────────────────────────────────────────────

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<NotificationListResult>({
    queryKey: ['notifications'],
    queryFn: () => getNotifications({ page_size: 50 }),
  });

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = data?.items ?? [];
  // Use the authoritative server-side total (a separate COUNT query, independent
  // of page_size) so the badge stays correct when there are >50 unread and
  // agrees with the bell. Fall back to the local filter only before data loads.
  const unreadCount =
    data?.unread_count ?? notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      {/* Header */}
      <PageHeader
        icon={Bell}
        title={
          <span className="flex items-center gap-3">
            Thông báo
            {unreadCount > 0 && (
              <Badge variant="danger">{unreadCount} chưa đọc</Badge>
            )}
          </span>
        }
        subtitle="Cập nhật và thông báo hệ thống"
        actions={
          unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              loading={markAllMutation.isPending}
              onClick={() => markAllMutation.mutate()}
            >
              <CheckCheck className="h-4 w-4" />
              Đánh dấu tất cả đã đọc
            </Button>
          ) : undefined
        }
        className="mb-6"
      />

      {/* Notification list */}
      {isLoading ? (
        <NotificationSkeleton />
      ) : notifications.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={BellOff}
            heading="Không có thông báo"
            description="Bạn sẽ nhận được thông báo khi có cập nhật mới"
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={(id) => markReadMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Pagination info */}
      {data && data.total > 0 && (
        <div className="mt-4 text-sm text-slate-500 text-center">
          Hiển thị {notifications.length} / {data.total} thông báo
        </div>
      )}
    </div>
  );
}
