'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface UserInfo {
  company_name: string;
  full_name: string;
  vendor_id: number;
}

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/quotes', label: 'Báo giá' },
  { href: '/profile', label: 'Hồ sơ' },
];

export default function PortalNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('vendor_user');
    if (!stored) {
      router.replace('/login');
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('vendor_token');
    localStorage.removeItem('vendor_user');
    window.location.href = '/login';
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo + nav */}
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">SC</span>
            </div>
            <span className="font-bold text-slate-800 text-base">Song Châu</span>
            <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-medium hidden sm:inline">
              Nhà Cung Cấp
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {NAV_LINKS.map(link => {
              const isActive =
                link.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
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
            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors font-medium"
          >
            Đăng xuất
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden border-t border-slate-100 px-4 pb-2 pt-1 flex gap-1">
        {NAV_LINKS.map(link => {
          const isActive =
            link.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 text-center py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
