'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

interface XnkRow {
  id: number;
  rfq_date?: string;
  quotation_no?: string;
  bqms_code?: string;
  item_name?: string;
  item_explain?: string;
  maker?: string;
  unit?: string;
  quantity?: number;
  hs_code?: string;
  price_usd?: number;
  price_vnd?: number;
  total_usd?: number;
  buyer_name?: string;
  seller_name?: string;
}

interface Stats {
  total_records: number;
  unique_products: number;
  unique_sellers: number;
  years_covered: number;
  latest_record?: string;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

const TABS = [
  { key: 'search', label: 'Tra cứu giá' },
  { key: 'sellers', label: 'Đối thủ' },
];

export default function MarketPricesPage() {
  const [activeTab, setActiveTab] = useState('search');

  const { data: statsData } = useQuery({
    queryKey: ['xnk-stats'],
    queryFn: () => api.get<any>('/api/v1/market-prices/stats'),
  });
  const stats: Stats = statsData?.data ?? {} as Stats;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tra cứu giá thị trường</h1>
          <p className="text-sm text-slate-500 mt-0.5">Dữ liệu giá XNK + đối thủ — dùng để báo giá cạnh tranh</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="Tổng bản ghi" value={fmtNum(stats.total_records)} />
        <StatCard label="Sản phẩm" value={fmtNum(stats.unique_products)} />
        <StatCard label="Đối thủ (bên bán)" value={fmtNum(stats.unique_sellers)} />
        <StatCard label="Cập nhật mới nhất" value={stats.latest_record ? formatDate(stats.latest_record) : '—'} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-4">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'search' ? <SearchTab /> : <SellersTab />}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-[11px] text-slate-500 font-medium">{label}</p>
      <p className="text-lg font-bold text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

function SearchTab() {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [appliedSearch, setAppliedSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['xnk-search', appliedSearch, year, page],
    queryFn: () => api.get<any>(
      `/api/v1/market-prices/search?q=${encodeURIComponent(appliedSearch)}&year=${year}&page=${page}&limit=50`
    ),
  });

  const rows: XnkRow[] = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 mb-3 flex items-center gap-2">
        <input
          type="text"
          placeholder="Tìm theo BQMS code, tên hàng, mã HS, đối thủ..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setAppliedSearch(search); setPage(1); } }}
          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select value={year} onChange={e => { setYear(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">Tất cả năm</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
        </select>
        <button onClick={() => { setAppliedSearch(search); setPage(1); }}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700">
          Tìm kiếm
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-mono text-slate-500 w-10">#</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Ngày</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">BQMS Code</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Tên hàng</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Maker</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Mã HS</th>
                <th className="px-3 py-2 text-right font-mono text-slate-500">SL</th>
                <th className="px-3 py-2 text-right font-mono text-slate-500">Giá USD</th>
                <th className="px-3 py-2 text-right font-mono text-slate-500">Tổng USD</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Bên bán (đối thủ)</th>
                <th className="px-3 py-2 text-left font-mono text-slate-500">Bên mua</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-slate-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-slate-400">Không tìm thấy kết quả</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 text-slate-400 font-mono">{(page - 1) * 50 + i + 1}</td>
                    <td className="px-3 py-1.5 text-slate-600 font-mono">{formatDate(r.rfq_date)}</td>
                    <td className="px-3 py-1.5 font-mono text-brand-600">{r.bqms_code}</td>
                    <td className="px-3 py-1.5 text-slate-700 max-w-[200px] truncate" title={r.item_name}>{r.item_name}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.maker ?? '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500 font-mono">{r.hs_code ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtNum(r.quantity)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtNum(r.price_usd)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtNum(r.total_usd)}</td>
                    <td className="px-3 py-1.5 text-violet-600 max-w-[180px] truncate" title={r.seller_name}>{r.seller_name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500 max-w-[150px] truncate" title={r.buyer_name}>{r.buyer_name ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">Hiển thị {rows.length} / {total.toLocaleString('vi-VN')} bản ghi</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Trước</button>
            <span className="font-mono">Trang {page} / {Math.ceil(total / 50) || 1}</span>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Sau</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SellersTab() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['xnk-sellers', search],
    queryFn: () => api.get<any>(`/api/v1/market-prices/sellers?q=${encodeURIComponent(search)}`),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <div className="mb-3">
        <input type="text" placeholder="Tìm tên đối thủ..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-72 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left font-mono text-slate-500 w-10">#</th>
              <th className="px-3 py-2 text-left font-mono text-slate-500">Tên đối thủ</th>
              <th className="px-3 py-2 text-right font-mono text-slate-500">Số giao dịch</th>
              <th className="px-3 py-2 text-right font-mono text-slate-500">SP khác nhau</th>
              <th className="px-3 py-2 text-right font-mono text-slate-500">Tổng USD</th>
              <th className="px-3 py-2 text-left font-mono text-slate-500">GD gần nhất</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">Đang tải...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">Chưa có dữ liệu đối thủ</td></tr>
            ) : (
              rows.map((s: any, i: number) => (
                <tr key={s.seller_name} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-3 py-2 text-slate-700 font-medium">{s.seller_name}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtNum(s.deal_count)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">{fmtNum(s.product_count)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">{fmtNum(s.total_usd)}</td>
                  <td className="px-3 py-2 text-slate-500 font-mono">{formatDate(s.latest_deal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
