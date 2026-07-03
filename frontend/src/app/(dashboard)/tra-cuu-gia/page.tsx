'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Search, History, TrendingUp, Users as UsersIcon } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

type Suggestion = {
  bqms_code: string;
  specification: string | null;
  maker: string | null;
  rfq_count: number;
  last_inquiry: string | null;
};

type LookupResult = any;

const fmtUSD = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `$${Number(v).toFixed(2)}`;

export default function TraCuuGiaPage() {
  const params = useSearchParams();
  const router = useRouter();
  const initCode = params.get('code') || '';
  const [query, setQuery] = useState(initCode);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  // Tracks which code has already been loaded (both the requested code and the
  // resolved res.bqms_code) so the router.replace-induced initCode change is
  // recognized as already-loaded and short-circuits — preventing the loop.
  const loadedRef = useRef<string | null>(null);
  // Set right after a load so the autocomplete effect skips exactly one cycle
  // (the one fired by setQuery(code) inside loadCode), avoiding a re-arm loop.
  const justLoadedRef = useRef(false);

  useEffect(() => {
    if (!initCode || loadedRef.current === initCode) return;
    loadCode(initCode);
  }, [initCode]);

  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      setSuggestions([]);
      return;
    }
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
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const loadCode = async (code: string) => {
    setLoading(true);
    setSuggestions([]);
    justLoadedRef.current = true;
    loadedRef.current = code;
    try {
      const res = await api.get<LookupResult>(`/api/v1/price-lookup/${encodeURIComponent(code)}`);
      setData(res);
      if (res?.bqms_code) loadedRef.current = res.bqms_code;
      setQuery(code);
      router.replace(`/tra-cuu-gia?code=${encodeURIComponent(res?.bqms_code || code)}`);
    } catch (err) {
      console.error(err);
      // A failed load never fires the setQuery(code) autocomplete cycle that
      // would consume justLoadedRef, so reset both flags — otherwise the next
      // keystroke is silently swallowed and the same bad ?code= can't retry.
      justLoadedRef.current = false;
      loadedRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="space-y-2">
        <PageHeader icon={Search} title="Tra cứu giá" />
        <p className="text-sm text-slate-500">
          Gõ mã BQMS để xem báo giá nội bộ, giá thị trường XNK, đối thủ và PO trúng gần nhất. Mẹo: nhấn <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">Ctrl+K</kbd> ở bất kỳ page nào để mở nhanh.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggestions[0]) loadCode(suggestions[0].bqms_code);
          }}
          placeholder="Nhập mã BQMS..."
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-10 overflow-hidden max-h-80 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.bqms_code}
                onClick={() => loadCode(s.bqms_code)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center justify-between"
              >
                <div>
                  <div className="font-mono text-sm font-semibold">{s.bqms_code}</div>
                  <div className="text-xs text-slate-500 line-clamp-1">{s.specification || '—'}</div>
                </div>
                <div className="text-xs text-slate-400">{s.rfq_count} RFQ</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="space-y-4" aria-busy="true">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="font-mono text-xl font-bold text-slate-900">{data.bqms_code}</div>
            <div className="text-sm text-slate-500 mt-1">
              {data.internal_quotes[0]?.specification || '—'}
              {data.internal_quotes[0]?.maker && ` · ${data.internal_quotes[0].maker}`}
              {data.internal_quotes[0]?.item_type && (
                <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium">
                  {data.internal_quotes[0].item_type}
                </span>
              )}
            </div>
          </div>

          {/* Market + Competitors */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-slate-400" />
                <h2 className="font-semibold text-slate-900">Giá thị trường 90 ngày</h2>
                <span className="text-xs text-slate-500 ml-auto">n={data.market_90d.n}</span>
              </div>
              {data.market_90d.n === 0 ? (
                <div className="text-sm text-slate-400">
                  {data.market_all_time.n > 0
                    ? `Chỉ có all-time: median ${fmtUSD(data.market_all_time.median_usd)} (n=${data.market_all_time.n})`
                    : 'Chưa có dữ liệu XNK'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Median" value={fmtUSD(data.market_90d.median_usd)} big />
                  <Stat label="Average" value={fmtUSD(data.market_90d.avg_usd)} big />
                  <Stat label="Min / Max" value={`${fmtUSD(data.market_90d.min_usd)} / ${fmtUSD(data.market_90d.max_usd)}`} />
                  <Stat label="P25 / P75" value={`${fmtUSD(data.market_90d.p25_usd)} / ${fmtUSD(data.market_90d.p75_usd)}`} />
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <UsersIcon className="w-4 h-4 text-slate-400" />
                <h2 className="font-semibold text-slate-900">Đối thủ đã nhập</h2>
                <span className="text-xs text-slate-500 ml-auto">{data.competitors.length}</span>
              </div>
              {data.competitors.length === 0 ? (
                <div className="text-sm text-slate-400">Không có dữ liệu đối thủ</div>
              ) : (
                <div className="space-y-2">
                  {data.competitors.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div className="text-sm text-slate-700 truncate flex-1">{c.seller_name}</div>
                      <div className="tabular-nums font-medium">{fmtUSD(c.avg_usd)}</div>
                      <div className="text-xs text-slate-400 w-16 text-right">{c.n} lần</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Internal quotes table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <History className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-900">Lịch sử báo giá nội bộ</h2>
              <span className="text-xs text-slate-500 ml-auto">{data.internal_quotes.length}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead>
                  <TableHead>RFQ #</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">V1</TableHead>
                  <TableHead className="text-right">V2</TableHead>
                  <TableHead className="text-right">V3</TableHead>
                  <TableHead className="text-right">V4</TableHead>
                  <TableHead>Kết quả</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.internal_quotes.map((q: any) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">{q.inquiry_date || '—'}</TableCell>
                    <TableCell>{q.rfq_number || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.qty ? Math.round(q.qty) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUSD(q.v1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUSD(q.v2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUSD(q.v3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUSD(q.v4)}</TableCell>
                    <TableCell>
                      <span className={
                        q.result === 'won' ? 'text-emerald-700 font-medium' :
                        q.result === 'lost' ? 'text-rose-700' : 'text-slate-400'
                      }>{q.result || '—'}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Recent wins */}
          {data.recent_wins.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 mb-4">PO trúng gần nhất</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ngày</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Đơn giá</TableHead>
                    <TableHead className="text-right">Tổng</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_wins.map((w: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{w.po_date || '—'}</TableCell>
                      <TableCell>{w.po_number}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.qty ? Math.round(w.qty) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(w.unit_price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(w.amount)}</TableCell>
                      <TableCell className="text-slate-500">{w.status || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`${big ? 'text-lg font-bold' : 'text-sm font-semibold'} text-slate-900 tabular-nums mt-1`}>{value}</div>
    </div>
  );
}
