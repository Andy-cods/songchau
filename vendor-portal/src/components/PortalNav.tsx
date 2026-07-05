'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { BP } from '@/lib/base-path';
import type { NotificationsResponse } from '@/lib/types';

interface UserInfo {
  company_name: string;
  full_name: string;
  vendor_id: number;
}

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/quotes', label: 'Báo giá' },
  { href: '/contracts', label: 'Hợp đồng' },
  { href: '/orders', label: 'Đơn hàng' },
  { href: '/notifications', label: 'Thông báo' },
  { href: '/nang-luc', label: 'Năng lực' },
  { href: '/profile', label: 'Hồ sơ' },
];

// Poll the unread badge every 90s — simple + reliable, no websockets.
const NOTIF_POLL_MS = 90_000;

export default function PortalNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem('vendor_user');
    if (!stored) {
      router.replace('/login');
      return;
    }
    try {
      setUser(JSON.parse(stored));
    } catch {
      localStorage.removeItem('vendor_user');
      router.replace('/login');
    }
  }, [router]);

  // Unread-count badge poll (90s). Failures are swallowed silently so a transient
  // blip never disrupts the nav; the next tick recovers. Re-runs on pathname so
  // landing on /notifications (which marks rows read) promptly refreshes the dot.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const fetchUnread = () => {
      api
        .get<NotificationsResponse>('/api/vendor/notifications?limit=1')
        .then(res => {
          if (alive) setUnread(res.unread_count || 0);
        })
        .catch(() => {});
    };
    fetchUnread();
    const t = setInterval(fetchUnread, NOTIF_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user, pathname]);

  const handleLogout = () => {
    localStorage.removeItem('vendor_token');
    localStorage.removeItem('vendor_user');
    window.location.href = `${BP}/login`;
  };

  const renderLink = (link: (typeof NAV_LINKS)[number], mobile: boolean) => {
    const isActive =
      link.href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname.startsWith(link.href);
    const base = mobile
      ? 'flex-1 text-center py-1.5 rounded-md text-sm font-medium transition-colors'
      : 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors';
    const tone = isActive
      ? 'bg-brand-50 text-brand-700'
      : mobile
        ? 'text-slate-500 hover:text-slate-800'
        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100';
    const showDot = link.href === '/notifications' && unread > 0;
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={isActive ? 'page' : undefined}
        className={`relative ${base} ${tone}`}
      >
        {link.label}
        {showDot && (
          <span
            className="absolute top-1 right-1 inline-flex h-1.5 w-1.5 rounded-full bg-brand-500 ring-2 ring-white"
            aria-label={`${unread} thông báo chưa đọc`}
          />
        )}
      </Link>
    );
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo + nav */}
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">SC</span>
            </div>
            <span className="font-bold text-slate-800 text-base">Song Châu</span>
            <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium hidden sm:inline">
              Nhà Cung Cấp
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {NAV_LINKS.map(link => renderLink(link, false))}
          </nav>
        </div>

        {/* Right: user + logout */}
        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center">
                <span className="text-brand-700 text-xs font-bold">
                  {user.company_name?.charAt(0)?.toUpperCase() ?? 'V'}
                </span>
              </div>
              <span className="text-sm text-slate-600 max-w-[160px] truncate">
                {user.company_name}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Đăng xuất</span>
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden border-t border-slate-100 px-4 pb-2 pt-1 flex items-center gap-1">
        {user && (
          <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-slate-100 shrink-0">
            <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center">
              <span className="text-brand-700 text-[11px] font-bold">
                {user.company_name?.charAt(0)?.toUpperCase() ?? 'V'}
              </span>
            </div>
            <span className="text-xs text-slate-600 max-w-[96px] truncate">
              {user.company_name}
            </span>
          </div>
        )}
        {NAV_LINKS.map(link => renderLink(link, true))}
        <button
          onClick={handleLogout}
          aria-label="Đăng xuất"
          className="shrink-0 inline-flex items-center justify-center py-1.5 px-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
