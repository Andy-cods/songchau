'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Building2, RefreshCw, Search, Clock, ExternalLink,
  ChevronLeft, ChevronRight, FileText, Package, Truck, CreditCard,
  ScrollText, Ban,
} from 'lucide-react';

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
    key: 'payments', label: 'Thanh toán', icon: CreditCard, color: 'violet',
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

  const cfg = useMemo(() => ENTITIES.find(e => e.key === tab)!, [tab]);
  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadKpi = async () => {
    try {
      const r = await api.get<any>('/api/v1/imv/kpi');
      setCounts(r.counts || {});
      setLastSync(r.last_sync);
    } catch {}
  };

  const loadList = async () => {
    setLoading(true);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-rose-50/20 -m-6 p-6">
      <motion.div
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 px-6 py-4 backdrop-blur-md bg-white/70 border-b border-slate-200/80"
      >
        <div className="flex items-center justify-between gap-4 max-w-[1700px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 shadow-lg shadow-rose-500/30 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-white" />
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
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
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
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{e.label}</span>
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[22px] h-[18px] rounded-md text-[10px] font-bold tabular-nums px-1',
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
            className="h-8 px-3 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >Tìm kiếm</button>
        </div>

        {/* Data table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                <tr>
                  {cfg.columns.map((c) => (
                    <th key={c.key} className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ minWidth: c.w }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}><td colSpan={cfg.columns.length}><div className="h-10 bg-slate-50 animate-pulse" /></td></tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={cfg.columns.length} className="text-center text-slate-400 py-12">
                    <cfg.icon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>Chưa có {cfg.label.toLowerCase()}.</p>
                    <p className="mt-1 text-[11px]">Bấm "Sync tất cả" ở header để kéo từ IMV portal.</p>
                  </td></tr>
                ) : (
                  rows.map((r, ri) => (
                    <tr key={r.id || ri} className="hover:bg-slate-50">
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
                          content = <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 whitespace-nowrap">{v}</span>;
                        } else if (c.format === 'truncate') {
                          content = <span className="block truncate" title={String(v)}>{v}</span>;
                          cls = 'max-w-[260px]';
                        } else {
                          content = <span className="font-mono text-slate-800">{v}</span>;
                        }
                        return (
                          <td key={c.key} className={cn('px-3 py-2 align-middle', cls)}>{content}</td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}
