'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Search, History, TrendingUp, Users as UsersIcon } from 'lucide-react';

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

  useEffect(() => {
    if (!initCode) return;
    loadCode(initCode);
  }, [initCode]);

  useEffect(() => {
    if (!query || query.length < 2 || query === data?.bqms_code) {
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
  }, [query, data]);

  const loadCode = async (code: string) => {
    setLoading(true);
    setSuggestions([]);
    try {
      const res = await api.get<LookupResult>(`/api/v1/price-lookup/${encodeURIComponent(code)}`);
      setData(res);
      setQuery(code);
      router.replace(`/tra-cuu-gia?code=${encodeURIComponent(code)}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tra cứu giá</h1>
        <p className="text-sm text-slate-500 mt-1">
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
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-base outline-none focus:ring-2 focus:ring-sky-200"
          autoFocus
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
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />
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
                <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2">Ngày</th>
                    <th className="text-left py-2">RFQ #</th>
                    <th className="text-right py-2">Qty</th>
                    <th className="text-right py-2">V1</th>
                    <th className="text-right py-2">V2</th>
                    <th className="text-right py-2">V3</th>
                    <th className="text-right py-2">V4</th>
                    <th className="text-left py-2 pl-3">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {data.internal_quotes.map((q: any) => (
                    <tr key={q.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2 font-mono text-xs">{q.inquiry_date || '—'}</td>
                      <td className="py-2">{q.rfq_number || '—'}</td>
                      <td className="py-2 text-right tabular-nums">{q.qty ? Math.round(q.qty) : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUSD(q.v1)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUSD(q.v2)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUSD(q.v3)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUSD(q.v4)}</td>
                      <td className="py-2 pl-3">
                        <span className={
                          q.result === 'won' ? 'text-emerald-700 font-medium' :
                          q.result === 'lost' ? 'text-rose-700' : 'text-slate-400'
                        }>{q.result || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent wins */}
          {data.recent_wins.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 mb-4">PO trúng gần nhất</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2">Ngày</th>
                      <th className="text-left py-2">PO #</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Đơn giá</th>
                      <th className="text-right py-2">Tổng</th>
                      <th className="text-left py-2 pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_wins.map((w: any, i: number) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="py-2 font-mono text-xs">{w.po_date || '—'}</td>
                        <td className="py-2">{w.po_number}</td>
                        <td className="py-2 text-right tabular-nums">{w.qty ? Math.round(w.qty) : '—'}</td>
                        <td className="py-2 text-right tabular-nums">{fmtUSD(w.unit_price)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtUSD(w.amount)}</td>
                        <td className="py-2 pl-3 text-slate-500">{w.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
