'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Trophy, Pencil, Check, X, RefreshCw, Filter, FileSignature, Clipboard, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type WonRow = {
  id: number;
  rfq_number: string | null;
  bqms_code: string | null;
  person_in_charge_name: string | null;
  description: string | null;
  specification: string | null;
  quantity: number | null;
  unit: string | null;
  po_price: number | null;
  po_deadline: string | null;
  supplier_name: string | null;
  hs_code: string | null;
  goods_description: string | null;
  customs_char_count: number | null;
  notes: string | null;
  synced_at: string | null;
  // Phase 4.2 — Contract mapping (Thang 2026-05-12)
  contract_id: number | null;
  contract_no: string | null;
  contract_status: string | null;
};

type ListResp = {
  data: { items: WonRow[]; total: number; page: number; page_size: number };
};

const fmtNum = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0));

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function WonQuotationsPage() {
  const [activeTab, setActiveTab] = useState<'po' | 'contract'>('po');
  const [search, setSearch] = useState('');
  const [hasHs, setHasHs] = useState<'all' | 'filled' | 'missing'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number; field: 'hs_code' | 'goods_description'; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        page_size: '100',
      });
      if (search.trim()) q.set('search', search.trim());
      if (hasHs !== 'all') q.set('has_hs', hasHs);
      const r = await api.get<ListResp>(`/api/v1/bqms/won-quotations?${q.toString()}`);
      setItems(r.data.items);
      setTotal(r.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, hasHs, page]);

  // Debounced search + auto-refresh every 60s (real-time-ish, matches backend sync cron)
  useEffect(() => {
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const startEdit = (id: number, field: 'hs_code' | 'goods_description', currentValue: string | null) => {
    setEditing({ id, field, value: currentValue || '' });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.patch(`/api/v1/bqms/won-quotations/${editing.id}`, {
        [editing.field]: editing.value,
      });
      // optimistic update
      setItems((prev) =>
        prev.map((it) => (it.id === editing.id ? { ...it, [editing.field]: editing.value || null } : it)),
      );
      setEditing(null);
    } catch (e) {
      console.error(e);
      alert('Cập nhật thất bại');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 100));

  // Stats banner counts
  const filledCount = items.filter(i => i.hs_code).length;
  const missingCount = items.filter(i => !i.hs_code).length;

  return (
    <div className="space-y-5">
      {/* Header — flat brand block */}
      <div className="rounded-xl bg-brand-600 text-white p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3.5">
            <div className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur ring-1 ring-white/20 flex items-center justify-center shadow-sm">
              <Trophy className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">BQMS — Trúng BG</h1>
                <span className="text-[11px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full bg-white/15 ring-1 ring-white/20">
                  Sheet TRUNG BG
                </span>
              </div>
              <p className="text-xs text-white/80 mt-1">
                Auto-sync từ Excel · cron */2 phút · sửa HS Code & Mô tả không bị ghi đè
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 backdrop-blur ring-1 ring-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/25 transition disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Làm mới
          </button>
        </div>
        {/* Stats strip */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15 px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Tổng bản ghi</div>
            <div className="text-2xl font-bold tabular-nums leading-tight">{total.toLocaleString('vi-VN')}</div>
          </div>
          <div className="rounded-xl bg-emerald-300/20 ring-1 ring-emerald-200/30 px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Có HS Code</div>
            <div className="text-2xl font-bold tabular-nums leading-tight">{filledCount.toLocaleString('vi-VN')}</div>
          </div>
          <div className="rounded-xl bg-amber-400/20 ring-1 ring-amber-200/30 px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Chưa có HS</div>
            <div className="text-2xl font-bold tabular-nums leading-tight">{missingCount.toLocaleString('vi-VN')}</div>
          </div>
        </div>
      </div>

      {/* Per Thang 2026-05-13: Bỏ tab switcher, merge PO Trúng BG + Hợp đồng vào
          1 view duy nhất. Thông tin Contract đã được join + hiển thị qua cột
          "Hợp đồng" (badge CO-xxx). Component <ContractsTab/> giữ lại nhưng
          không expose tab UI nữa — có thể truy cập qua /bqms/contracts. */}

      {true && (
        <>
      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 flex-wrap shadow-sm">
        <div className="flex-1 min-w-[260px] relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm HS code, BQMS code, RFQ No, NCC, mô tả..."
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/40 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 focus:bg-white transition"
          />
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
          {(['all', 'filled', 'missing'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setHasHs(v);
                setPage(1);
              }}
              className={cn(
                'px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5',
                hasHs === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <Filter className="h-3 w-3" />
              {v === 'all' ? 'Tất cả' : v === 'filled' ? 'Có HS' : 'Chưa có HS'}
            </button>
          ))}
        </div>
        {/* Phase 3.2 (Thang 2026-05-12): bulk HS lookup */}
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold shadow-sm hover:shadow-md active:scale-95 transition-all"
          title="Paste danh sách BQMS code để tra HS hàng loạt"
        >
          <Clipboard className="h-3.5 w-3.5" />
          Tra HS hàng loạt
        </button>
      </div>

      {bulkOpen && <BulkHsLookupModal onClose={() => setBulkOpen(false)} />}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 border-b border-slate-200">
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                <th className="px-3 py-2.5 text-left">RFQ No.</th>
                <th className="px-3 py-2.5 text-left">BQMS Code</th>
                <th className="px-3 py-2.5 text-left">Spec</th>
                <th className="px-3 py-2.5 text-right">SL</th>
                <th className="px-3 py-2.5 text-right">Giá PO</th>
                <th className="px-3 py-2.5 text-left">NCC</th>
                <th className="px-3 py-2.5 text-left bg-amber-50/40 border-l border-amber-100">HS Code</th>
                <th className="px-3 py-2.5 text-left bg-amber-50/40">Mô tả hàng hóa</th>
                <th className="px-3 py-2.5 text-right bg-amber-50/40 border-r border-amber-100">SL kí tự</th>
                <th className="px-3 py-2.5 text-left bg-emerald-50/40 border-l border-emerald-100" title="Phase 4.2 — Hợp đồng đã ký mapped qua RFQ No">Hợp đồng</th>
                <th className="px-3 py-2.5 text-left">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td colSpan={10} className="px-3 py-3">
                      <div className="h-5 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-slate-400">
                    Không có kết quả
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/40">
                    <td className="px-3 py-2 font-mono text-emerald-700 font-medium whitespace-nowrap">
                      {row.rfq_number || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                      {row.bqms_code || '—'}
                    </td>
                    <td className="px-3 py-2 max-w-[260px] truncate" title={row.specification || ''}>
                      {row.specification || '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.po_price)}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate" title={row.supplier_name || ''}>
                      {row.supplier_name || '—'}
                    </td>

                    {/* HS Code (editable) */}
                    <EditableCell
                      row={row}
                      field="hs_code"
                      editing={editing}
                      saving={saving}
                      onStart={startEdit}
                      onCancel={cancelEdit}
                      onSave={saveEdit}
                      setEditing={setEditing}
                    />

                    {/* Goods description (editable) */}
                    <EditableCell
                      row={row}
                      field="goods_description"
                      editing={editing}
                      saving={saving}
                      onStart={startEdit}
                      onCancel={cancelEdit}
                      onSave={saveEdit}
                      setEditing={setEditing}
                      wide
                    />

                    <td className="px-3 py-2 text-right tabular-nums bg-amber-50/30 border-r border-amber-100">
                      {row.customs_char_count ?? '—'}
                    </td>

                    {/* Phase 4.2 — Contract column */}
                    <td className="px-3 py-2 bg-emerald-50/20 border-l border-emerald-100 whitespace-nowrap">
                      {row.contract_no ? (
                        <a
                          href={`/bqms/contracts/${row.contract_id}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[11px] font-semibold font-mono"
                          title={`Contract status: ${row.contract_status ?? 'N/A'}`}
                        >
                          {row.contract_no}
                        </a>
                      ) : (
                        <span className="text-slate-300 text-xs italic">chưa có</span>
                      )}
                    </td>

                    <td className="px-3 py-2 max-w-[140px] truncate text-slate-500" title={row.notes || ''}>
                      {row.notes || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 100 ? (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <div className="text-slate-500">
              Trang {page} / {totalPages} · {total.toLocaleString('vi-VN')} bản ghi
            </div>
            <div className="inline-flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Trước
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        ) : null}
      </div>
        </>
      )}
    </div>
  );
}

// ─── ContractsTab — list contracts staging (module='contract') ─────────
function ContractsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState<'all' | 'pending_review' | 'merged'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: '1', page_size: '200' });
      if (statusF !== 'all') q.set('status', statusF);
      if (search.trim()) q.set('search', search.trim());
      const r = await api.get<{ data: { items: any[]; total: number } }>(
        `/api/v1/bqms/staging/contracts?${q.toString()}`,
      );
      setItems(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, statusF]);

  useEffect(() => {
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
  }, [fetchData]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 flex-wrap shadow-sm">
        <div className="flex-1 min-w-[260px] relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm RFQ, Contract No, spec..."
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/40 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
          {(['all', 'pending_review', 'merged'] as const).map(v => (
            <button key={v} onClick={() => setStatusF(v)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg transition-all',
                statusF === v ? 'bg-white shadow text-emerald-700' : 'text-slate-500',
              )}>
              {v === 'all' ? 'Tất cả' : v === 'pending_review' ? 'Chờ duyệt' : 'Đã merge'}
            </button>
          ))}
        </div>
        <button onClick={fetchData} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Làm mới
        </button>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{total}</span> hợp đồng
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100 text-slate-600 uppercase text-[11px] font-bold tracking-wide">
              <tr>
                <th className="px-3 py-2.5 text-left">Trạng thái</th>
                <th className="px-3 py-2.5 text-left">RFQ No</th>
                <th className="px-3 py-2.5 text-left">Số HĐ</th>
                <th className="px-3 py-2.5 text-left">Chủ đề</th>
                <th className="px-3 py-2.5 text-left">Kỳ</th>
                <th className="px-3 py-2.5 text-right">Giá trị</th>
                <th className="px-3 py-2.5 text-left">Mã hàng</th>
                <th className="px-3 py-2.5 text-right">SL</th>
                <th className="px-3 py-2.5 text-left">Quy cách</th>
                <th className="px-3 py-2.5 text-left">Người tạo</th>
                <th className="px-3 py-2.5 text-left">Lần quét</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">Đang tải...</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">Không có hợp đồng nào.</td></tr>
              )}
              {items.map(it => (
                <tr key={it.id} className="hover:bg-emerald-50/40">
                  <td className="px-3 py-2">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] font-bold',
                      it.status === 'merged' ? 'bg-emerald-100 text-emerald-700' :
                      it.status === 'pending_review' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-600',
                    )}>{it.status}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-emerald-700">{it.rfq_number || '—'}</td>
                  <td className="px-3 py-2 font-mono">{it.contract_no || '—'}</td>
                  <td className="px-3 py-2 max-w-[300px] truncate" title={it.contract_subject || ''}>{it.contract_subject || '—'}</td>
                  <td className="px-3 py-2">{it.contract_period || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{it.contract_amount || '—'}</td>
                  <td className="px-3 py-2 font-mono">{it.item_code || '—'}</td>
                  <td className="px-3 py-2 text-right">{it.quantity ?? '—'}</td>
                  <td className="px-3 py-2 max-w-[280px] truncate" title={it.specification || ''}>{it.specification || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 truncate max-w-[160px]" title={it.created_by || ''}>{it.created_by || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{it.scraped_at ? new Date(it.scraped_at).toLocaleDateString('vi-VN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EditableCell({
  row,
  field,
  editing,
  saving,
  onStart,
  onCancel,
  onSave,
  setEditing,
  wide,
}: {
  row: WonRow;
  field: 'hs_code' | 'goods_description';
  editing: { id: number; field: string; value: string } | null;
  saving: boolean;
  onStart: (id: number, field: 'hs_code' | 'goods_description', v: string | null) => void;
  onCancel: () => void;
  onSave: () => void;
  setEditing: (e: any) => void;
  wide?: boolean;
}) {
  const isEditing = editing?.id === row.id && editing?.field === field;
  const value = row[field];
  return (
    <td
      className={cn(
        'px-3 py-2 bg-amber-50/30',
        wide ? 'min-w-[220px]' : 'min-w-[110px]',
        wide ? '' : 'border-l border-amber-100',
      )}
    >
      {isEditing ? (
        <div className="flex items-center gap-1">
          <input
            value={editing!.value}
            onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
            autoFocus
            className="flex-1 min-w-0 px-2 py-1 rounded border border-emerald-400 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            onClick={onSave}
            disabled={saving}
            className="p-1 rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-40"
            title="Lưu (Enter)"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={onCancel} className="p-1 rounded text-slate-500 hover:bg-slate-100" title="Hủy (Esc)">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onStart(row.id, field, value)}
          className="group w-full text-left flex items-center justify-between gap-2 -mx-1 px-1 py-0.5 rounded hover:bg-amber-100/50"
        >
          <span className={cn('truncate', !value && 'text-slate-400 italic')}>
            {value || 'Bấm để nhập…'}
          </span>
          <Pencil className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 flex-shrink-0" />
        </button>
      )}
    </td>
  );
}

// ─── BulkHsLookupModal — Phase 3.2 per Thang 2026-05-12 ──────────────────────
//
// User paste a list of BQMS codes (1/dòng hoặc CSV) → backend query
// bqms_won_quotations để trả về HS code + mô tả hàng hoá đã từng dùng. UI
// hiện table preview với chip "Đã có / Chưa có". Click "Copy table" để paste
// vào Excel, hoặc tab sang cột để tự sửa.

type BulkLookupItem = {
  bqms_code: string;
  hs_code: string | null;
  goods_description: string | null;
  description: string | null;
  specification: string | null;
  supplier_name: string | null;
  po_price: number | null;
  synced_at: string | null;
  customs_char_count: number | null;
};

function BulkHsLookupModal({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<BulkLookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [foundCount, setFoundCount] = useState(0);
  const [missingCount, setMissingCount] = useState(0);

  const handleLookup = async () => {
    // Parse: 1 mã/dòng, hoặc CSV (phân cách bằng dấu phẩy / tab / khoảng trắng).
    const codes = input
      .split(/[\n,;\t]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (codes.length === 0) {
      toast.error('Hãy paste danh sách BQMS code (1 mã/dòng)');
      return;
    }
    if (codes.length > 200) {
      toast.error(`Tối đa 200 mã/lần (đang có ${codes.length})`);
      return;
    }
    setLoading(true);
    try {
      const r = await api.post<{ data: { items: BulkLookupItem[]; found_count: number; missing_count: number } }>(
        '/api/v1/bqms/hs-code/bulk-lookup',
        { codes },
      );
      setItems(r.data.items);
      setFoundCount(r.data.found_count);
      setMissingCount(r.data.missing_count);
      toast.success(`Tra cứu xong: ${r.data.found_count}/${codes.length} có HS code`);
    } catch (e: any) {
      toast.error(`Tra cứu lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const copyTable = () => {
    const tsv = items.map((it) => [
      it.bqms_code,
      it.hs_code ?? '',
      it.goods_description ?? '',
      it.specification ?? '',
      it.supplier_name ?? '',
      it.po_price ?? '',
    ].join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(() => toast.success(`Đã copy ${items.length} dòng (TSV)`));
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Clipboard className="h-5 w-5 text-brand-600" />
            <h3 className="font-semibold text-slate-800">Tra HS code hàng loạt</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Input area */}
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Danh sách BQMS code (1 mã/dòng, tối đa 200)
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder={"Ví dụ:\nZ0000002-544155\nZ0000002-544156\nZ0000002-544418\n... hoặc paste cả 1 cột BQMS code từ Excel"}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleLookup}
                disabled={loading || !input.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Tra cứu
              </button>
              {items.length > 0 && (
                <>
                  <button onClick={copyTable} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold">
                    <Clipboard className="h-3.5 w-3.5" />Copy table (TSV)
                  </button>
                  <div className="text-xs text-slate-600">
                    <span className="text-emerald-700 font-semibold">{foundCount}</span> có HS ·{' '}
                    <span className="text-red-700 font-semibold">{missingCount}</span> thiếu HS
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Results table */}
          {items.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2 text-left font-mono uppercase">BQMS Code</th>
                    <th className="px-2 py-2 text-left font-mono uppercase bg-amber-50">HS Code</th>
                    <th className="px-2 py-2 text-left font-mono uppercase bg-amber-50">Mô tả hàng hoá</th>
                    <th className="px-2 py-2 text-left font-mono uppercase">Specification</th>
                    <th className="px-2 py-2 text-left font-mono uppercase">NCC</th>
                    <th className="px-2 py-2 text-right font-mono uppercase">Giá PO</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className={cn('border-b border-slate-100 hover:bg-slate-50', !it.hs_code && 'bg-red-50/30')}>
                      <td className="px-2 py-1.5 font-mono font-semibold text-slate-800">{it.bqms_code}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {it.hs_code ? (
                          <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold">{it.hs_code}</span>
                        ) : (
                          <span className="text-red-500 italic">— chưa có</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 max-w-[280px] truncate" title={it.goods_description ?? ''}>
                        {it.goods_description ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 max-w-[200px] truncate" title={it.specification ?? ''}>
                        {it.specification ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 max-w-[160px] truncate text-slate-600" title={it.supplier_name ?? ''}>
                        {it.supplier_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {it.po_price != null ? fmtNum(it.po_price) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-600">
          💡 Mẹo: Sau khi tra xong, click "Copy table" → paste vào Excel để thống kê. Mã có nền đỏ là chưa có HS — cần điền tay trực tiếp trong bảng Trúng BG.
        </div>
      </div>
    </div>
  );
}
