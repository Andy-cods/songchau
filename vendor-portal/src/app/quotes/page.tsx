'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

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

type StatusKey = 'draft' | 'submitted' | 'awarded' | 'rejected';

const STATUS_CONFIG: Record<StatusKey, { label: string; className: string }> = {
  draft: { label: 'Nháp', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  submitted: { label: 'Đã gửi', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  awarded: { label: 'Trúng thầu', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Không trúng', className: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as StatusKey] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAmount(amount: number, currency: string) {
  if (!amount) return '—';
  return `${amount.toLocaleString('vi-VN')} ${currency}`;
}

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<any>('/api/vendor/quotes/my')
      .then(res => setQuotes(res.data || []))
      .catch(() => setError('Không tải được danh sách báo giá'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Lịch sử báo giá</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tất cả báo giá bạn đã gửi cho Song Châu</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-24" />
                <div className="h-4 bg-slate-200 rounded flex-1" />
                <div className="h-4 bg-slate-200 rounded w-20" />
                <div className="h-5 bg-slate-200 rounded-full w-16" />
                <div className="h-4 bg-slate-200 rounded w-20" />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : quotes.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="text-slate-700 font-medium mb-1">Chưa có báo giá nào</p>
          <p className="text-sm text-slate-400">Truy cập trang Dashboard để xem các đợt đang mở và gửi báo giá</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[120px_1fr_160px_120px_140px] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide">Mã đợt</span>
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide">Tên đợt</span>
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide text-right">Tổng tiền</span>
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide text-center">Trạng thái</span>
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide text-right">Ngày gửi</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {quotes.map(q => (
              <button
                key={q.id}
                onClick={() => router.push(`/rfq/${q.batch_id}`)}
                className="w-full grid grid-cols-[120px_1fr_160px_120px_140px] gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left group"
              >
                <span className="font-mono text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded self-center w-fit">
                  {q.batch_code}
                </span>
                <span className="text-sm text-slate-700 font-medium self-center truncate group-hover:text-brand-700 transition-colors">
                  {q.title}
                </span>
                <span className="text-sm font-mono text-slate-800 self-center text-right">
                  {formatAmount(q.total_amount, q.currency)}
                </span>
                <span className="self-center flex justify-center">
                  <StatusBadge status={q.status} />
                </span>
                <span className="text-sm text-slate-500 self-center text-right">
                  {formatDate(q.submitted_at)}
                </span>
              </button>
            ))}
          </div>

          {/* Footer count */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200">
            <p className="text-xs text-slate-400">{quotes.length} báo giá</p>
          </div>
        </div>
      )}
    </main>
  );
}
