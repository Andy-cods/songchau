'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Clock, Package, ArrowLeft, ExternalLink, FileText, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  rfq_number: string | null;
  specification: string | null;
  maker: string | null;
  rfq_count: number;
  last_inquiry: string | null;
}

// Multi-category results from /api/v1/price-lookup/search/global
interface GlobalRfqRow {
  id: number;
  bqms_code: string;
  rfq_number: string | null;
  specification: string | null;
  maker: string | null;
  inquiry_date: string | null;
  result: string | null;
  quote_unlocked: boolean | null;
  classification: string | null;
}
interface GlobalDeliveryRow {
  id: number;
  po_number: string;
  bqms_code: string | null;
  shipping_no: string | null;
  quantity: number;
  actual_delivered_qty: number;
  delivery_status: string | null;
  delivery_date: string | null;
}
interface GlobalWonRow {
  id: number;
  bqms_code: string;
  rfq_number: string | null;
  won_price: number | null;
  won_at: string | null;
}
interface GlobalSupplierRow {
  id: number;
  name: string;
  tax_code: string | null;
  address: string | null;
}
// Thang 2026-06-04 (BUG A): RFQ-grouped suggestion (one entry per rfq_number).
// Surfaces in Ctrl+K as a top-level "Đơn hàng (RFQ)" group above bqms code matches
// so user can jump straight to /bqms?focus_rfq=<rfq_number> and auto-open drawer.
interface RfqSuggestion {
  rfq_number: string;
  subject: string | null;
  item_count: number;
  inquiry_date: string | null;
  has_quote: boolean;
  any_pending: boolean;
}
interface GlobalSearchResult {
  query: string;
  rfqs: GlobalRfqRow[];
  deliveries: GlobalDeliveryRow[];
  won_quotations: GlobalWonRow[];
  samsung_po: any[];
  suppliers: GlobalSupplierRow[];
  rfq?: RfqSuggestion[];
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
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [priceDetail, setPriceDetail] = useState<PriceDetail | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const lookupSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  // BQMS code paste detection (Thang 2026-05-22). Matches Samsung's format:
  //   Z0000002-385323 / RC01H00I-000413 / RG00H008-001592
  // i.e. 1-3 letters + 4-8 alnum + dash + 4-8 digits.
  const isLikelyBqmsCode = useCallback((s: string): boolean => {
    return /^[A-Z]{1,3}[A-Z0-9]{2,10}-?\d{2,10}$/i.test(s.trim());
  }, []);

  // Thang 2026-06-21 (search-qt): detect a QT/RFQ-shaped query (eg "QT26071059").
  // Samsung RFQ numbers are "QT" + digits. When the user types one, they want to
  // jump straight to that RFQ's drawer, not pick through the per-bqms_code rows.
  const isLikelyQtCode = useCallback((s: string): boolean => {
    return /^QT\d{4,}$/i.test(s.trim());
  }, []);

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

