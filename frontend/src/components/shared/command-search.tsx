'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Clock, Package, ArrowLeft, ExternalLink, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { getSidebarConfig } from '@/lib/constants';
import { api } from '@/lib/api';

interface PageEntry {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
}

interface BqmsSuggestion {
  bqms_code: string;
  specification: string | null;
  maker: string | null;
  rfq_count: number;
  last_inquiry: string | null;
}

interface PriceDetail {
  bqms_code: string;
  internal_quotes: Array<{
    id: number;
    inquiry_date: string | null;
    v1: number | null;
    v2: number | null;
    v3: number | null;
    v4: number | null;
    result: string | null;
    item_type: string | null;
    maker: string | null;
    specification: string | null;
  }>;
  market_90d: {
    n: number;
    min_usd: number | null;
    max_usd: number | null;
    median_usd: number | null;
    avg_usd: number | null;
  };
  market_all_time: {
    n: number;
    median_usd: number | null;
  };
  competitors: Array<{ seller_name: string; n: number; avg_usd: number | null }>;
  recent_wins: Array<{
    po_number: string;
    po_date: string | null;
    unit_price: number | null;
    qty: number | null;
  }>;
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
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const fmtUSD = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `$${Number(v).toFixed(2)}`;

export function CommandSearch() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [bqmsSuggestions, setBqmsSuggestions] = useState<BqmsSuggestion[]>([]);
  const [priceDetail, setPriceDetail] = useState<PriceDetail | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const lookupSeqRef = useRef(0);

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
      setPriceDetail(null);
      setBqmsSuggestions([]);
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

  const filteredPages = useMemo(() => {
    if (!normalizedSearch) return [];
    return allPages.filter(
      (page) =>
        normalizeKeyword(page.label).includes(normalizedSearch) ||
        page.keywords.some((keyword) => keyword.includes(normalizedSearch)),
    );
  }, [allPages, normalizedSearch]);

  const recentPages = useMemo(() => {
    if (normalizedSearch) return [];
    return recentHrefs
      .map((href) => allPages.find((page) => page.href === href))
      .filter(Boolean) as PageEntry[];
  }, [allPages, normalizedSearch, recentHrefs]);

