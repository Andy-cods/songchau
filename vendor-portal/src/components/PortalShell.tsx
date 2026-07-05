'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ScrollText,
  Package,
  Bell,
  BadgeCheck,
  User,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { BP } from '@/lib/base-path';
import { cn } from '@/lib/cn';
import type { NotificationsResponse } from '@/lib/types';

interface UserInfo {
  company_name: string;
  full_name: string;
  vendor_id: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Show the unread-notifications count pill on this row. */
  badge?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// ONE nav source — rendered by BOTH the fixed desktop sidebar and the mobile
// off-canvas drawer (no forked mobile markup). Routes/labels mirror the old
// PortalNav; icons + grouping per the sidebar redesign brief.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'CÔNG VIỆC',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/quotes', label: 'Báo giá', icon: FileText },
      { href: '/contracts', label: 'Hợp đồng', icon: ScrollText },
      { href: '/orders', label: 'Đơn hàng', icon: Package },
    ],
  },
  {
    label: 'TÀI KHOẢN',
    items: [
      { href: '/notifications', label: 'Thông báo', icon: Bell, badge: true },
      { href: '/nang-luc', label: 'Năng lực', icon: BadgeCheck },
      { href: '/profile', label: 'Hồ sơ', icon: User },
    ],
  },
];

// Poll the unread badge every 90s — simple + reliable, no websockets.
const NOTIF_POLL_MS = 90_000;

function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

/** Numeric unread pill (caps at "9+"). Rose alert tone per the brief. */
function NotifBadge({ unread }: { unread: number }) {
  if (unread <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white"
      aria-label={`${unread} thông báo chưa đọc`}
    >
      {unread > 9 ? '9+' : unread}
    </span>
  );
}

/**
 * The scrollable sidebar body — brand block, two nav groups, and the user
 * footer. Shared verbatim by the desktop rail and the mobile drawer so there is
 * a single nav source of truth.
 */
function SidebarBody({
  pathname,
  unread,
  user,
  onLogout,
  onNavigate,
}: {
  pathname: string;
  unread: number;
  user: UserInfo | null;
  onLogout: () => void;
  /** Called after a nav link click — used by the mobile drawer to close. */
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand block */}
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-100 px-4"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600">
          <span className="text-xs font-bold text-white">SC</span>
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-bold text-slate-800">Song Châu</div>
          <div className="truncate text-[11px] text-slate-400">Cổng Nhà Cung Cấp</div>
        </div>
      </Link>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && 'mt-6')}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                        active
                          ? 'bg-brand-50 text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-brand-600'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.badge && <NotifBadge unread={unread} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: user card + logout */}
      <div className="mt-auto border-t border-slate-100 p-3">
        {user && (
          <div className="mb-2 flex items-center gap-2.5 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100">
              <span className="text-sm font-bold text-brand-700">
                {user.company_name?.charAt(0)?.toUpperCase() ?? 'V'}
              </span>
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-slate-800">
                {user.company_name}
              </div>
              <div className="truncate text-[11px] text-slate-400">Nhà Cung Cấp</div>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </div>
  );
}

/**
 * PortalShell — the authenticated vendor-portal chrome.
 *
 * Replaces the old top-header PortalNav with a FIXED 240px left sidebar on lg+
 * and an off-canvas drawer on smaller screens. Owns the user (from localStorage),
 * the 90s unread-notifications poll and logout — logic lifted verbatim from
 * PortalNav so no data-fetching behaviour changes. Pages keep their own
 * `<main className="mx-auto max-w-[1400px] px-6 …">`; the shell only supplies the
 * `lg:pl-60` content offset.
 */
export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [unread, setUnread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  // landing on /notifications (which marks rows read) promptly refreshes the count.
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

  // Auto-close the mobile drawer on any route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem('vendor_token');
    localStorage.removeItem('vendor_user');
    window.location.href = `${BP}/login`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar (fixed) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <SidebarBody
          pathname={pathname}
          unread={unread}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 transition-opacity"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 border-r border-slate-200 bg-white shadow-xl">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Đóng menu"
              className="absolute right-2 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarBody
              pathname={pathname}
              unread={unread}
              user={user}
              onLogout={handleLogout}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Content column */}
      <div className="lg:pl-60">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Mở menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600">
                <span className="text-xs font-bold text-white">SC</span>
              </div>
              <span className="text-base font-bold text-slate-800">Song Châu</span>
            </Link>
          </div>
          <Link
            href="/notifications"
            aria-label="Thông báo"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span
                className="absolute right-1 top-1 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white"
                aria-label={`${unread} thông báo chưa đọc`}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
        </div>

        {children}
      </div>
    </div>
  );
}
