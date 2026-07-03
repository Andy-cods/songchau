'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Building2, RefreshCw, Search, Clock, ExternalLink,
  ChevronLeft, ChevronRight, FileText, Package, Truck, CreditCard,
  ScrollText, Ban, DollarSign, TrendingUp, Users, Gavel, X,
} from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import { useUserRole } from '@/hooks/use-permissions';
import { PushToBiddingModal } from '@/components/sourcing/PushToBiddingModal';

type Entity = 'rfq' | 'orders' | 'deliveries' | 'payments' | 'contracts' | 'rejections';

const ENTITIES: Array<{
  key: Entity;
  label: string;
  icon: any;
  color: string;
  columns: Array<{ key: string; label: string; w?: string; format?: 'date'|'num'|'money'|'badge'|'truncate' }>;
}> = [
  {
    key: 'rfq', label: 'Yêu cầu báo giá', icon: FileText, color: 'sky',
    columns: [
      { key: 'rfq_number', label: 'Số RFQ', w: '120px' },
      { key: 'status_text', label: 'Trạng thái', format: 'badge', w: '130px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'item_code', label: 'Mã hàng', w: '110px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '260px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'unit', label: 'ĐV', w: '60px' },
      { key: 'request_date', label: 'Ngày YC', format: 'date', w: '95px' },
      { key: 'due_date', label: 'Hết hạn', format: 'date', w: '95px' },
      { key: 'handler_name', label: 'Phụ trách', format: 'truncate', w: '140px' },
    ],
  },
  {
    key: 'orders', label: 'Đặt hàng', icon: Package, color: 'emerald',
    columns: [
      { key: 'po_number', label: 'PO#', w: '130px' },
      { key: 'status_text', label: 'Trạng thái', format: 'badge', w: '160px' },
      { key: 'order_date', label: 'Ngày ĐH', format: 'date', w: '95px' },
      { key: 'delivery_due', label: 'Hết hạn giao', format: 'date', w: '110px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'item_code', label: 'Mã hàng', w: '100px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '240px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'unit', label: 'ĐV', w: '60px' },
      { key: 'unit_price', label: 'Đơn giá', format: 'money', w: '110px' },
      { key: 'amount', label: 'Tổng', format: 'money', w: '120px' },
      { key: 'currency', label: 'CCY', w: '50px' },
      { key: 'handler_name', label: 'Phụ trách', format: 'truncate', w: '140px' },
    ],
  },
  {
    key: 'deliveries', label: 'Giao hàng', icon: Truck, color: 'amber',
    columns: [
      { key: 'shipment_id', label: 'Mã giao', w: '120px' },
      { key: 'status', label: 'Trạng thái', format: 'badge', w: '90px' },
      { key: 'po_number', label: 'PO#', w: '120px' },
      { key: 'item_code', label: 'Mã hàng', w: '100px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '240px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'confirmed_qty', label: 'Đã nhận', format: 'num', w: '70px' },
      { key: 'unit', label: 'ĐV', w: '60px' },
      { key: 'due_date', label: 'Hạn giao', format: 'date', w: '95px' },
      { key: 'shipped_date', label: 'Ngày gửi', format: 'date', w: '95px' },
      { key: 'confirmed_date', label: 'Ngày nhận', format: 'date', w: '95px' },
    ],
  },
  {
    key: 'payments', label: 'Thanh toán', icon: CreditCard, color: 'brand',
    columns: [
      { key: 'invoice_id', label: 'Số HĐ', w: '120px' },
      { key: 'invoice_date', label: 'Ngày HĐ', format: 'date', w: '95px' },
      { key: 'po_no', label: 'PO#', w: '120px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'item_code', label: 'Mã hàng', w: '100px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '240px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'unit', label: 'ĐV', w: '60px' },
      { key: 'unit_price', label: 'Đơn giá', format: 'money', w: '110px' },
      { key: 'total_amount', label: 'Tổng', format: 'money', w: '120px' },
      { key: 'currency', label: 'CCY', w: '50px' },
      { key: 'payment_method', label: 'Phương thức', format: 'truncate', w: '140px' },
    ],
  },
  {
    key: 'contracts', label: 'Hợp đồng', icon: ScrollText, color: 'sky',
    columns: [
      { key: 'contract_id', label: 'Số HĐ', w: '120px' },
      { key: 'contract_date', label: 'Ngày', format: 'date', w: '95px' },
      { key: 'rfq_number', label: 'RFQ#', w: '120px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'item_code', label: 'Mã hàng', w: '100px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '240px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'unit_price', label: 'Đơn giá', format: 'money', w: '110px' },
      { key: 'total_amount', label: 'Tổng', format: 'money', w: '120px' },
      { key: 'status_text', label: 'Trạng thái', format: 'badge', w: '120px' },
    ],
  },
  {
    key: 'rejections', label: 'Từ chối', icon: Ban, color: 'rose',
    columns: [
      { key: 'rejection_id', label: 'Mã TC', w: '120px' },
      { key: 'rejection_date', label: 'Ngày', format: 'date', w: '95px' },
      { key: 'shipment_id', label: 'Mã giao', w: '120px' },
      { key: 'customer_name', label: 'Khách hàng', format: 'truncate', w: '200px' },
      { key: 'item_code', label: 'Mã hàng', w: '100px' },
      { key: 'product_name', label: 'Sản phẩm', format: 'truncate', w: '240px' },
      { key: 'quantity', label: 'SL', format: 'num', w: '60px' },
      { key: 'reason', label: 'Lý do', format: 'truncate', w: '300px' },
      { key: 'status_text', label: 'Trạng thái', format: 'badge', w: '120px' },
    ],
  },
];

const PAGE_SIZE = 30;

const fmtDateVN = (s: any) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};
const fmtMoney = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return v == null ? '—' : '0';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n));
};
const fmtNum = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
};

