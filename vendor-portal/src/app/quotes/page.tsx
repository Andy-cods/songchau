'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Send, FileEdit, Trophy, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoneyNum } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatStrip } from '@/components/ui/StatStrip';
import { SearchBar } from '@/components/ui/SearchBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import type { MyQuoteRow } from '@/lib/types';

// Batch-level status (open/closed for new quotes) → dense VN chip. Kept local:
// this is the bidding-window state of the *batch*, distinct from the vendor's
// own quote status (StatusChip kind="quote"), so it gets its own small pill.
function BatchStatusChip({ status }: { status?: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const open = /open|đang/i.test(status);
  return (
    <span
      className={
        open
          ? 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 ring-1 ring-inset ring-emerald-200'
          : 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 bg-slate-100 ring-1 ring-inset ring-slate-200'
      }
    >
      {open ? 'Đang mở' : 'Đã đóng'}
    </span>
  );
}

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<MyQuoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  // GET /api/vendor/quotes/my — ?limit=50 nới trần cắt ngầm 20 dòng; `total`
  // (BE trả sẵn) để hiển thị "Hiển thị X/total".
  useEffect(() => {
    api
      .get<{ data: MyQuoteRow[]; total?: number }>('/api/vendor/quotes/my?limit=50')
      .then(res => {
        setQuotes(res.data || []);
        setTotal(res.total ?? (res.data || []).length);
      })
      .catch(() => setError('Không tải được danh sách báo giá'))
      .finally(() => setLoading(false));
  }, []);

  // Client-side filter over mã đợt + tiêu đề (no new endpoint).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter(
      r =>
        r.batch_code.toLowerCase().includes(q) ||
        (r.title ?? '').toLowerCase().includes(q),
    );
  }, [quotes, query]);

  // KPI strip — derived from the same fetched rows, no extra calls.
  const stats = useMemo(() => {
    const isWin = (s: string) => /trúng|won|awarded/i.test(s) && !/không|not/i.test(s);
    const isDraft = (s: string) => /nháp|draft/i.test(s);
    const sent = quotes.filter(q => !isDraft(q.status)).length;
    const drafts = quotes.filter(q => isDraft(q.status)).length;
    const wins = quotes.filter(q => isWin(q.status)).length;
    const totalVnd = quotes
      .filter(q => (q.currency ?? 'VND').toUpperCase() === 'VND')
      .reduce((sum, q) => sum + (q.total_amount || 0), 0);
    return { sent, drafts, wins, totalVnd };
  }, [quotes]);

  const columns: Column<MyQuoteRow>[] = [
    {
      key: 'batch_code',
      header: 'Mã',
      w: 116,
      render: row => (
        <span className="font-mono text-[11px] font-medium text-brand-700">{row.batch_code}</span>
      ),
    },
    {
      key: 'title',
      header: 'Tiêu đề',
      render: row => (
        <span className="block max-w-[320px] truncate text-slate-700" title={row.title}>
          {row.title}
        </span>
      ),
    },
    {
      key: 'round_number',
      header: 'Vòng',
      w: 76,
      align: 'center',
      render: row => {
        const r = row.round_number ?? 1;
        return (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">
            Vòng {r}
          </span>
        );
      },
    },
    {
      key: 'item_count',
      header: 'Số mục',
      w: 72,
      align: 'right',
      format: 'num',
    },
    {
      key: 'currency',
      header: 'Tiền tệ',
      w: 72,
      align: 'center',
      render: row => (
        <span className="font-mono text-[11px] text-slate-500">{row.currency || '—'}</span>
      ),
    },
    {
      key: 'total_amount',
      header: 'Tổng tiền',
      w: 140,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-800">
          {formatMoneyNum(row.total_amount)}
        </span>
      ),
    },
    {
      key: 'lead_time_days',
      header: 'Lead time',
      w: 92,
      align: 'right',
      render: row =>
        row.lead_time_days == null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="tabular-nums text-slate-600">{row.lead_time_days}n</span>
        ),
    },
    {
      key: 'batch_status',
      header: 'TT đợt',
      w: 88,
      align: 'center',
      render: row => <BatchStatusChip status={row.batch_status} />,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      w: 116,
      align: 'center',
      render: row => <StatusChip kind="quote" status={row.status} />,
    },
    {
      key: 'submitted_at',
      header: 'Gửi lúc',
      w: 104,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-500">{formatDate(row.submitted_at)}</span>
      ),
    },
    {
      key: 'bid_deadline' as keyof MyQuoteRow,
      header: 'Hạn nộp',
      w: 104,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-500">{row.bid_deadline ? formatDate(row.bid_deadline) : '—'}</span>
      ),
    },
    {
      key: 'valid_until' as keyof MyQuoteRow,
      header: 'Hiệu lực đến',
      w: 104,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-500">{row.valid_until ? formatDate(row.valid_until) : '—'}</span>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        title="Báo giá của tôi"
        count={quotes.length}
        subtitle="Tất cả báo giá bạn đã gửi cho Song Châu"
        actions={
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Tìm mã / tiêu đề…"
            className="w-72"
          />
        }
      />

      <StatStrip
        className="mb-5"
        items={[
          {
            label: 'Đã gửi',
            value: stats.sent,
            hint: 'báo giá đã nộp',
            icon: <Send className="h-4 w-4" />,
            tone: 'brand',
          },
          {
            label: 'Nháp',
            value: stats.drafts,
            hint: 'chưa gửi',
            icon: <FileEdit className="h-4 w-4" />,
            tone: 'amber',
          },
          {
            label: 'Trúng',
            value: stats.wins,
            hint: 'đợt trúng thầu',
            icon: <Trophy className="h-4 w-4" />,
            tone: 'emerald',
          },
          {
            label: 'Tổng VND',
            value: formatMoneyNum(stats.totalVnd),
            hint: 'giá trị đã chào (VND)',
            icon: <Wallet className="h-4 w-4" />,
            tone: 'slate',
          },
        ]}
      />

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <p>{error}</p>
        </div>
      ) : (
        <>
          <DataTable<MyQuoteRow>
            columns={columns}
            rows={filtered}
            loading={loading}
            // PRESERVED nav — row click → /rfq/{batch_id}.
            onRowClick={row => router.push(`/rfq/${row.batch_id}`)}
            emptyIcon={<FileText className="h-8 w-8" />}
            emptyLabel={
              query
                ? 'Không tìm thấy báo giá phù hợp'
                : 'Chưa có báo giá nào — truy cập Dashboard để gửi báo giá'
            }
          />
          {!loading && total > 0 && (
            <p className="mt-2 text-right text-xs text-slate-400">
              Hiển thị {quotes.length}/{total} báo giá
            </p>
          )}
        </>
      )}
    </main>
  );
}
