'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { getSidebarConfig, type SidebarSection } from '@/lib/constants';

const COLLAPSED_KEY = 'sidebar_collapsed';

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [sections, setSections] = useState<SidebarSection[]>([]);

  // Load collapsed preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === 'true') setCollapsed(true);
  }, []);

  // Build nav sections from role
  useEffect(() => {
    if (user?.role) {
      setSections(getSidebarConfig(user.role));
    }
  }, [user?.role]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  return (
    <aside
      className={cn(
        'h-screen bg-white border-r border-slate-200 flex flex-col transition-all duration-200 ease-in-out flex-shrink-0',
        collapsed ? 'w-[60px]' : 'w-[240px]'
      )}
    >
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-slate-100">
        {!collapsed && (
          <span className="text-sm font-display font-bold text-brand-600 truncate">
            Song Châu
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          className={cn(
            'p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors',
            collapsed && 'mx-auto'
          )}
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className="mb-2">
            {/* Section title */}
            {section.title && !collapsed && (
              <p className="px-2 pt-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                {section.title}
              </p>
            )}
            {section.title && collapsed && sIdx > 0 && (
              <div className="mx-2 my-2 border-t border-slate-100" />
            )}

            {/* Items */}
            {section.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && item.href !== '/bqms' && pathname.startsWith(item.href));

              const Icon = item.icon;

              return (
                <Link
                  key={`${item.key}-${item.href}`}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-colors group',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    collapsed && 'justify-center px-0'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] flex-shrink-0',
                      isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
                    )}
                  />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer — collapsed user initial */}
      {collapsed && user && (
        <div className="p-2 border-t border-slate-100 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">
            {(user.display_name || user.full_name || 'U').charAt(0).toUpperCase()}
          </div>
        </div>
      )}
    </aside>
  );
}
