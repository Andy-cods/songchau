'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { formatMoneyNum } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatStrip } from '@/components/ui/StatStrip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { cn } from '@/lib/cn';
import type { ContractRow } from '@/lib/types';

// Chip lọc theo trạng thái hợp đồng (sent/active/completed là vòng đời chính NCC
// nhìn thấy; signed/cancelled gộp vào 'all' để khỏi loãng — YAGNI).
type ContractFilter = 'all' | 'sent' | 'active' | 'completed';
const CT_FILTER_ORDER: ContractFilter[] = ['all', 'sent', 'active', 'completed'];
const CT_FILTER_LABEL: Record<ContractFilter, string> = {
  all: 'Tất cả',
  sent: 'Chờ ký',
  active: 'Hiệu lực',
  completed: 'Hoàn tất',
};

function SignNowChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
      Ký ngay
    </span>
  );
}

function ContractsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractFilter>('all');

  // GET /api/vendor/contracts — ?limit=50 nới trần cắt ngầm 20 dòng; `total`
  // (BE trả sẵn) để hiển thị "Hiển thị X/total".
  useEffect(() => {
    api
      .get<{ data: ContractRow[]; total?: number }>('/api/vendor/contracts?limit=50')
      .then(res => {
        setContracts(res.data || []);
        setTotal(res.total ?? (res.data || []).length);
      })
      .catch(() => setError('Không tải được danh sách hợp đồng'))
      .finally(() => setLoading(false));
  }, []);

  // KPI buckets — driven by the canonical contract status vocabulary
  // (sent=Chờ ký, active=Hiệu lực, completed=Hoàn tất).
  const stats = useMemo(() => {
    let pendingSign = 0;
    let inForce = 0;
    let done = 0;
    for (const c of contracts) {
      if (c.status === 'sent') pendingSign += 1;
      else if (c.status === 'active') inForce += 1;
      else if (c.status === 'completed') done += 1;
    }
    return { pendingSign, inForce, done };
  }, [contracts]);

  // Đếm cho từng chip lọc (toàn danh sách).
  const filterCounts = useMemo(() => {
    const c: Record<ContractFilter, number> = { all: contracts.length, sent: 0, active: 0, completed: 0 };
    for (const ct of contracts) {
      if (ct.status === 'sent') c.sent += 1;
      else if (ct.status === 'active') c.active += 1;
      else if (ct.status === 'completed') c.completed += 1;
    }
    return c;
  }, [contracts]);

  // Lọc theo chip trạng thái + tìm số HĐ / mã đợt (case-insensitive).
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contracts.filter(ct => {
      if (statusFilter !== 'all' && ct.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        ct.contract_no.toLowerCase().includes(needle) ||
        (ct.batch_code ?? '').toLowerCase().includes(needle)
      );
    });
  }, [contracts, q, statusFilter]);

  const columns: Column<ContractRow>[] = [
    {
      key: 'contract_no',
      header: 'Số HĐ',
      w: 170,
      render: row => (
        <span className="font-mono text-[11px] text-brand-600">{row.contract_no}</span>
      ),
    },
    {
      key: 'batch_code',
      header: 'Đợt',
      w: 120,
      render: row => (
        <span className="font-mono text-[11px] text-slate-500">{row.batch_code ?? '—'}</span>
      ),
    },
    {
      key: 'total_amount',
      header: 'Giá trị',
      w: 160,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-800">
          {formatMoneyNum(row.total_amount, row.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'TT',
      w: 150,
      render: row => {
        const isSent = row.status === 'sent';
        return (
          <span className="inline-flex items-center gap-1.5">
            <StatusChip kind="contract" status={row.status} withDot />
            {isSent && <SignNowChip />}
          </span>
        );
      },
    },
    {
      key: 'item_count',
      header: 'Số mục',
      w: 80,
      align: 'right',
      format: 'num',
    },
    {
      key: 'sent_to_vendor_at',
      header: 'Gửi lúc',
      w: 120,
      align: 'right',
      format: 'date',
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        title="Hợp đồng"
        count={loading ? undefined : contracts.length}
        subtitle="Hợp đồng Song Châu gửi cho bạn"
      />

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <p>{error}</p>
        </div>
      ) : (
        <>
          <StatStrip
            className="mb-5"
            items={[
              {
                label: 'Chờ ký',
                value: loading ? '—' : stats.pendingSign,
                hint: 'Cần ký điện tử',
                tone: 'amber',
                icon: <ContractsIcon className="h-4 w-4" />,
              },
              {
                label: 'Hiệu lực',
                value: loading ? '—' : stats.inForce,
                hint: 'Đang còn hiệu lực',
                tone: 'emerald',
                icon: <ContractsIcon className="h-4 w-4" />,
              },
              {
                label: 'Hoàn tất',
                value: loading ? '—' : stats.done,
                hint: 'Đã hoàn tất',
                tone: 'slate',
                icon: <ContractsIcon className="h-4 w-4" />,
              },
            ]}
          />

          {/* Tìm + lọc — chỉ hiện khi đã có dữ liệu. */}
          {!loading && contracts.length > 0 && (
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchBar
                value={q}
                onChange={setQ}
                placeholder="Tìm số HĐ / mã đợt…"
                className="max-w-md sm:flex-1"
              />
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc theo trạng thái">
                {CT_FILTER_ORDER.map(key => {
                  const active = statusFilter === key;
                  return (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setStatusFilter(key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                        active
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      )}
                    >
                      {CT_FILTER_LABEL[key]}
                      <span className={cn('tabular-nums', active ? 'text-brand-500' : 'text-slate-400')}>
                        {filterCounts[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DataTable<ContractRow>
            columns={columns}
            rows={visible}
            loading={loading}
            onRowClick={row => router.push(`/contracts/${row.id}`)}
            getRowClassName={row =>
              row.status === 'sent' ? 'bg-amber-50/40 hover:bg-amber-50/70' : undefined
            }
            emptyIcon={<ContractsIcon className="h-10 w-10" /> as ReactNode}
            emptyLabel={
              contracts.length > 0
                ? 'Không có hợp đồng khớp bộ lọc'
                : 'Chưa có hợp đồng nào — sẽ xuất hiện sau khi Song Châu gửi cho bạn'
            }
          />
          {!loading && total > 0 && (
            <p className="mt-2 text-right text-xs text-slate-400">
              Hiển thị {contracts.length}/{total} hợp đồng
            </p>
          )}
        </>
      )}
    </main>
  );
}
