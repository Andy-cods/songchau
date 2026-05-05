'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Menu, Settings as SettingsIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { getSidebarConfig, type SidebarSection, ROLE_LABELS } from '@/lib/constants';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { NotificationBell } from '@/components/layout/notification-bell';
import { CommandSearch } from '@/components/shared/command-search';

/**
 * Horizontal top navigation. Replaces the legacy left-sidebar layout.
 * Each section from getSidebarConfig becomes a button with a hover/click
 * dropdown listing its items. Mobile (<lg) collapses everything into a
 * hamburger drawer.
 */
export function TopNav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [sections, setSections] = useState<SidebarSection[]>([]);
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [userMenu, setUserMenu] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user?.role) setSections(getSidebarConfig(user.role));
  }, [user?.role]);

  // Close everything when route changes
  useEffect(() => {
    setOpenSection(null);
    setMobileOpen(false);
    setUserMenu(false);
  }, [pathname]);

  if (!user) return null;

  const displayName = user.display_name || user.full_name || user.email;
  const initials = displayName
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const roleLabel = ROLE_LABELS[user.role] || user.role;

  const handleLogout = async () => {
    try { await logout?.(); } catch {}
    router.push('/login');
  };

  const isItemActive = (href: string) =>
    pathname === href ||
    (href !== '/dashboard' && href !== '/bqms' && pathname.startsWith(href));

  const isSectionActive = (section: SidebarSection) =>
    section.items.some((it) => isItemActive(it.href));

  // Hover handlers with small delay to feel deliberate, not flickery
  const onSectionEnter = (idx: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenSection(idx);
  };
  const onSectionLeave = () => {
    closeTimer.current = setTimeout(() => setOpenSection(null), 120);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-slate-200/70">
      <div className="h-14 px-3 lg:px-5 flex items-center gap-3">
        {/* ─── Brand ───────────────────────────────────────── */}
        <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0 group">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/25 flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="text-white font-bold text-sm tracking-tight">SC</span>
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="text-[15px] font-bold text-slate-900">Song Châu</div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-slate-400 font-semibold">ERP</div>
          </div>
        </Link>

        <div className="hidden lg:block w-px h-7 bg-slate-200" />

        {/* ─── Section dropdowns (desktop) ─────────────────── */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0">
          {sections.map((section, idx) => {
            const open = openSection === idx;
            const active = isSectionActive(section);
            return (
              <div
                key={section.title || idx}
                className="relative"
                onMouseEnter={() => onSectionEnter(idx)}
                onMouseLeave={onSectionLeave}
              >
                <button
                  onClick={() => setOpenSection(open ? null : idx)}
                  className={cn(
                    'flex items-center gap-1 px-3 h-9 rounded-lg text-[13px] font-medium transition-colors',
                    active
                      ? 'text-slate-900 bg-slate-100'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50',
                    open && 'bg-slate-100 text-slate-900',
                  )}
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <span className="whitespace-nowrap">{section.title}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-slate-400 transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>

                {/* Dropdown panel */}
                {open && (
                  <div
                    className="absolute top-full left-0 mt-1 min-w-[260px] bg-white rounded-xl border border-slate-200 shadow-lg shadow-slate-900/5 py-1.5"
                    role="menu"
                    onMouseEnter={() => onSectionEnter(idx)}
                    onMouseLeave={onSectionLeave}
                  >
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const itemActive = isItemActive(item.href);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={() => setOpenSection(null)}
                          role="menuitem"
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors mx-1 rounded-lg',
                            itemActive
                              ? 'bg-slate-900 text-white font-medium'
                              : 'text-slate-700 hover:bg-slate-50',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-4 w-4 flex-shrink-0',
                              itemActive ? 'text-white' : 'text-slate-400',
                            )}
                            strokeWidth={itemActive ? 2.2 : 1.8}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* ─── Right cluster ───────────────────────────────── */}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <div className="hidden md:block">
            <CommandSearch />
          </div>
          <NotificationBell />

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenu((v) => !v)}
              className="flex items-center gap-2 pl-1 pr-2 h-9 rounded-lg hover:bg-slate-100 transition-colors"
              aria-haspopup="menu"
              aria-expanded={userMenu}
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-xs font-bold ring-2 ring-white shadow-sm">
                {initials}
              </div>
              <div className="hidden xl:block text-left leading-tight max-w-[140px]">
                <div className="text-[12px] font-semibold text-slate-900 truncate">{displayName}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium truncate">
                  {roleLabel}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  'hidden xl:block h-3.5 w-3.5 text-slate-400 transition-transform',
                  userMenu && 'rotate-180',
                )}
              />
            </button>
            {userMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] bg-white rounded-xl border border-slate-200 shadow-lg shadow-slate-900/5 py-1.5">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{displayName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setUserMenu(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 mx-1 rounded-lg"
                  >
                    <SettingsIcon className="h-4 w-4 text-slate-400" />
                    <span>Cài đặt</span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50 mx-1 rounded-lg"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Optional breadcrumb row */}
      <div className="hidden md:block px-5 pb-2 -mt-1">
        <Breadcrumb />
      </div>

      {/* ─── Mobile drawer ────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-white shadow-2xl flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-900">Menu</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="h-4 w-4 text-slate-600" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
              {sections.map((section, sIdx) => (
                <div key={sIdx}>
                  <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    {section.title}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isItemActive(item.href);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium',
                            active
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-700 hover:bg-slate-50',
                          )}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="p-3 border-t border-slate-100">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100"
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
