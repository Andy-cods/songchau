'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  FileCheck,
  Truck,
  AlertCircle,
  AtSign,
  CheckCheck,
} from 'lucide-react';
import { getNotifications, markAsRead, markAllAsRead } from '@/services/notifications';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Notification, NotificationType, PaginatedResponse } from '@/types/models';

// ─── Notification type icons ───────────────────────────────────

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  approval_request: FileCheck,
  approval_result: FileCheck,
  delivery_update: Truck,
  system: AlertCircle,
  mention: AtSign,
};

const TYPE_COLOR: Record<NotificationType, string> = {
  approval_request: 'bg-amber-50 text-amber-600',
  approval_result: 'bg-emerald-50 text-emerald-600',
  delivery_update: 'bg-cyan-50 text-cyan-600',
  system: 'bg-slate-50 text-slate-600',
  mention: 'bg-brand-50 text-brand-600',
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
  const Icon = TYPE_ICON[notification.type] || Bell;
  const iconColor = TYPE_COLOR[notification.type] || 'bg-slate-50 text-slate-600';

  return (
    <button
      onClick={() => {
        if (!notification.is_read) {
          onMarkRead(notification.id);
        }
        if (notification.link) {
          window.location.href = notification.link;
        }
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

  const { data, isLoading } = useQuery<PaginatedResponse<Notification>>({
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
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">
              Thông báo
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Cập nhật và thông báo hệ thống
            </p>
          </div>
          {unreadCount > 0 && (
            <Badge variant="danger">
              {unreadCount} chưa đọc
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            loading={markAllMutation.isPending}
            onClick={() => markAllMutation.mutate()}
          >
            <CheckCheck className="h-4 w-4" />
            Đánh dấu tất cả đã đọc
          </Button>
        )}
      </div>

      {/* Notification list */}
      {isLoading ? (
        <NotificationSkeleton />
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <EmptyState
            icon={BellOff}
            heading="Không có thông báo"
            description="Bạn sẽ nhận được thông báo khi có cập nhật mới"
          />
        </div>
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
