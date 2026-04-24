'use client';

import { LogOut } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { NotificationBell } from '@/components/layout/notification-bell';
import { CommandSearch } from '@/components/shared/command-search';

export function Topbar() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const displayName = user.display_name || user.full_name || user.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base font-display font-bold text-slate-900 whitespace-nowrap">
          Song Châu ERP
        </h1>
        <span className="text-slate-300 hidden md:inline">/</span>
        <div className="hidden md:block min-w-0">
          <Breadcrumb />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <CommandSearch />
        <NotificationBell />

        <div className="h-6 w-px bg-slate-200 mx-1" />

        <div className="flex items-center gap-2.5">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={displayName}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">
              {initial}
            </div>
          )}

          <div className="hidden lg:flex flex-col min-w-0">
            <span className="text-sm font-medium text-slate-700 truncate leading-tight">
              {displayName}
            </span>
            <span
              className={cn(
                'text-[10px] font-mono uppercase tracking-wide leading-tight',
                'text-brand-600'
              )}
            >
              {roleLabel}
            </span>
          </div>

          <button
            onClick={logout}
            className="p-2 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Đăng xuất"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
