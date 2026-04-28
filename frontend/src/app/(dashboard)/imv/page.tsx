'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Building2, RefreshCw, Search, AlertCircle, Clock,
  Users as UsersIcon, FileText, ExternalLink, ChevronLeft, ChevronRight,
} from 'lucide-react';

type RFQ = {
  id: number;
  rfq_number: string;
  status_text: string | null;
  handler_name: string | null;
  handler_login: string | null;
  customer_name: string | null;
  customer_facility: string | null;
  customer_item_code: string | null;
  item_code: string | null;
  product_name: string | null;
  model: string | null;
  spec: string | null;
  maker: string | null;
  unit: string | null;
  quantity: number | null;
  offered_qty: number | null;
  request_date: string | null;
  due_date: string | null;
  due_time: string | null;
  doc_type: string | null;
  flow_status: string | null;
  request_id: string | null;
  last_seen_at: string | null;
};

type KpiResp = {
  kpi: {
    total: number;
    open_rfq: number;
    overdue: number;
    due_today: number;
    customers: number;
    handlers: number;
    last_sync: string | null;
  };
  last_sync: {
    status: string;
    total_records: number | null;
    new_records: number | null;
    updated_records: number | null;
    error_message: string | null;
    started_at: string;
    finished_at: string | null;
    duration_seconds: number | null;
  } | null;
};

const PAGE_SIZE = 30;

const fmtDateVN = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const dueColor = (due: string | null) => {
  if (!due) return 'text-slate-400';
  const d = new Date(due);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = (d.getTime() - today.getTime()) / 86400000;
  if (diff < 0) return 'text-rose-700 bg-rose-50';
  if (diff <= 1) return 'text-amber-700 bg-amber-50';
  return 'text-slate-600';
};

