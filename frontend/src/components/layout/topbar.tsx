'use client';

import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function Topbar() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const displayName = user.display_name || user.full_name || user.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 sticky top-0 z-30">
      {/* Left — Company name / breadcrumb placeholder */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base font-display font-bold text-slate-900 whitespace-nowrap">
          Song Châu ERP
        </h1>
        {/* Breadcrumb placeholder — can be wired later */}
        <span className="text-slate-300 hidden md:inline">/</span>
        <span className="text-sm text-slate-400 truncate hidden md:inline">
          Tổng quan
        </span>
      </div>

      {/* Right */}
      <div className="ml-auto flex items-center gap-2">
        {/* Notification bell */}
        <button
          className="relative p-2 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          title="Thông báo"
        >
          <Bell className="h-[18px] w-[18px]" />
          {/* Unread indicator — hidden by default */}
          {/* <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full" /> */}
        </button>

        {/* Separator */}
        <div className="h-6 w-px bg-slate-200 mx-1" />

        {/* User info */}
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
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

          {/* Name + role */}
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

          {/* Logout */}
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
