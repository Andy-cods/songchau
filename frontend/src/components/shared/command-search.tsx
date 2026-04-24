'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Clock, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { getSidebarConfig } from '@/lib/constants';

interface PageEntry {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
}

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
  const recent = getRecentItems().filter((itemHref) => itemHref !== href);
  recent.unshift(href);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function normalizeKeyword(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function CommandSearch() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);

  const allPages = useMemo<PageEntry[]>(() => {
    const sections = getSidebarConfig(user?.role ?? 'viewer');
    const uniquePages = new Map<string, PageEntry>();

    for (const section of sections) {
      for (const item of section.items) {
        if (uniquePages.has(item.href)) continue;

        const keywords = new Set<string>([
          normalizeKeyword(item.label),
          normalizeKeyword(item.key),
          normalizeKeyword(section.title || ''),
        ]);

        uniquePages.set(item.href, {
          key: item.key,
          label: item.label,
          href: item.href,
          icon: item.icon,
          keywords: Array.from(keywords).filter(Boolean),
        });
      }
    }

    return Array.from(uniquePages.values());
  }, [user?.role]);

  useEffect(() => {
    if (open) {
      setRecentHrefs(getRecentItems());
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const normalizedSearch = normalizeKeyword(query);

  const filtered = useMemo(() => {
    if (!normalizedSearch) return [];
    return allPages.filter(
      (page) =>
        normalizeKeyword(page.label).includes(normalizedSearch) ||
        page.keywords.some((keyword) => keyword.includes(normalizedSearch))
    );
  }, [allPages, normalizedSearch]);

  const recentPages = useMemo(() => {
    if (normalizedSearch) return [];
    return recentHrefs
      .map((href) => allPages.find((page) => page.href === href))
      .filter(Boolean) as PageEntry[];
  }, [allPages, normalizedSearch, recentHrefs]);

  const displayItems = normalizedSearch ? filtered : recentPages;

  const navigate = useCallback(
    (href: string) => {
      addRecentItem(href);
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter' && displayItems[activeIndex]) {
        event.preventDefault();
        navigate(displayItems[activeIndex].href);
      }
    },
    [activeIndex, displayItems, navigate]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  return (
    <>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Tìm kiếm trang</DialogTitle>

          <div className="flex items-center gap-3 px-4 border-b border-slate-100">
            <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm kiếm trang..."
              className="flex-1 h-12 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {!normalizedSearch && recentPages.length > 0 && (
              <p className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                Gần đây
              </p>
            )}
            {normalizedSearch && filtered.length > 0 && (
              <p className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                Kết quả
              </p>
            )}

            {displayItems.map((page, index) => {
              const Icon = page.icon;
              const isRecent = !normalizedSearch;

              return (
                <button
                  key={page.href}
                  onClick={() => navigate(page.href)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                    activeIndex === index
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {isRecent ? (
                    <Clock className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  ) : (
                    <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{page.label}</span>
                  {activeIndex === index && (
                    <kbd className="text-[10px] font-mono text-slate-400">Enter</kbd>
                  )}
                </button>
              );
            })}

            {normalizedSearch && filtered.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">Không tìm thấy trang nào</p>
              </div>
            )}

            {!normalizedSearch && recentPages.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">Nhập để tìm kiếm trang</p>
              </div>
            )}
          </div>

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
