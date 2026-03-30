'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api';
import type { Notification } from '@/types/models';

const POLL_INTERVAL = 30_000; // 30 seconds

interface NotificationsResponse {
  items: Notification[];
  unread_count: number;
}

export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<NotificationsResponse>(
        '/api/v1/notifications?page_size=5'
      );
      setNotifications(data.items || []);
      setUnreadCount(data.unread_count || 0);
    } catch {
      // Silently fail — notifications are non-critical
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  const handleNotificationClick = (notification: Notification) => {
    setOpen(false);
    if (notification.link) {
      router.push(notification.link);
    } else {
      router.push('/notifications');
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    router.push('/notifications');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'relative p-2 rounded-md text-slate-400 transition-colors',
          'hover:bg-slate-100 hover:text-slate-600',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
        )}
        aria-label={`Thông báo${unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-[18px] w-[18px]" />
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full mt-2 w-80 z-50',
            'bg-white rounded-xl border border-slate-200 shadow-lg',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150'
          )}
          role="menu"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Thông báo
            </h3>
            {unreadCount > 0 && (
              <span className="text-xs text-brand-600 font-medium">
                {unreadCount} chưa đọc
              </span>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">
                  Chưa có thông báo
                </p>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex items-start gap-3 w-full px-4 py-3 text-left transition-colors',
                    'hover:bg-slate-50',
                    !notification.is_read && 'bg-brand-50/40'
                  )}
                  role="menuitem"
                >
                  {/* Unread dot */}
                  <div className="pt-1.5 flex-shrink-0">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        notification.is_read ? 'bg-transparent' : 'bg-brand-500'
                      )}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug truncate',
                        notification.is_read
                          ? 'text-slate-600'
                          : 'text-slate-900 font-medium'
                      )}
                    >
                      {notification.title}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {notification.message}
                    </p>
                    <p className="text-[10px] text-slate-300 mt-1">
                      {formatRelativeTime(notification.created_at)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100">
            <button
              onClick={handleViewAll}
              className="w-full px-4 py-2.5 text-xs font-medium text-brand-600 hover:bg-slate-50 transition-colors text-center"
              role="menuitem"
            >
              Xem tất cả thông báo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
