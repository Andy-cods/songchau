'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageOpen, Truck, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoneyNum } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatStrip } from '@/components/ui/StatStrip';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { Deadline } from '@/components/ui/Deadline';
import { cn } from '@/lib/cn';
import type { VendorPo } from '@/lib/types';

// Chip lọc theo trạng thái PO. 'all' là bucket tổng hợp (đếm toàn bộ).
type PoFilter = 'all' | 'open' | 'partially_delivered' | 'delivered' | 'closed';
const PO_FILTER_ORDER: PoFilter[] = ['all', 'open', 'partially_delivered', 'delivered', 'closed'];
const PO_FILTER_LABEL: Record<PoFilter, string> = {
  all: 'Tất cả',
  open: 'Đang mở',
  partially_delivered: 'Giao một phần',
  delivered: 'Đã giao',
  closed: 'Đã đóng',
};

// Clamp a possibly-string server pct into a 0..100 number.
function pct(v?: number | null): number {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0;
  if (n == null || isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// "X/Y mục — N%" progress cell derived from item_count + delivered_pct. Reads
// the count of fully-delivered mục back out of the server pct (rounded), so a
// PO with no item_count still shows a sensible "— · N%".
function DeliveryProgress({ po }: { po: VendorPo }) {
  const p = pct(po.delivered_pct);
  const total = po.item_count ?? null;
  const done = total != null ? Math.round((p / 100) * total) : null;
  const complete = p >= 100;
  return (
    <span className="inline-flex w-full max-w-[150px] flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[11px]">
        <span className="tabular-nums text-slate-600">
          {total != null ? `${done}/${total} mục` : '—'}
        </span>
        <span
          className={`font-semibold tabular-nums ${complete ? 'text-emerald-600' : 'text-slate-500'}`}
        >
          {p}%
        </span>
      </span>
      <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${complete ? 'bg-emerald-500' : 'bg-brand-500'}`}
          style={{ width: `${p}%` }}
        />
      </span>
    </span>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const [pos, setPos] = useState<VendorPo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<PoFilter>('all');

  // PRESERVED fetch — GET /api/vendor/pos, unchanged.
  useEffect(() => {
    api
      .get<{ data: VendorPo[] }>('/api/vendor/pos')
      .then(res => setPos(res.data || []))
      .catch(() => setError('Không tải được danh sách đơn hàng'))
      .finally(() => setLoading(false));
  }, []);

  // KPI strip — derived from the same fetched rows, no extra calls.
  const stats = useMemo(() => {
    const open = pos.filter(p => p.status === 'open').length;
    const partial = pos.filter(p => p.status === 'partially_delivered').length;
    const done = pos.filter(p => p.status === 'delivered' || p.status === 'closed').length;
    return { open, partial, done };
  }, [pos]);

  // Số lượng cho từng chip (tính 1 lần trên toàn danh sách).
  const filterCounts = useMemo(() => {
    const c: Record<PoFilter, number> = {
      all: pos.length,
      open: 0,
      partially_delivered: 0,
      delivered: 0,
      closed: 0,
    };
    for (const p of pos) {
      if (p.status === 'open') c.open += 1;
      else if (p.status === 'partially_delivered') c.partially_delivered += 1;
      else if (p.status === 'delivered') c.delivered += 1;
      else if (p.status === 'closed') c.closed += 1;
    }
    return c;
  }, [pos]);

  // Lọc client-side theo chip trạng thái + tìm số PO / số HĐ (case-insensitive).
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pos.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        p.po_no.toLowerCase().includes(needle) ||
        (p.contract_no ?? '').toLowerCase().includes(needle)
      );
    });
  }, [pos, q, statusFilter]);

  const columns: Column<VendorPo>[] = [
    {
      key: 'po_no',
      header: 'Số PO',
      w: 150,
      render: row => (
        <span className="font-mono text-[11px] font-medium text-brand-700">{row.po_no}</span>
      ),
    },
    {
      key: 'contract_no',
      header: 'HĐ',
      w: 130,
      render: row => (
        <span className="font-mono text-[11px] text-slate-500">{row.contract_no ?? '—'}</span>
      ),
    },
    {
      key: 'po_date',
      header: 'Ngày PO',
      w: 104,
      align: 'right',
      format: 'date',
    },
    {
      key: 'requested_delivery_date',
      header: 'Hạn giao',
      w: 180,
      render: row => <Deadline date={row.requested_delivery_date ?? null} />,
    },
    {
      key: 'total_amount',
      header: 'Tổng tiền',
      w: 150,
      align: 'right',
      render: row => (
        <span className="font-mono tabular-nums text-slate-800">
          {formatMoneyNum(row.total_amount, row.currency)}
        </span>
      ),
    },
    {
      key: 'item_count',
      header: 'Số mục',
      w: 76,
      align: 'right',
      format: 'num',
    },
    {
      key: 'delivered_pct',
      header: 'Tiến độ',
      w: 170,
      render: row => <DeliveryProgress po={row} />,
    },
    {
      key: 'status',
      header: 'TT',
      w: 128,
      align: 'center',
      render: row => <StatusChip kind="po" status={row.status} />,
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        title="Đơn hàng"
        count={pos.length}
        subtitle="Đơn đặt hàng (P/O) Song Châu gửi cho bạn"
      />

      <StatStrip
        className="mb-5"
        items={[
          {
            label: 'Đang mở',
            value: stats.open,
            hint: 'chờ giao hàng',
            icon: <PackageOpen className="h-4 w-4" />,
            tone: 'sky',
          },
          {
            label: 'Giao một phần',
            value: stats.partial,
            hint: 'đang giao dở',
            icon: <Truck className="h-4 w-4" />,
            tone: 'amber',
          },
          {
            label: 'Hoàn tất',
            value: stats.done,
            hint: 'đã giao / đã đóng',
            icon: <CheckCircle2 className="h-4 w-4" />,
            tone: 'emerald',
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
          {/* Tìm + lọc — chỉ hiện khi đã có dữ liệu (không che skeleton/empty). */}
          {!loading && pos.length > 0 && (
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchBar
                value={q}
                onChange={setQ}
                placeholder="Tìm số PO / số HĐ…"
                className="max-w-md sm:flex-1"
              />
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc theo trạng thái">
                {PO_FILTER_ORDER.map(key => {
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
                      {PO_FILTER_LABEL[key]}
                      <span className={cn('tabular-nums', active ? 'text-brand-500' : 'text-slate-400')}>
                        {filterCounts[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DataTable<VendorPo>
            columns={columns}
            rows={visible}
            loading={loading}
            // PRESERVED nav — row click → /orders/{id}.
            onRowClick={row => router.push(`/orders/${row.id}`)}
            emptyIcon={<PackageOpen className="h-8 w-8" />}
            emptyLabel={
              pos.length > 0
                ? 'Không có đơn hàng khớp bộ lọc'
                : 'Chưa có đơn hàng nào — đơn đặt hàng sẽ xuất hiện sau khi Song Châu tạo P/O'
            }
          />
        </>
      )}
    </main>
  );
}
