'use client';

// Phase 4.3 (Thang 2026-05-12 audit follow-up):
// MRO PO browser — list Samsung POs từ bqms_samsung_po. Mỗi PO link tới
// bqms_deliveries (Giao hàng) qua samsung_po_id FK.

import { useState, useEffect, useCallback } from 'react';
import { Search, Package, RefreshCw, Filter, ArrowRight, Truck } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

interface MroPO {
  id: number;
  po_number: string | null;
  po_date: string | null;
  bqms_code: string | null;
  specification: string | null;
  maker: string | null;
  order_qty: number | null;
  unit_price: number | null;
  amount: number | null;
  currency: string | null;
  preferred_delivery_date: string | null;
  process_status: string | null;
  vendor_code: string | null;
  buyer_name: string | null;
  company: string | null;
  plant: string | null;
  shipping_qty: number | null;
  gr_qty: number | null;
  invoice_qty: number | null;
  delivery_count: number;
}

type ListResp = {
  data: { items: MroPO[]; total: number; page: number; page_size: number };
};

const fmtNum = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0));

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const STATUS_COLOR: Record<string, string> = {
  ordered:        'bg-amber-100 text-amber-700',
  confirmed:      'bg-sky-100 text-sky-700',
  in_production:  'bg-brand-50 text-brand-700',
  shipping:       'bg-orange-100 text-orange-700',
  delivered:      'bg-emerald-100 text-emerald-700',
  closed:         'bg-slate-100 text-slate-600',
  cancelled:      'bg-red-100 text-red-700',
};

export default function MroPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MroPO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), page_size: '100' });
      if (search.trim()) q.set('search', search.trim());
      if (statusFilter) q.set('process_status', statusFilter);
      const r = await api.get<ListResp>(`/api/v1/bqms/mro/po?${q.toString()}`);
      setItems(r.data.items);
      setTotal(r.data.total);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
  }, [fetchData]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">
      {/* Header — PageHeader primitive (T1.3 demo) */}
      <PageHeader
        icon={Package}
        title="MRO P/O Receipt (Samsung PO)"
        subtitle="Danh sách PO Samsung đã gửi — link với Giao hàng qua samsung_po_id"
        actions={
          <Link
            href="/bqms/deliveries"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold"
          >
            <Truck className="h-3.5 w-3.5" />
            Sang Giao hàng <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 flex-wrap shadow-sm">
        <div className="flex-1 min-w-[280px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Tìm PO No, BQMS code, spec, maker..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
        >
          <option value="">Mọi trạng thái</option>
          <option value="ordered">Đã đặt</option>
          <option value="confirmed">Xác nhận</option>
          <option value="in_production">Đang SX</option>
          <option value="shipping">Đang giao</option>
          <option value="delivered">Đã giao</option>
          <option value="closed">Đã đóng</option>
        </select>
        <button onClick={fetchData} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Làm mới
        </button>
        <div className="text-xs text-slate-500 ml-auto">
          Tổng: <span className="font-semibold">{total}</span> PO
        </div>
      </div>

      {/* Table — Card + Table primitive (T1.4 demo) */}
      <Card padded={false} className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              <TableHead>PO No.</TableHead>
              <TableHead>Ngày PO</TableHead>
              <TableHead>BQMS Code</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead>Maker</TableHead>
              <TableHead className="text-right">SL đặt</TableHead>
              <TableHead className="text-right">Đơn giá</TableHead>
              <TableHead className="text-right">Giá trị</TableHead>
              <TableHead>Hạn giao</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-center">Giao hàng</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={11}><div className="h-5 bg-slate-100 animate-pulse rounded" /></TableCell></TableRow>
                ))
              : items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-semibold text-slate-800 dark:text-slate-100">{p.po_number ?? '—'}</TableCell>
                    <TableCell className="text-xs">{fmtDate(p.po_date)}</TableCell>
                    <TableCell className="font-mono text-xs text-brand-700 bg-brand-50/50 inline-block px-1.5 py-0.5 rounded">
                      {p.bqms_code ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-slate-600" title={p.specification ?? ''}>{p.specification ?? '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">{p.maker ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmtNum(p.order_qty)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtNum(p.unit_price)}</TableCell>
                    <TableCell className="text-right font-semibold text-slate-700">
                      {fmtNum(p.amount)} <span className="text-xs text-slate-400">{p.currency ?? 'VND'}</span>
                    </TableCell>
                    <TableCell className="text-xs">{fmtDate(p.preferred_delivery_date)}</TableCell>
                    <TableCell>
                      {p.process_status && (
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[11px] font-semibold',
                          STATUS_COLOR[p.process_status] ?? 'bg-slate-100 text-slate-600',
                        )}>
                          {p.process_status}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {p.delivery_count > 0 ? (
                        <Link
                          href={`/bqms/deliveries?po=${encodeURIComponent(p.po_number ?? '')}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[11px] font-semibold"
                        >
                          <Truck className="h-3 w-3" />
                          {p.delivery_count}
                        </Link>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
