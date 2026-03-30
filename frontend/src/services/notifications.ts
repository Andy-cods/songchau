import { api } from '@/lib/api';
import type { PaginatedResponse, Notification } from '@/types/models';

export interface GetNotificationsParams {
  page?: number;
  page_size?: number;
  is_read?: boolean;
}

export async function getNotifications(
  params?: GetNotificationsParams
): Promise<PaginatedResponse<Notification>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<Notification>>(
    `/api/v1/notifications${query}`
  );
}

export async function markAsRead(id: string): Promise<Notification> {
  return api.patch<Notification>(`/api/v1/notifications/${id}/read`);
}

export async function markAllAsRead(): Promise<void> {
  return api.post('/api/v1/notifications/read-all');
}

export async function getUnreadCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>('/api/v1/notifications/unread-count');
}
