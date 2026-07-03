'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { Notification } from '@/types/models';

// Thang 2026-05-22: 30s → 90s — bell không cần realtime quá gấp,
// giảm tải sc-api khi nhiều tab mở.
const POLL_INTERVAL = 90_000;
const LIMIT = 10;

interface NotificationsResponse {
  data?: Notification[];
  items?: Notification[];
  unread_count: number;
  total?: number;
}

export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<NotificationsResponse>(
        `/api/v1/notifications?limit=${LIMIT}`
      );
      setNotifications(data.data ?? data.items ?? []);
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  // Click item: mark read first → navigate
  const handleNotificationClick = async (n: Notification) => {
    if (!n.is_read) {
      // Optimistic — mark read locally, fire-and-forget request
      setNotifications((arr) => arr.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
      try { await api.put(`/api/v1/notifications/${n.id}/read`, {}); } catch { /* non-blocking */ }
    }
    setOpen(false);
    router.push(n.link || '/notifications');
  };

  // Delete single notification (X icon)
  const handleDeleteOne = async (e: React.MouseEvent, n: Notification) => {
    e.stopPropagation();
    if (busy) return;
    setNotifications((arr) => arr.filter((x) => x.id !== n.id));
    if (!n.is_read) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.delete(`/api/v1/notifications/${n.id}`);
    } catch {
      toast.error('Không xoá được — đã hoàn tác');
      fetchNotifications();
    }
  };

  // Mark all read
  const handleMarkAllRead = async () => {
    if (busy || unreadCount === 0) return;
    setBusy(true);
    setNotifications((arr) => arr.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try {
      await api.put('/api/v1/notifications/read-all', {});
      toast.success('Đã đánh dấu đã đọc tất cả');
    } catch {
      toast.error('Không thực hiện được');
      fetchNotifications();
    } finally { setBusy(false); }
  };

  // Delete all read
  const handleDeleteAllRead = async () => {
    if (busy) return;
    setBusy(true);
    setNotifications((arr) => arr.filter((x) => !x.is_read));
    try {
      const r = await api.delete<{ data: { deleted: number } }>('/api/v1/notifications/read');
      toast.success(`Đã xoá ${r.data?.deleted ?? 0} thông báo đã đọc`);
    } catch {
      toast.error('Không xoá được');
      fetchNotifications();
    } finally { setBusy(false); }
  };

  const handleViewAll = () => {
    setOpen(false);
    router.push('/notifications');
  };

  const hasRead = notifications.some((n) => n.is_read);

  return (
    <div className="relative" ref={dropdownRef}>
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
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute right-0 top-full mt-2 w-[380px] z-50',
            'bg-white rounded-xl border border-slate-200 ring-1 ring-slate-100 shadow-xl shadow-slate-900/10',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 overflow-hidden'
          )}
          role="menu"
        >
          {/* Header with action row */}
          <div className="border-b border-slate-100 bg-slate-50/80">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center">
                  <Bell className="h-4 w-4 text-brand-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Thông báo</h3>
                  {unreadCount > 0 && (
                    <p className="text-[11px] text-brand-600 font-semibold">{unreadCount} chưa đọc</p>
                  )}
                </div>
              </div>
            </div>
            {/* Action buttons row */}
            {(unreadCount > 0 || hasRead) && (
              <div className="flex items-center gap-1 px-3 py-1.5 border-t border-slate-100">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <CheckCheck className="h-3 w-3" /> Đã đọc tất cả
                  </button>
                )}
                {hasRead && (
                  <button
                    onClick={handleDeleteAllRead}
                    disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700 rounded-md transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Xoá đã đọc
                  </button>
                )}
              </div>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <div className="h-12 w-12 mx-auto mb-3 rounded-xl bg-slate-100 ring-1 ring-slate-200/60 flex items-center justify-center">
                  <Bell className="h-6 w-6 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500">Chưa có thông báo</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={cn(
                    'group/notif relative flex items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors border-b border-slate-50 last:border-0',
                    'hover:bg-slate-50/80',
                    !n.is_read && 'bg-brand-50/40 hover:bg-brand-50/60'
                  )}
                  role="menuitem"
                >
                  {/* Unread dot */}
                  <div className="pt-1.5 flex-shrink-0">
                    <div className={cn('h-2 w-2 rounded-full', n.is_read ? 'bg-slate-200' : 'bg-brand-500 ring-2 ring-brand-200')} />
                  </div>
                  <div className="min-w-0 flex-1 pr-5">
                    <p className={cn('text-sm leading-snug', n.is_read ? 'text-slate-600' : 'text-slate-900 font-semibold')}>
                      {n.title}
                    </p>
                    {n.message && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-1 font-medium">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                  {/* Delete X */}
                  <button
                    onClick={(e) => handleDeleteOne(e, n)}
                    className="absolute top-2 right-2 h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover/notif:opacity-100 transition-all"
                    aria-label="Xoá thông báo"
                    title="Xoá"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/60">
            <button
              onClick={handleViewAll}
              className="w-full px-4 py-2.5 text-xs font-semibold text-brand-700 hover:text-brand-800 hover:bg-slate-100/80 transition-colors text-center"
              role="menuitem"
            >
              Xem tất cả thông báo →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