  // Global search across BQMS tables (Thang 2026-05-22)
  // Debounce 150ms — but if query looks like a pasted BQMS code, skip debounce
  // and fire immediately for instant feedback.
  useEffect(() => {
    if (priceDetail) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setGlobalResults(null);
      setBqmsSuggestions([]);
      return;
    }
    const seq = ++searchSeqRef.current;
    // Paste detection — code-like queries skip the debounce
    const delay = isLikelyBqmsCode(trimmed) ? 0 : 150;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<GlobalSearchResult>(
          `/api/v1/price-lookup/search/global?q=${encodeURIComponent(trimmed)}&limit=6`,
        );
        if (seq !== searchSeqRef.current) return;
        setGlobalResults(res);
        // Keep BqmsSuggestion shape for the existing tra-cứu-giá flow.
        // Map RFQ results into that shape using rfq_count = 1 placeholder.
        setBqmsSuggestions(
          (res.rfqs || []).map((r) => ({
            bqms_code: r.bqms_code,
            rfq_number: r.rfq_number,
            specification: r.specification,
            maker: r.maker,
            rfq_count: 0,
            last_inquiry: r.inquiry_date,
          })),
        );
      } catch (err) {
        if (seq === searchSeqRef.current) {
          setGlobalResults(null);
          setBqmsSuggestions([]);
        }
      } finally {
        if (seq === searchSeqRef.current) setSearchLoading(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [query, priceDetail, isLikelyBqmsCode]);

  // Thang 2026-06-21 (search-qt): the RFQ entry the typed query refers to.
  // A QT query (eg "QT26071059") returns BOTH a correct rfq-group row AND many
  // per-bqms_code "rfqs" rows. We must promote the rfq-group row to the top so
  // Enter / first-result lands on /bqms?focus_rfq=<rfq_number> (the drawer),
  // instead of the user clicking a prominent bqms_code row → single-code filter.
  const trimmedQuery = query.trim();
  const matchedRfq = useMemo<RfqSuggestion | null>(() => {
    const rfqs = globalResults?.rfq;
    if (!rfqs || rfqs.length === 0) return null;
    const q = trimmedQuery.toLowerCase();
    // 1) exact rfq_number match (query equals a returned rfq_number)
    const exact = rfqs.find((r) => (r.rfq_number ?? '').toLowerCase() === q);
    if (exact) return exact;
    // 2) QT-shaped query with a single RFQ group → treat that as the match
    if (isLikelyQtCode(trimmedQuery) && rfqs.length === 1) return rfqs[0];
    return null;
  }, [globalResults, trimmedQuery, isLikelyQtCode]);

  // Build flat list for keyboard nav — pages → RFQs → deliveries → won → suppliers
  const displayItems = useMemo(() => {
    if (priceDetail) return [];
    if (!normalizedSearch) {
      return recentPages.map((p) => ({ type: 'page' as const, page: p }));
    }
    const items: Array<
      | { type: 'page'; page: PageEntry }
      | { type: 'rfq'; rfq: RfqSuggestion }
      | { type: 'bqms'; bqms: BqmsSuggestion }
      | { type: 'delivery'; delivery: GlobalDeliveryRow }
      | { type: 'won'; won: GlobalWonRow }
      | { type: 'supplier'; supplier: GlobalSupplierRow }
    > = [];

    // Thang 2026-06-21 (search-qt): when the query is QT-shaped and resolves to
    // a single RFQ, that RFQ becomes the default-selected top item (activeIndex
    // 0) — BEFORE pages — so Enter routes straight to the drawer. The competing
    // per-bqms_code rows belonging to that RFQ are collapsed (dedupe) so they
    // don't outrank it; they remain available only as secondary entries.
    if (matchedRfq) {
      items.push({ type: 'rfq', rfq: matchedRfq });
    }

    items.push(...filteredPages.map((p) => ({ type: 'page' as const, page: p })));

    // Thang 2026-06-04 (BUG A): RFQ group BEFORE bqms — when user pastes an RFQ
    // number (eg QT26071059) they want to jump to that RFQ's drawer, not pick
    // through individual bqms_code rows.
    if (globalResults?.rfq) {
      for (const r of globalResults.rfq) {
        // Skip the promoted match — already at the top.
        if (matchedRfq && r.rfq_number === matchedRfq.rfq_number) continue;
        items.push({ type: 'rfq', rfq: r });
      }
    }

    // Thang 2026-06-21 (search-qt): dedupe the per-bqms_code rows that belong to
    // the matched RFQ. The /search/global rfqs rows carry rfq_number; any row
    // whose rfq_number === matchedRfq.rfq_number is collapsed into the RFQ group
    // above. Non-matching results are kept untouched.
    const matchedRfqNumbers = new Set<string>();
    if (matchedRfq && globalResults?.rfqs) {
      for (const r of globalResults.rfqs) {
        if (r.rfq_number === matchedRfq.rfq_number) {
          matchedRfqNumbers.add(r.bqms_code);
        }
      }
    }
    items.push(
      ...bqmsSuggestions
        .filter((b) => !matchedRfqNumbers.has(b.bqms_code))
        .map((b) => ({ type: 'bqms' as const, bqms: b })),
    );

    if (globalResults) {
      for (const d of globalResults.deliveries || []) {
        items.push({ type: 'delivery', delivery: d });
      }
      for (const w of globalResults.won_quotations || []) {
        items.push({ type: 'won', won: w });
      }
      for (const s of globalResults.suppliers || []) {
        items.push({ type: 'supplier', supplier: s });
      }
    }
    return items;
  }, [priceDetail, normalizedSearch, recentPages, filteredPages, bqmsSuggestions, globalResults, matchedRfq]);

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
        else if (item.type === 'rfq') {
          // Thang 2026-06-04 (BUG A): focus_rfq → /bqms page sets search +
          // clears year/month + auto-opens drawer on first matching row.
          navigate(`/bqms?focus_rfq=${encodeURIComponent(item.rfq.rfq_number)}`);
        }
        else if (item.type === 'bqms') {
          // Thang 2026-05-22: Enter navigates to /bqms?search=<code>
          // so the user lands on the BQMS table with the code pre-filtered
          // and can click "Báo giá" directly. Shift+Enter still opens the
          // price-detail panel (for quick price preview only).
          if (event.shiftKey) lookupCode(item.bqms.bqms_code);
          else navigate(`/bqms?search=${encodeURIComponent(item.bqms.bqms_code)}`);
        }
        else if (item.type === 'delivery') {
          // Thang 2026-06-01: navigate theo po_number + year=all để page hiển đúng
          // row PO bất kể năm. Trước đây dùng ?focus=<id> nhưng page không đọc param.
          const po = item.delivery.po_number ?? '';
          navigate(`/bqms/deliveries?po=${encodeURIComponent(po)}&year=all`);
        } else if (item.type === 'won') {
          navigate(`/bqms/won-quotations?focus=${item.won.id}`);
        } else if (item.type === 'supplier') {
          navigate(`/suppliers/${item.supplier.id}`);
        }
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
        className="hidden md:flex items-center gap-2.5 h-9 w-[220px] lg:w-[260px] xl:w-[300px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-500 hover:text-slate-900 hover:border-brand-400 hover:bg-brand-50/30 transition-all shadow-sm flex-shrink-0"
        aria-label="Tìm kiếm nhanh — Ctrl K"
      >
        <Search className="h-4 w-4 text-slate-400" />
        <span className="flex-1 text-left text-[13px] truncate">Tìm mã BQMS, RFQ, PO, NCC...</span>
        <kbd className="pointer-events-none select-none rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-mono font-medium text-slate-500 flex-shrink-0">
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Tìm kiếm trang & tra cứu giá</DialogTitle>
          <DialogDescription className="sr-only">
            Tìm mã BQMS, số PO, RFQ, nhà cung cấp. Enter để mở trang BQMS, Shift+Enter để xem giá nhanh.
          </DialogDescription>

          <div className="flex items-center gap-3 px-5 border-b border-slate-100">
            {priceDetail && (
              <button
                onClick={() => setPriceDetail(null)}
                className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                aria-label="Quay lại"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Search className="h-5 w-5 text-slate-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={priceDetail ? priceDetail.bqms_code : 'Mã BQMS, số RFQ, PO, tên NCC...'}
              className="flex-1 h-14 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 outline-none"
              autoFocus
              disabled={!!priceDetail}
            />
            {searchLoading && !priceDetail && (
              <span className="flex-shrink-0 text-xs text-slate-400 font-mono animate-pulse">
                đang tìm…
              </span>
            )}
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
                      <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
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
                            q.result === 'lost' ? 'text-rose-700' : 'text-slate-500'
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
                          <div className="text-slate-500 text-right">{c.n} lần</div>
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
                          <div className="text-slate-500 text-right">{w.qty ? Math.round(w.qty) : '—'}</div>
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

                {searchLoading && bqmsSuggestions.length === 0 && (globalResults?.deliveries.length ?? 0) === 0 && (
                  <div className="py-4 space-y-2 px-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                    ))}
                  </div>
                )}

                {displayItems.map((item, index) => {
                  // Helper to detect first item of each type (for section labels)
                  const isFirstOf = (type: string) =>
                    index === 0 || displayItems[index - 1].type !== type;
                  const isActive = activeIndex === index;
                  const activeCls = isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50';

                  if (item.type === 'page') {
                    const Icon = item.page.icon;
                    const isRecent = !normalizedSearch;
                    return (
                      <button
                        key={`p-${item.page.href}`}
                        onClick={() => navigate(item.page.href)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn('flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left', activeCls)}
                      >
                        {isRecent ? <Clock className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1 truncate">{item.page.label}</span>
                        {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                      </button>
                    );
                  }

                  if (item.type === 'rfq') {
                    const r = item.rfq;
                    // Status pill: emerald if has any quote, amber if pending, slate otherwise.
                    const pillClass = r.has_quote
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : r.any_pending
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200';
                    const pillLabel = r.has_quote
                      ? 'đã báo giá'
                      : r.any_pending
                        ? 'đang chờ'
                        : '—';
                    return (
                      <div key={`r-${r.rfq_number}`}>
                        {isFirstOf('rfq') && (
                          <SectionLabel className="mt-2">RFQ — Mở trang chi tiết</SectionLabel>
                        )}
                        <button
                          onClick={() =>
                            navigate(`/bqms?focus_rfq=${encodeURIComponent(r.rfq_number)}`)
                          }
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                            activeCls,
                          )}
                          title="Mở /bqms và bật drawer của RFQ này"
                        >
                          <FileText className="h-4 w-4 flex-shrink-0 text-brand-500" />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm font-semibold text-slate-900 truncate">
                              {r.rfq_number}
                              {r.subject && (
                                <span className="ml-2 font-sans font-normal text-slate-500 truncate">
                                  · {r.subject}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                {r.item_count} mã
                              </span>
                              <span
                                className={cn(
                                  'inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium',
                                  pillClass,
                                )}
                              >
                                {pillLabel}
                              </span>
                              {r.inquiry_date && (
                                <span className="text-[11px] text-slate-500 font-mono">
                                  {r.inquiry_date}
                                </span>
                              )}
                            </div>
                          </div>
                          {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                        </button>
                      </div>
                    );
                  }

                  if (item.type === 'bqms') {
                    const b = item.bqms;
                    return (
                      <div key={`b-${b.bqms_code}`}>
                        {isFirstOf('bqms') && (
                          <SectionLabel className="mt-2">Mã BQMS — mở trang để báo giá</SectionLabel>
                        )}
                        <button
                          onClick={(e) => {
                            if (e.shiftKey) lookupCode(b.bqms_code);
                            else navigate(`/bqms?search=${encodeURIComponent(b.bqms_code)}`);
                          }}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn('flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left group', activeCls)}
                          title="Enter / click: mở trang BQMS đã lọc · Shift+Enter / Shift+click: xem giá nhanh"
                        >
                          <Package className="h-4 w-4 flex-shrink-0 text-sky-500" />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm font-semibold text-slate-900 truncate">
                              {b.bqms_code}
                              {b.rfq_number && (
                                <span className="text-slate-500 font-normal"> · {b.rfq_number}</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {b.specification || '—'}{b.maker && ` · ${b.maker}`}
                            </div>
                          </div>
                          <span className="hidden group-hover:inline-flex text-[11px] text-sky-600 font-medium flex-shrink-0">
                            Shift = xem giá
                          </span>
                          {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                        </button>
                      </div>
                    );
                  }

                  if (item.type === 'delivery') {
                    const d = item.delivery;
                    const pending = (d.quantity || 0) - (d.actual_delivered_qty || 0);
                    return (
                      <div key={`d-${d.id}`}>
                        {isFirstOf('delivery') && <SectionLabel className="mt-2">Giao hàng</SectionLabel>}
                        <button
                          onClick={() => navigate(
                            `/bqms/deliveries?po=${encodeURIComponent(d.po_number ?? '')}&year=all`
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn('flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left', activeCls)}
                        >
                          <span className="text-brand-500 flex-shrink-0 text-base">🚚</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                              PO {d.po_number}
                              {d.bqms_code && <span className="text-slate-500"> · </span>}
                              {d.bqms_code && <span className="text-slate-700">{d.bqms_code}</span>}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {d.shipping_no ? `Ship #${d.shipping_no} · ` : ''}
                              SL {d.quantity} · đã giao {d.actual_delivered_qty}
                              {pending > 0 && <span className="text-amber-600"> · còn {pending}</span>}
                            </div>
                          </div>
                          {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                        </button>
                      </div>
                    );
                  }

                  if (item.type === 'won') {
                    const w = item.won;
                    return (
                      <div key={`w-${w.id}`}>
                        {isFirstOf('won') && <SectionLabel className="mt-2">Báo giá đã trúng</SectionLabel>}
                        <button
                          onClick={() => navigate(`/bqms/won-quotations?focus=${w.id}`)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn('flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left', activeCls)}
                        >
                          <span className="text-emerald-600 flex-shrink-0 text-base">🏆</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                              {w.bqms_code}
                              {w.rfq_number && <span className="text-slate-500"> · {w.rfq_number}</span>}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {w.won_at ? new Date(w.won_at).toLocaleDateString('vi-VN') : '—'}
                              {w.won_price && ` · ${w.won_price.toLocaleString('vi-VN')} VND`}
                            </div>
                          </div>
                          {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                        </button>
                      </div>
                    );
                  }

                  if (item.type === 'supplier') {
                    const s = item.supplier;
                    return (
                      <div key={`s-${s.id}`}>
                        {isFirstOf('supplier') && <SectionLabel className="mt-2">Nhà cung cấp</SectionLabel>}
                        <button
                          onClick={() => navigate(`/suppliers/${s.id}`)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn('flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors text-left', activeCls)}
                        >
                          <span className="text-amber-600 flex-shrink-0 text-base">🏢</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-900 truncate">{s.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {s.tax_code ? `MST: ${s.tax_code}` : ''}
                              {s.address && (s.tax_code ? ' · ' : '') + s.address}
                            </div>
                          </div>
                          {isActive && <kbd className="text-[11px] font-mono text-slate-400">Enter</kbd>}
                        </button>
                      </div>
                    );
                  }

                  return null;
                })}

                {normalizedSearch && !searchLoading && displayItems.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-500">Không tìm thấy kết quả cho "{query}"</p>
                    <p className="text-xs text-slate-400 mt-1">Thử mã BQMS, số PO, số RFQ, tên NCC...</p>
                  </div>
                )}

                {!normalizedSearch && recentPages.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-500">Tìm trang, mã BQMS, PO, NCC...</p>
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">
                      vd: Z0000002-385323 · QT26066093 · 2112666093
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            {priceDetail ? (
              <>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Esc</kbd> quay lại
                </span>
                <span className="ml-auto text-[11px] text-slate-400">Tra cứu giá · Song Chau ERP</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">↑↓</kbd> di chuyển
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Enter</kbd> mở
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono">Shift+Enter</kbd> xem giá
                </span>
                <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
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
    <p className={cn('px-2 py-1.5 text-[11px] font-mono uppercase tracking-widest text-slate-400', className)}>
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
      <div className="text-[11px] uppercase text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-slate-400 italic py-1">{children}</div>;
}
