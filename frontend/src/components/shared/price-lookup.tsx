'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Search, X, TrendingUp, TrendingDown, Package, History } from 'lucide-react';
import Link from 'next/link';

type Suggestion = {
  bqms_code: string;
  specification: string | null;
  maker: string | null;
  rfq_count: number;
  last_inquiry: string | null;
};

type LookupResult = {
  bqms_code: string;
  internal_quotes: Array<{
    id: number;
    rfq_number: string | null;
    inquiry_date: string | null;
    qty: number | null;
    unit: string | null;
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
    p25_usd: number | null;
    p75_usd: number | null;
    latest_date: string | null;
  };
  market_all_time: {
    n: number;
    median_usd: number | null;
    avg_usd: number | null;
    latest_date: string | null;
  };
  competitors: Array<{ seller_name: string; n: number; avg_usd: number | null; latest_date: string | null }>;
  recent_wins: Array<{
    po_number: string;
    po_date: string | null;
    qty: number | null;
    unit_price: number | null;
    amount: number | null;
    currency: string;
    status: string | null;
  }>;
};

const fmtUSD = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `$${Number(v).toFixed(2)}`;

export function QuickPriceLookup() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else {
      setQuery('');
      setSuggestions([]);
      setSelected(null);
    }
  }, [open]);

  // Debounced autocomplete
  useEffect(() => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Suggestion[] }>(
          `/api/v1/price-lookup/search?q=${encodeURIComponent(query)}&limit=8`,
        );
        setSuggestions(res.items || []);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const lookup = async (code: string) => {
    setLoading(true);
    setSuggestions([]);
    setQuery(code);
    try {
      const res = await api.get<LookupResult>(`/api/v1/price-lookup/${encodeURIComponent(code)}`);
      setSelected(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[720px] max-w-[95vw] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập mã BQMS (GH98-..., 3001-...)"
            className="flex-1 text-base outline-none placeholder:text-slate-400"
            autoFocus
          />
          <kbd className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">ESC</kbd>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Suggestions */}
          {suggestions.length > 0 && !selected && (
            <div className="divide-y divide-slate-100">
              {suggestions.map((s) => (
                <button
                  key={s.bqms_code}
                  onClick={() => lookup(s.bqms_code)}
                  className="w-full text-left px-5 py-3 hover:bg-slate-50 flex items-center justify-between"
                >
                  <div>
                    <div className="font-mono text-sm font-semibold text-slate-900">{s.bqms_code}</div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                      {s.specification || '—'} {s.maker && `· ${s.maker}`}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">{s.rfq_count} RFQ</div>
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {/* Result */}
          {selected && !loading && (
            <div className="p-5 space-y-5">
              <div>
                <div className="font-mono text-lg font-bold text-slate-900">{selected.bqms_code}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {selected.internal_quotes[0]?.specification || '—'}
                  {selected.internal_quotes[0]?.maker && ` · ${selected.internal_quotes[0].maker}`}
                  {selected.internal_quotes[0]?.item_type && (
                    <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">
                      {selected.internal_quotes[0].item_type}
                    </span>
                  )}
                </div>
              </div>

              {/* Internal last quotes */}
              <Section title="Giá nội bộ gần nhất" count={selected.internal_quotes.length}>
                {selected.internal_quotes.length === 0 ? (
                  <div className="text-xs text-slate-400 italic py-2">Chưa có báo giá nội bộ</div>
                ) : (
                  <div className="space-y-1.5">
                    {selected.internal_quotes.map((q) => (
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

              {/* Market */}
              <Section title="Giá thị trường (XNK 90 ngày)" count={selected.market_90d.n}>
                {selected.market_90d.n === 0 ? (
                  selected.market_all_time.n > 0 ? (
                    <div className="text-xs text-slate-500">
                      Không có dữ liệu 90 ngày. All-time: median {fmtUSD(selected.market_all_time.median_usd)} (n={selected.market_all_time.n})
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic py-2">Không có dữ liệu XNK cho mã này</div>
                  )
                ) : (
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <Stat label="Median" value={fmtUSD(selected.market_90d.median_usd)} />
                    <Stat label="Min" value={fmtUSD(selected.market_90d.min_usd)} />
                    <Stat label="Max" value={fmtUSD(selected.market_90d.max_usd)} />
                    <Stat label="P25/P75" value={`${fmtUSD(selected.market_90d.p25_usd)} / ${fmtUSD(selected.market_90d.p75_usd)}`} />
                  </div>
                )}
              </Section>

              {/* Competitors */}
              {selected.competitors.length > 0 && (
                <Section title="Đối thủ đã nhập" count={selected.competitors.length}>
                  <div className="space-y-1.5">
                    {selected.competitors.map((c, i) => (
                      <div key={i} className="grid grid-cols-5 gap-2 text-xs py-1.5 px-2 rounded hover:bg-slate-50">
                        <div className="col-span-3 truncate text-slate-700">{c.seller_name}</div>
                        <div className="tabular-nums">{fmtUSD(c.avg_usd)}</div>
                        <div className="text-slate-400 text-right">{c.n} lần</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Recent wins */}
              <Section title="PO gần nhất" count={selected.recent_wins.length}>
                {selected.recent_wins.length === 0 ? (
                  <div className="text-xs text-slate-400 italic py-2">Chưa có PO trúng</div>
                ) : (
                  <div className="space-y-1.5">
                    {selected.recent_wins.map((w, i) => (
                      <div key={i} className="grid grid-cols-5 gap-2 text-xs py-1.5 px-2 rounded hover:bg-slate-50">
                        <div className="text-slate-500 font-mono">{w.po_date || '—'}</div>
                        <div className="col-span-2 truncate">{w.po_number}</div>
                        <div className="tabular-nums">{fmtUSD(w.unit_price)}</div>
                        <div className="text-slate-400 text-right">{w.qty ? Math.round(w.qty) : '—'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div className="pt-3 border-t border-slate-100">
                <Link
                  href={`/tra-cuu-gia?code=${encodeURIComponent(selected.bqms_code)}`}
                  onClick={() => setOpen(false)}
                  className="text-xs font-medium text-sky-700 hover:underline"
                >
                  Xem chi tiết đầy đủ →
                </Link>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!selected && !loading && suggestions.length === 0 && query.length < 2 && (
            <div className="p-10 text-center text-slate-400">
              <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Tra cứu giá nhanh theo mã BQMS</p>
              <p className="text-xs mt-1">Gõ ít nhất 2 ký tự để xem gợi ý · <kbd className="text-[10px] font-mono bg-slate-100 px-1 py-0.5 rounded">Ctrl+K</kbd> để mở nhanh</p>
            </div>
          )}

          {!selected && !loading && query.length >= 2 && suggestions.length === 0 && (
            <div className="p-10 text-center text-slate-400 text-sm">
              Không tìm thấy mã "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
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
