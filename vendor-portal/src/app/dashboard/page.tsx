'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Batch {
  id: number;
  batch_code: string;
  title: string;
  description?: string;
  status: string;
  item_count: number;
  published_at?: string;
  my_quote_count: number;
}

interface Quote {
  id: number;
  batch_id: number;
  batch_code: string;
  title: string;
  currency: string;
  total_amount: number;
  status: string;
  submitted_at: string;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function VendorDashboard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<any>('/api/vendor/batches'),
      api.get<any>('/api/vendor/quotes/my'),
    ])
      .then(([batchRes, quoteRes]) => {
        setBatches(batchRes.data || []);
        setQuotes(quoteRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openBatches = batches.length;
  const submittedQuotes = quotes.length;
  const awardedCount = quotes.filter(q => q.status === 'awarded').length;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Đợt đang mở" value={loading ? '—' : openBatches} sub="đợt báo giá hiện tại" />
        <StatCard label="Báo giá đã gửi" value={loading ? '—' : submittedQuotes} sub="tổng số báo giá" />
        <StatCard label="Trúng thầu" value={loading ? '—' : awardedCount} sub="đơn hàng được chọn" />
      </div>

      {/* Open batches */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Đợt báo giá đang mở</h2>
          <p className="text-sm text-slate-500 mt-0.5">Chọn đợt để xem chi tiết và gửi báo giá</p>
        </div>
        <Link href="/quotes" className="text-sm text-brand-600 hover:underline font-medium">
          Xem tất cả báo giá →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-lg h-24 animate-pulse border border-slate-200" />
          ))}
        </div>
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-slate-700 font-medium mb-1">Chưa có đợt báo giá nào đang mở</p>
          <p className="text-sm text-slate-400">Hệ thống sẽ thông báo khi có đợt báo giá mới từ Song Châu</p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map(b => (
            <Link
              key={b.id}
              href={`/rfq/${b.id}`}
              className="block bg-white rounded-lg border border-slate-200 p-5 hover:border-brand-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded shrink-0">
                    {b.batch_code}
                  </span>
                  <h3 className="font-semibold text-slate-800 truncate group-hover:text-brand-700 transition-colors">
                    {b.title}
                  </h3>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span className="text-xs text-slate-400">{b.item_count} items</span>
                  {b.my_quote_count > 0 ? (
                    <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                      Đã báo giá
                    </span>
                  ) : (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                      Chưa báo giá
                    </span>
                  )}
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              {b.description && (
                <p className="text-sm text-slate-500 mt-2 line-clamp-1">{b.description}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
