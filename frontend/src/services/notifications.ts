import { api } from '@/lib/api';
import type { PaginatedResponse, Notification } from '@/types/models';

export interface GetNotificationsParams {
  page?: number;
  page_size?: number;
  is_read?: boolean;
}

// Backend list envelope (notifications.py:100-104): { data, total, unread_count }.
// NOTE: there is NO `items` key — the page expects PaginatedResponse, so we map.
interface NotificationListEnvelope {
  data: Notification[];
  total: number;
  unread_count: number;
}

// PaginatedResponse + the extra unread_count the page/bell rely on.
export type NotificationListResult = PaginatedResponse<Notification> & {
  unread_count: number;
};

export async function getNotifications(
  params?: GetNotificationsParams
): Promise<NotificationListResult> {
  // Backend uses limit/offset; the page passes page/page_size — translate.
  const page = params?.page ?? 1;
  const pageSize = params?.page_size ?? 50;
  const query = new URLSearchParams();
  query.set('limit', String(pageSize));
  query.set('offset', String((page - 1) * pageSize));
  if (params?.is_read !== undefined) {
    query.set('is_read', String(params.is_read));
  }

  const resp = await api.get<NotificationListEnvelope>(
    `/api/v1/notifications?${query.toString()}`
  );

  const total = resp.total ?? resp.data?.length ?? 0;
  return {
    items: resp.data ?? [],
    total,
    unread_count: resp.unread_count ?? 0,
    page,
    page_size: pageSize,
    total_pages: pageSize > 0 ? Math.ceil(total / pageSize) : 1,
  };
}

export async function markAsRead(id: string): Promise<void> {
  // Backend route is PUT /{id}/read (notifications.py:107).
  await api.put(`/api/v1/notifications/${id}/read`, {});
}

export async function markAllAsRead(): Promise<void> {
  // Backend route is PUT /read-all (notifications.py:130).
  await api.put('/api/v1/notifications/read-all', {});
}

// There is no GET /unread-count route. Derive the count from the list envelope,
// mirroring what notification-bell.tsx does.
export async function getUnreadCount(): Promise<{ count: number }> {
  const resp = await getNotifications({ page_size: 1 });
  return { count: resp.unread_count };
}