const dueColor = (due: any) => {
  if (!due) return 'text-slate-400';
  const d = new Date(due);
  if (isNaN(d.getTime())) return 'text-slate-400';
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = (d.getTime() - today.getTime()) / 86400000;
  if (diff < 0) return 'bg-rose-50 text-rose-700';
  if (diff <= 1) return 'bg-amber-50 text-amber-700';
  return 'text-slate-600';
};

export default function IMVPage() {
  const [tab, setTab] = useState<Entity>('rfq');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<Entity, number>>({} as any);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<any>(null);

  // Multi-select → đẩy mã RFQ sang đấu thầu NCC (chỉ tab RFQ).
  const userRole = useUserRole();
  const canPushBidding = ['admin', 'manager', 'procurement'].includes(userRole);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pushIds, setPushIds] = useState<number[] | null>(null);

  const cfg = useMemo(() => ENTITIES.find(e => e.key === tab)!, [tab]);
  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Mã IMV "gửi được" = đang ở tab RFQ và có mã hàng (item_code) để NCC báo giá.
  // Chỉ tab RFQ mới biddable vì backend import-from-imv đọc từ bảng imv_rfq.
  const showSelect = tab === 'rfq' && canPushBidding;
  const isSelectableImv = useCallback(
    (r: any) => tab === 'rfq' && !!(r?.item_code && String(r.item_code).trim()),
    [tab],
  );
  const pushableIds = useMemo(
    () => (showSelect ? rows.filter(isSelectableImv).map((r) => r.id as number) : []),
    [showSelect, rows, isSelectableImv],
  );
  const allChecked = pushableIds.length > 0 && pushableIds.every((id) => selectedIds.has(id));

  const toggleOne = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((ids: number[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  const loadKpi = async () => {
    try {
      const r = await api.get<any>('/api/v1/imv/kpi');
      setCounts(r.counts || {});
      setLastSync(r.last_sync);
    } catch {}
  };

  const loadList = async () => {
    setLoading(true);
    setSelectedIds(new Set()); // tránh giữ id cũ khi đổi tab/trang/tìm kiếm
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (q.trim()) params.set('q', q.trim());
      const r = await api.get<any>(`/api/v1/imv/${tab}/list?${params}`);
      setRows(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (e) {
      console.error('imv list failed', e);
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadKpi(); }, []);
  useEffect(() => { setPage(1); setQ(''); }, [tab]);
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [tab, page]);

  const triggerSync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await api.post<any>('/api/v1/imv/sync');
      setSyncMsg(`${r.message}. Sync chạy nền 30-90 giây.`);
      setTimeout(() => { loadKpi(); loadList(); }, 45_000);
    } catch (e: any) {
      setSyncMsg('Lỗi: ' + (e?.detail || 'không sync được'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 -m-6 p-6">
      <motion.div
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 px-6 py-4 backdrop-blur-md bg-white/70 border-b border-slate-200/80"
      >
        <div className="flex items-center justify-between gap-4 max-w-[1700px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-50 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 leading-tight">IMV — iMarketVietnam</h1>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <Clock className="h-3 w-3" />
                <span>Tự động sync 23:50 mỗi đêm</span>
                {lastSync && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Lần cuối: {fmtDateVN(lastSync.started_at)}</span>
                    <span className={cn(
                      'ml-1 px-1.5 py-0.5 rounded font-medium',
                      lastSync.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                      lastSync.status === 'error' ? 'bg-rose-50 text-rose-700' :
                      'bg-amber-50 text-amber-700',
                    )}>{lastSync.status}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'Đang gửi…' : 'Sync tất cả'}
          </button>
        </div>
        {syncMsg && (
          <div className="max-w-[1700px] mx-auto mt-2 text-xs text-slate-600 px-1">{syncMsg}</div>
        )}
      </motion.div>

      <div className="max-w-[1700px] mx-auto space-y-5">
        <ImvStatsStrip />

        {/* Entity tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap gap-1">
          {ENTITIES.map((e) => {
            const Icon = e.icon;
            const active = tab === e.key;
            const count = counts[e.key] ?? 0;
            return (
              <button
                key={e.key}
                onClick={() => setTab(e.key)}
                className={cn(
                  'inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{e.label}</span>
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[22px] h-[18px] rounded-md text-[11px] font-bold tabular-nums px-1',
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                )}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400 ml-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setPage(1), loadList())}
            placeholder={`Tìm trong ${cfg.label.toLowerCase()}…`}
            className="flex-1 outline-none text-sm placeholder:text-slate-400"
          />
          <button
            onClick={() => { setPage(1); loadList(); }}
            className="h-8 px-3 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >Tìm kiếm</button>
        </div>

        {/* Thanh hành động khi đã chọn mã (chỉ tab RFQ + đủ quyền) */}
        {showSelect && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-brand-200 bg-brand-50/60 px-5 py-3.5"
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-brand-600 flex items-center justify-center">
                  <Gavel className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-brand-900">{selectedIds.size} mã đã chọn</div>
                  <div className="text-xs text-brand-700">Chỉ gửi tên hàng / mã / số lượng · không chia sẻ giá nội bộ</div>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPushIds(Array.from(selectedIds))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 transition-colors shadow-sm"
                >
                  <Gavel className="h-4 w-4" />
                  Gửi đấu thầu ({selectedIds.size})
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                >
                  <X className="h-3.5 w-3.5" /> Bỏ chọn
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Data table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                {showSelect && (
                  <TableHead className="w-10" style={{ minWidth: '40px' }}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600 cursor-pointer disabled:opacity-40"
                      checked={allChecked}
                      disabled={pushableIds.length === 0}
                      onChange={(e) => toggleAll(pushableIds, e.target.checked)}
                      aria-label="Chọn tất cả mã gửi được trên trang"
                      title="Chọn / bỏ chọn tất cả mã có mã hàng trên trang này"
                    />
                  </TableHead>
                )}
                {cfg.columns.map((c) => (
                  <TableHead key={c.key} className="whitespace-nowrap" style={{ minWidth: c.w }}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={cfg.columns.length + (showSelect ? 1 : 0)} className="p-0"><Skeleton className="h-10 w-full rounded-none" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={cfg.columns.length + (showSelect ? 1 : 0)} className="p-0">
                  <EmptyState
                    icon={cfg.icon}
                    heading={`Chưa có ${cfg.label.toLowerCase()}.`}
                    description={'Bấm "Sync tất cả" ở header để kéo từ IMV portal.'}
                  />
                </TableCell></TableRow>
              ) : (
                rows.map((r, ri) => (
                  <TableRow key={r.id || ri}>
                    {showSelect && (
                      <TableCell className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 accent-brand-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          checked={selectedIds.has(r.id)}
                          disabled={!isSelectableImv(r)}
                          onChange={() => toggleOne(r.id)}
                          aria-label={`Chọn mã ${r.item_code ?? r.rfq_number ?? r.id} để gửi đấu thầu`}
                          title={isSelectableImv(r) ? 'Chọn để gửi đấu thầu NCC' : 'Chưa có mã hàng — không gửi được'}
                        />
                      </TableCell>
                    )}
                    {cfg.columns.map((c) => {
                      const v = r[c.key];
                      let content: React.ReactNode = '—';
                      let cls = '';
                      if (v == null || v === '') content = '—';
                      else if (c.format === 'date') {
                        const formatted = fmtDateVN(v);
                        if (c.key === 'due_date' || c.key === 'delivery_due') {
                          content = <span className={cn('font-mono text-[11px] px-1.5 py-0.5 rounded', dueColor(v))}>{formatted}</span>;
                        } else {
                          content = <span className="font-mono text-[11px]">{formatted}</span>;
                        }
                      } else if (c.format === 'money') {
                        content = <span className="tabular-nums">{fmtMoney(v)}</span>;
                        cls = 'text-right';
                      } else if (c.format === 'num') {
                        content = <span className="tabular-nums">{fmtNum(v)}</span>;
                        cls = 'text-right';
                      } else if (c.format === 'badge') {
                        content = <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 whitespace-nowrap">{v}</span>;
                      } else if (c.format === 'truncate') {
                        content = <span className="block truncate" title={String(v)}>{v}</span>;
                        cls = 'max-w-[260px]';
                      } else {
                        content = <span className="font-mono text-slate-800">{v}</span>;
                      }
                      return (
                        <TableCell key={c.key} className={cn('px-3 py-2 align-middle', cls)}>{content}</TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {total > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>Hiển thị {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total} {cfg.label.toLowerCase()}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 tabular-nums">Trang {page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page >= totalPages}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs text-slate-400 pt-2 pb-6">
          Dữ liệu nguồn: <a href="https://www.imvmall.com" target="_blank" rel="noreferrer" className="underline hover:text-slate-600 inline-flex items-center gap-1">imvmall.com <ExternalLink className="h-3 w-3" /></a>
        </div>
      </div>

      {pushIds && pushIds.length > 0 && (
        <PushToBiddingModal
          source="imv"
          ids={pushIds}
          onClose={() => setPushIds(null)}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}

interface ImvStats {
  po: {
    total_count: number;
    total_value_vnd: number | null;
    value_in_window_vnd: number | null;
    count_in_window: number;
  };
  rfq: {
    total: number;
    quoted_by_offered_qty: number;
    quoted_by_status: number;
    quote_rate_pct: number;
    total_qty_requested: number | null;
    total_qty_quoted: number | null;
  };
  top_customers: Array<{ customer_name: string; po_count: number; total_value_vnd: number | null }>;
  monthly_trend: Array<{ month_key: string; rfq_count: number; quoted_count: number; qty_requested: number | null }>;
}

function ImvStatsStrip() {
  const [stats, setStats] = useState<ImvStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<{ data: ImvStats }>('/api/v1/imv/stats?months=12')
      .then((res) => { if (!cancelled) setStats(res.data); })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '—';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return Number(v).toLocaleString('vi-VN');
  };
  const fmtNum = (v: number | null | undefined) => {
    if (v == null) return '—';
    return Number(v).toLocaleString('vi-VN');
  };

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-slate-200 bg-white animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<DollarSign className="h-4 w-4" />}
          label="Tổng giá trị PO"
          value={fmt(stats.po.total_value_vnd)}
          hint={`${stats.po.total_count} PO · 12M: ${fmt(stats.po.value_in_window_vnd)}`}
          tone="emerald"
        />
        <StatTile
          icon={<FileText className="h-4 w-4" />}
          label="Số RFQ đã báo giá"
          value={`${stats.rfq.quoted_by_offered_qty}/${stats.rfq.total}`}
          hint={`Tỷ lệ ${stats.rfq.quote_rate_pct}% · status quoted: ${stats.rfq.quoted_by_status}`}
          tone="sky"
        />
        <StatTile
          icon={<Package className="h-4 w-4" />}
          label="Số lượng đã hỏi"
          value={fmtNum(stats.rfq.total_qty_requested)}
          hint={`Đã chào: ${fmtNum(stats.rfq.total_qty_quoted)}`}
          tone="amber"
        />
        <StatTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Hoạt động 12 tháng gần"
          value={fmtNum(stats.po.count_in_window)}
          hint={`PO · trị giá ${fmt(stats.po.value_in_window_vnd)}`}
          tone="violet"
        />
      </div>

      {stats.top_customers.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Top 5 khách hàng theo giá trị PO</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {stats.top_customers.map((c, idx) => (
              <div key={c.customer_name} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-400">#{idx + 1}</span>
                  <span className="truncate text-xs font-medium text-slate-800">{c.customer_name}</span>
                </div>
                <p className="mt-1 font-mono text-sm font-bold text-emerald-700">{fmt(c.total_value_vnd)} ₫</p>
                <p className="text-[11px] text-slate-500">{c.po_count} PO</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: 'emerald' | 'sky' | 'amber' | 'violet';
}) {
  // KPI tiles are count/value only (no status meaning) → single brand accent,
  // not a rainbow of tones (design restraint).
  void tone;
  const toneClass = 'text-brand-600';
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', toneClass)}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <div className="rounded-full bg-white/80 p-1.5">{icon}</div>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] text-slate-600">{hint}</p>
    </div>
  );
}