export default function IMVPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [kpi, setKpi] = useState<KpiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const offset = (page - 1) * PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadKpi = async () => {
    try {
      const r = await api.get<KpiResp>('/api/v1/imv/kpi');
      setKpi(r);
    } catch {}
  };

  const loadRfqs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (q.trim()) params.set('q', q.trim());
      const r = await api.get<{ data: { items: RFQ[]; total: number } }>(`/api/v1/imv/rfq?${params}`);
      setRfqs(r.data.items);
      setTotal(r.data.total);
    } catch (e) {
      console.error('imv load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadKpi(); }, []);
  useEffect(() => { loadRfqs(); /* eslint-disable-next-line */ }, [page]);

  const onSearch = () => { setPage(1); loadRfqs(); };

  const triggerSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.post<{ message: string; task_id?: string }>('/api/v1/imv/sync');
      setSyncMsg(r.message + ' — Sync chạy nền, refresh sau 1-2 phút');
    } catch (e: any) {
      setSyncMsg('Lỗi: ' + (e?.detail || 'không sync được'));
    } finally {
      setSyncing(false);
      setTimeout(loadKpi, 30_000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-rose-50/20 -m-6 p-6">
      <motion.div
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 px-6 py-4 backdrop-blur-md bg-white/70 border-b border-slate-200/80"
      >
        <div className="flex items-center justify-between gap-4 max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 shadow-lg shadow-rose-500/30 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 leading-tight">IMV — iMarketVietnam</h1>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <Clock className="h-3 w-3" />
                <span>Đồng bộ tự động 23:50 mỗi đêm</span>
                {kpi?.last_sync && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Lần cuối: {fmtDateVN(kpi.last_sync.started_at)}</span>
                    <span className={cn(
                      'ml-1 inline-flex items-center px-1.5 py-0.5 rounded font-medium',
                      kpi.last_sync.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                      kpi.last_sync.status === 'error' ? 'bg-rose-50 text-rose-700' :
                      'bg-amber-50 text-amber-700',
                    )}>
                      {kpi.last_sync.status}
                    </span>
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
            {syncing ? 'Đang gửi…' : 'Sync ngay'}
          </button>
        </div>
        {syncMsg && (
          <div className="max-w-[1600px] mx-auto mt-2 text-xs text-slate-600 px-1">{syncMsg}</div>
        )}
      </motion.div>

      <div className="max-w-[1600px] mx-auto space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Tổng RFQ" value={kpi?.kpi.total ?? 0} />
          <Stat label="Đang mở" value={kpi?.kpi.open_rfq ?? 0} accent="emerald" />
          <Stat label="Hết hạn hôm nay" value={kpi?.kpi.due_today ?? 0} accent="amber" />
          <Stat label="Quá hạn" value={kpi?.kpi.overdue ?? 0} accent="rose" />
        </div>

        {/* Search bar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400 ml-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Tìm theo Số RFQ, Mã hàng, Tên sản phẩm…"
            className="flex-1 outline-none text-sm placeholder:text-slate-400"
          />
          <button
            onClick={onSearch}
            className="h-8 px-3 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >
            Tìm kiếm
          </button>
        </div>

        {/* RFQ table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                <tr>
                  <Th>Số RFQ</Th>
                  <Th>Trạng thái</Th>
                  <Th>Khách hàng</Th>
                  <Th>Cơ sở</Th>
                  <Th>Mã hàng</Th>
                  <Th>Sản phẩm</Th>
                  <Th>Nhà SX</Th>
                  <Th className="text-right">SL</Th>
                  <Th>Đơn vị</Th>
                  <Th>Yêu cầu</Th>
                  <Th>Hết hạn</Th>
                  <Th>Phụ trách</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}><td colSpan={12}><div className="h-10 bg-slate-50 animate-pulse" /></td></tr>
                  ))
                ) : rfqs.length === 0 ? (
                  <tr><td colSpan={12} className="text-center text-slate-400 py-12">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>Chưa có RFQ. Bấm "Sync ngay" để kéo từ IMV portal.</p>
                  </td></tr>
                ) : (
                  rfqs.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <Td><span className="font-mono font-semibold text-slate-900">{r.rfq_number}</span></Td>
                      <Td><Badge text={r.status_text} status={r.flow_status} /></Td>
                      <Td className="max-w-[200px] truncate" title={r.customer_name || ''}>
                        {r.customer_name || '—'}
                      </Td>
                      <Td className="text-slate-500">{r.customer_facility || '—'}</Td>
                      <Td><span className="font-mono">{r.item_code || '—'}</span></Td>
                      <Td className="max-w-[280px] truncate" title={r.product_name || ''}>
                        <div className="font-medium text-slate-800 truncate">{r.product_name || '—'}</div>
                        {r.model && <div className="text-[10px] text-slate-400 truncate">{r.model}</div>}
                      </Td>
                      <Td>{r.maker || '—'}</Td>
                      <Td className="text-right tabular-nums">{r.quantity ?? '—'}</Td>
                      <Td>{r.unit || '—'}</Td>
                      <Td className="font-mono text-[11px]">{fmtDateVN(r.request_date)}</Td>
                      <Td>
                        <span className={cn('font-mono text-[11px] px-1.5 py-0.5 rounded', dueColor(r.due_date))}>
                          {fmtDateVN(r.due_date)}{r.due_time ? ` · ${r.due_time.slice(0,5)}` : ''}
                        </span>
                      </Td>
                      <Td className="text-slate-600">{r.handler_name || r.handler_login || '—'}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>Hiển thị {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total} RFQ</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 tabular-nums">Trang {page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30"
                >
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

function Stat({ label, value, accent = 'sky' }: { label: string; value: number; accent?: 'sky'|'emerald'|'amber'|'rose' }) {
  const bar = { sky: 'bg-sky-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }[accent];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative p-5">
      <div className={cn('absolute top-0 left-0 right-0 h-0.5', bar)} />
      <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-semibold">{label}</div>
      <div className="mt-2 text-[28px] font-bold text-slate-900 tabular-nums tracking-tight leading-tight">{value}</div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('text-left px-3 py-2 font-semibold whitespace-nowrap', className)}>{children}</th>;
}
function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}

function Badge({ text, status }: { text: string | null; status: string | null }) {
  if (!text) return <span className="text-slate-400">—</span>;
  const cls =
    status === 'P03' ? 'bg-amber-50 text-amber-700' :
    status?.startsWith('P0') ? 'bg-sky-50 text-sky-700' :
    'bg-slate-100 text-slate-600';
  return <span className={cn('inline-block px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap', cls)}>{text}</span>;
}
