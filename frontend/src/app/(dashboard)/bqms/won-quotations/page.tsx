'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Trophy, Pencil, Check, X, RefreshCw, Filter } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const [hasHs, setHasHs] = useState<'all' | 'filled' | 'missing'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number; field: 'hs_code' | 'goods_description'; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

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

  // Debounced search
  useEffect(() => {
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 flex items-center justify-center">
            <Trophy className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">BQMS — Trúng BG</h1>
            <p className="text-xs text-slate-500">
              Dữ liệu từ sheet "TRUNG BG" file Excel "Thống kê hỏi hàng BQMS" · {total.toLocaleString('vi-VN')} bản ghi
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Làm mới
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm HS code, BQMS code, RFQ No, NCC, mô tả..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-medium">
          {(['all', 'filled', 'missing'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setHasHs(v);
                setPage(1);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5',
                hasHs === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <Filter className="h-3 w-3" />
              {v === 'all' ? 'Tất cả' : v === 'filled' ? 'Có HS' : 'Chưa có HS'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
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
