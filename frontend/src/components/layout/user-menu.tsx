'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Settings, ChevronDown } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

export function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  if (!user) return null;

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const displayName = user.display_name || user.full_name || user.email;
  const initial = displayName.charAt(0).toUpperCase();

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2.5 p-1.5 pr-2 rounded-lg transition-colors',
              'hover:bg-slate-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
            )}
            aria-label="Menu người dùng"
          >
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

            {/* Name + role (hidden on small screens) */}
            <div className="hidden lg:flex flex-col items-start min-w-0">
              <span className="text-sm font-medium text-slate-700 truncate leading-tight max-w-[120px]">
                {displayName}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wide leading-tight text-brand-600">
                {roleLabel}
              </span>
            </div>

            <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden lg:block" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          {/* User info header */}
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-slate-900 truncate">
                {displayName}
              </p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => router.push('/settings')}
              className="cursor-pointer"
            >
              <Settings className="h-4 w-4" />
              <span>Hồ sơ & Cài đặt</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setShowLogoutConfirm(true)}
            className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            <span>Đăng xuất</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Logout confirmation */}
      <ConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        title="Đăng xuất"
        description="Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?"
        confirmLabel="Đăng xuất"
        onConfirm={handleLogout}
        destructive
      />
    </>
  );
}