  // Debounced BQMS code suggestions
  useEffect(() => {
    if (priceDetail) return;
    if (!query || query.trim().length < 2) {
      setBqmsSuggestions([]);
      return;
    }
    const seq = ++lookupSeqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: BqmsSuggestion[] }>(
          `/api/v1/price-lookup/search?q=${encodeURIComponent(query)}&limit=6`,
        );
        if (seq === lookupSeqRef.current) setBqmsSuggestions(res.items || []);
      } catch {
        if (seq === lookupSeqRef.current) setBqmsSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, priceDetail]);

  // Build flat list for keyboard nav — pages first, then codes
  const displayItems = useMemo(() => {
    if (priceDetail) return [];
    if (!normalizedSearch) {
      return recentPages.map((p) => ({ type: 'page' as const, page: p }));
    }
    return [
      ...filteredPages.map((p) => ({ type: 'page' as const, page: p })),
      ...bqmsSuggestions.map((b) => ({ type: 'bqms' as const, bqms: b })),
    ];
  }, [priceDetail, normalizedSearch, recentPages, filteredPages, bqmsSuggestions]);

  const navigate = useCallback(
    (href: string) => {
      addRecentItem(href);
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const lookupCode = useCallback(async (code: string) => {
    setPriceLoading(true);
    setPriceDetail(null);
    try {
      const res = await api.get<PriceDetail>(`/api/v1/price-lookup/${encodeURIComponent(code)}`);
      setPriceDetail(res);
    } catch (err) {
      console.error('price-lookup failed', err);
    } finally {
      setPriceLoading(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (priceDetail) {
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
          event.preventDefault();
          setPriceDetail(null);
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter' && displayItems[activeIndex]) {
        event.preventDefault();
        const item = displayItems[activeIndex];
        if (item.type === 'page') navigate(item.page.href);
        else lookupCode(item.bqms.bqms_code);
      }
    },
    [activeIndex, displayItems, navigate, lookupCode, priceDetail],
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
        <span>Tìm trang, mã BQMS...</span>
        <kbd className="ml-2 pointer-events-none select-none rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Tìm kiếm trang & tra cứu giá</DialogTitle>

          <div className="flex items-center gap-3 px-4 border-b border-slate-100">
            {priceDetail && (
              <button
                onClick={() => setPriceDetail(null)}
                className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                aria-label="Quay lại"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={priceDetail ? priceDetail.bqms_code : 'Tìm trang hoặc nhập mã BQMS...'}
              className="flex-1 h-12 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
              autoFocus
              disabled={!!priceDetail}
            />
            {priceDetail && (
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(`/tra-cuu-gia?code=${encodeURIComponent(priceDetail.bqms_code)}`);
                }}
                className="flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 flex-shrink-0"
              >
                Chi tiết <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {/* PRICE DETAIL VIEW */}
            {priceDetail && (
              <div className="p-4 space-y-5">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-lg font-bold text-slate-900">{priceDetail.bqms_code}</span>
                    {priceDetail.internal_quotes[0]?.item_type && (
                      <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {priceDetail.internal_quotes[0].item_type}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {priceDetail.internal_quotes[0]?.specification || '—'}
                    {priceDetail.internal_quotes[0]?.maker && ` · ${priceDetail.internal_quotes[0].maker}`}
                  </div>
                </div>

                <Section title="Giá nội bộ gần nhất" count={priceDetail.internal_quotes.length}>
                  {priceDetail.internal_quotes.length === 0 ? (
                    <EmptyHint>Chưa có báo giá nội bộ</EmptyHint>
                  ) : (
                    <div className="space-y-1">
                      {priceDetail.internal_quotes.map((q) => (
                        <div key={q.id} className="grid grid-cols-6 gap-2 text-xs items-center py-1.5 px-2 rounded hover:bg-slate-50">
                          <div className="col-span-2 text-slate-500 font-mono">{q.inquiry_date || '—'}</div>
                          <div>v1 {fmtUSD(q.v1)}</div>
                          <div>v2 {fmtUSD(q.v2)}</div>
                          <div>v3 {fmtUSD(q.v3)}</div>
                          <div className={
                            q.result === 'won' ? 'text-emerald-700 font-medium' :
                            q.result === 'lost' ? 'text-rose-700' : 'text-slate-400'
                          }>{q.result || '—'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Giá thị trường (XNK 90 ngày)" count={priceDetail.market_90d.n}>
                  {priceDetail.market_90d.n === 0 ? (
                    priceDetail.market_all_time.n > 0 ? (
                      <div className="text-xs text-slate-500">
                        Không có dữ liệu 90 ngày. All-time: median {fmtUSD(priceDetail.market_all_time.median_usd)} (n={priceDetail.market_all_time.n})
                      </div>
                    ) : (
                      <EmptyHint>Không có dữ liệu XNK cho mã này</EmptyHint>
                    )
                  ) : (
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <Stat label="Median" value={fmtUSD(priceDetail.market_90d.median_usd)} />
                      <Stat label="Avg" value={fmtUSD(priceDetail.market_90d.avg_usd)} />
                      <Stat label="Min" value={fmtUSD(priceDetail.market_90d.min_usd)} />
                      <Stat label="Max" value={fmtUSD(priceDetail.market_90d.max_usd)} />
                    </div>
                  )}
                </Section>

                {priceDetail.competitors.length > 0 && (
                  <Section title="Đối thủ" count={priceDetail.competitors.length}>
                    <div className="space-y-1">
                      {priceDetail.competitors.slice(0, 5).map((c, i) => (
                        <div key={i} className="grid grid-cols-5 gap-2 text-xs py-1 px-2 rounded hover:bg-slate-50">
                          <div className="col-span-3 truncate text-slate-700">{c.seller_name}</div>
                          <div className="tabular-nums">{fmtUSD(c.avg_usd)}</div>
                          <div className="text-slate-400 text-right">{c.n} lần</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {priceDetail.recent_wins.length > 0 && (
                  <Section title="PO trúng gần nhất" count={priceDetail.recent_wins.length}>
                    <div className="space-y-1">
                      {priceDetail.recent_wins.map((w, i) => (
                        <div key={i} className="grid grid-cols-5 gap-2 text-xs py-1 px-2 rounded hover:bg-slate-50">
                          <div className="text-slate-500 font-mono">{w.po_date || '—'}</div>
                          <div className="col-span-2 truncate">{w.po_number}</div>
                          <div className="tabular-nums">{fmtUSD(w.unit_price)}</div>
                          <div className="text-slate-400 text-right">{w.qty ? Math.round(w.qty) : '—'}</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )}

            {/* LOADING */}
            {priceLoading && !priceDetail && (
              <div className="p-4 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            )}

            {/* SEARCH LIST */}
            {!priceDetail && !priceLoading && (
              <div className="p-2">
                {!normalizedSearch && recentPages.length > 0 && (
                  <SectionLabel>Gần đây</SectionLabel>
                )}
                {normalizedSearch && filteredPages.length > 0 && (
                  <SectionLabel>Trang</SectionLabel>
                )}

                {displayItems.map((item, index) => {
                  if (item.type === 'page') {
                    const Icon = item.page.icon;
                    const isRecent = !normalizedSearch;
                    return (
                      <button
                        key={`p-${item.page.href}`}
                        onClick={() => navigate(item.page.href)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                          activeIndex === index ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                        )}
                      >
                        {isRecent ? <Clock className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1 truncate">{item.page.label}</span>
                        {activeIndex === index && <kbd className="text-[10px] font-mono text-slate-400">Enter</kbd>}
                      </button>
                    );
                  }
                  // bqms
                  const b = item.bqms;
                  // label for BQMS section — only show once above first bqms item
                  const isFirstBqms = index === 0 || displayItems[index - 1].type !== 'bqms';
                  return (
                    <div key={`b-${b.bqms_code}`}>
                      {isFirstBqms && <SectionLabel className="mt-2">Mã BQMS — tra giá</SectionLabel>}
                      <button
                        onClick={() => lookupCode(b.bqms_code)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                          activeIndex === index ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                        )}
                      >
                        <Package className="h-4 w-4 flex-shrink-0 text-sky-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm font-semibold text-slate-900 truncate">{b.bqms_code}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {b.specification || '—'}
                            {b.maker && ` · ${b.maker}`}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">{b.rfq_count} RFQ</span>
                        {activeIndex === index && <kbd className="text-[10px] font-mono text-slate-400">Enter</kbd>}
                      </button>
                    </div>
                  );
                })}

                {normalizedSearch && filteredPages.length === 0 && bqmsSuggestions.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400">Không tìm thấy trang hoặc mã nào</p>
                  </div>
                )}

                {!normalizedSearch && recentPages.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400">Nhập để tìm trang hoặc mã BQMS</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            {priceDetail ? (
              <>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Esc</kbd> quay lại
                </span>
                <span className="ml-auto text-[10px] text-slate-400">Tra cứu giá · Song Chau ERP</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">↑↓</kbd> di chuyển
                </span>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Enter</kbd> mở
                </span>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Esc</kbd> đóng
                </span>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400', className)}>
      {children}
    </p>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {count > 0 && <span className="text-xs text-slate-400">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-slate-400 italic py-1">{children}</div>;
}
