'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { getSidebarConfig, type SidebarSection, ROLE_LABELS } from '@/lib/constants';

const COLLAPSED_KEY = 'sidebar_collapsed';

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [sections, setSections] = useState<SidebarSection[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Auto-collapse on small viewports (mobile/tablet) so the sidebar
    // doesn't eat 65% of a 375px screen. User preference still wins on
    // desktop via localStorage.
    const stored = localStorage.getItem(COLLAPSED_KEY);
    const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1024;
    if (stored === 'true' || isNarrow) setCollapsed(true);

    if (typeof window !== 'undefined') {
      const onResize = () => {
        if (window.innerWidth < 1024) setCollapsed(true);
        else if (localStorage.getItem(COLLAPSED_KEY) !== 'true') setCollapsed(false);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
  }, []);

  useEffect(() => {
    if (user?.role) setSections(getSidebarConfig(user.role));
  }, [user?.role]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  const handleLogout = async () => {
    try { await logout?.(); } catch {}
    router.push('/login');
  };

  const initials = (user?.full_name || user?.display_name || user?.email || 'U')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside
      className={cn(
        'h-screen bg-white border-r border-slate-200/80 flex flex-col flex-shrink-0',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-[68px]' : 'w-[244px]',
      )}
    >
      {/* ─── Brand ──────────────────────────────────────────── */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 group">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm shadow-sky-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm tracking-tight">SC</span>
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-[15px] font-bold text-slate-900 truncate">Song Châu</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 font-semibold">ERP</div>
            </div>
          )}
        </Link>
        <button
          onClick={toggleCollapsed}
          className={cn(
            'p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0',
            collapsed && 'absolute right-1.5',
          )}
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ─── Navigation ─────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5 sidebar-scroll">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-0.5">
            {section.title && !collapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 select-none">
                {section.title}
              </div>
            )}
            {section.title && collapsed && sIdx > 0 && (
              <div className="mx-2 my-2 border-t border-slate-100" />
            )}

            {section.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' &&
                 item.href !== '/bqms' &&
                 pathname.startsWith(item.href));

              const Icon = item.icon;

              return (
                <Link
                  key={`${item.key}-${item.href}`}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all',
                    collapsed ? 'h-10 w-10 mx-auto justify-center' : 'px-3 py-2',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[17px] w-[17px] flex-shrink-0 transition-transform',
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700',
                      'group-hover:scale-105',
                    )}
                    strokeWidth={isActive ? 2.2 : 1.8}
                  />
                  {!collapsed && (
                    <span className="min-w-0 flex-1 truncate leading-none mt-px">{item.label}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ─── User profile footer ─────────────────────────────── */}
      <div className="border-t border-slate-100 p-2 relative flex-shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'w-full flex items-center gap-3 rounded-lg p-2 hover:bg-slate-100/70 transition group',
            collapsed && 'justify-center',
          )}
        >
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 ring-2 ring-white">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
                {user?.full_name || user?.display_name || 'Người dùng'}
              </div>
              <div className="text-[10px] text-slate-500 truncate uppercase tracking-[0.06em] font-medium mt-0.5">
                {user?.role ? ROLE_LABELS[user.role] : ''}
              </div>
            </div>
          )}
        </button>

        {/* Popup menu */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div
              className={cn(
                'absolute z-50 bottom-full mb-2 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 min-w-[200px]',
                collapsed ? 'left-full ml-2' : 'left-2 right-2',
              )}
            >
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
              >
                <SettingsIcon className="h-4 w-4 text-slate-400" />
                <span>Cài đặt</span>
              </Link>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Custom scrollbar for the nav */}
      <style jsx>{`
        .sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgb(226 232 240);
          border-radius: 999px;
        }
        .sidebar-scroll:hover::-webkit-scrollbar-thumb { background: rgb(203 213 225); }
      `}</style>
    </aside>
  );
}
