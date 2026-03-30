'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  FileCheck,
  Package,
  Users,
  BarChart3,
  Settings,
  Building2,
  ClipboardList,
  Bell,
  Search,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── Page Registry ─────────────────────────────────────────────

interface PageEntry {
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
}

const ALL_PAGES: PageEntry[] = [
  {
    label: 'Tổng quan',
    href: '/dashboard',
    icon: LayoutDashboard,
    keywords: ['tong quan', 'dashboard', 'trang chu'],
  },
  {
    label: 'Đơn mua hàng',
    href: '/purchase-orders',
    icon: ShoppingCart,
    keywords: ['don mua hang', 'purchase order', 'po', 'mua hang'],
  },
  {
    label: 'Tạo đơn mua hàng',
    href: '/purchase-orders/new',
    icon: ShoppingCart,
    keywords: ['tao don', 'them don', 'new po', 'tao mua hang'],
  },
  {
    label: 'Vận chuyển',
    href: '/deliveries',
    icon: Truck,
    keywords: ['van chuyen', 'delivery', 'giao hang'],
  },
  {
    label: 'Phê duyệt',
    href: '/approvals',
    icon: FileCheck,
    keywords: ['phe duyet', 'approval', 'duyet'],
  },
  {
    label: 'Kho hàng',
    href: '/inventory',
    icon: Package,
    keywords: ['kho hang', 'inventory', 'ton kho'],
  },
  {
    label: 'BQMS',
    href: '/bqms',
    icon: ClipboardList,
    keywords: ['bqms', 'bao gia', 'dau thau'],
  },
  {
    label: 'Báo cáo',
    href: '/reports',
    icon: BarChart3,
    keywords: ['bao cao', 'report', 'thong ke'],
  },
  {
    label: 'Nhà cung cấp',
    href: '/suppliers',
    icon: Building2,
    keywords: ['nha cung cap', 'supplier', 'ncc'],
  },
  {
    label: 'Người dùng',
    href: '/users',
    icon: Users,
    keywords: ['nguoi dung', 'user', 'tai khoan'],
  },
  {
    label: 'Cài đặt',
    href: '/settings',
    icon: Settings,
    keywords: ['cai dat', 'settings', 'he thong'],
  },
  {
    label: 'Thông báo',
    href: '/notifications',
    icon: Bell,
    keywords: ['thong bao', 'notification'],
  },
];

const RECENT_KEY = 'cmd_recent';
const MAX_RECENT = 5;

function getRecentItems(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentItem(href: string) {
  const recent = getRecentItems().filter((h) => h !== href);
  recent.unshift(href);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// ─── Component ─────────────────────────────────────────────────

export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);

  // Load recent items on open
  useEffect(() => {
    if (open) {
      setRecentHrefs(getRecentItems());
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Global keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const normalizedQuery = query.toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return [];
    return ALL_PAGES.filter(
      (page) =>
        page.label.toLowerCase().includes(normalizedQuery) ||
        page.keywords.some((kw) => kw.includes(normalizedQuery))
    );
  }, [normalizedQuery]);

  const recentPages = useMemo(() => {
    if (normalizedQuery) return [];
    return recentHrefs
      .map((href) => ALL_PAGES.find((p) => p.href === href))
      .filter(Boolean) as PageEntry[];
  }, [normalizedQuery, recentHrefs]);

  const displayItems = normalizedQuery ? filtered : recentPages;

  const navigate = useCallback(
    (href: string) => {
      addRecentItem(href);
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // Keyboard navigation inside the list
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && displayItems[activeIndex]) {
        e.preventDefault();
        navigate(displayItems[activeIndex].href);
      }
    },
    [displayItems, activeIndex, navigate]
  );

  // Reset active index on query change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 bg-white/70 text-sm text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors"
        aria-label="Tìm kiếm nhanh"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Tìm kiếm...</span>
        <kbd className="ml-2 pointer-events-none select-none rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
          Ctrl K
        </kbd>
      </button>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Tìm kiếm trang</DialogTitle>

          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-slate-100">
            <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm kiếm trang..."
              className="flex-1 h-12 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="max-h-72 overflow-y-auto p-2">
            {/* Section label */}
            {!normalizedQuery && recentPages.length > 0 && (
              <p className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                Gần đây
              </p>
            )}
            {normalizedQuery && filtered.length > 0 && (
              <p className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                Kết quả
              </p>
            )}

            {/* Items */}
            {displayItems.map((page, i) => {
              const Icon = page.icon;
              const isRecent = !normalizedQuery;
              return (
                <button
                  key={page.href}
                  onClick={() => navigate(page.href)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                    activeIndex === i
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {isRecent ? (
                    <Clock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  ) : (
                    <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  )}
                  <span className="flex-1 truncate">{page.label}</span>
                  {activeIndex === i && (
                    <kbd className="text-[10px] font-mono text-slate-400">Enter</kbd>
                  )}
                </button>
              );
            })}

            {/* Empty state */}
            {normalizedQuery && filtered.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">
                  Không tìm thấy trang nào
                </p>
              </div>
            )}

            {!normalizedQuery && recentPages.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">
                  Nhập để tìm kiếm trang
                </p>
              </div>
            )}
          </div>

          {/* Footer hints */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">↑↓</kbd>
              di chuyển
            </span>
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Enter</kbd>
              mở
            </span>
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Esc</kbd>
              đóng
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
