'use client';

// Bulk lookup modal for /sourcing — Thang 2026-06-03.
// Paste N mã (1-500) → backend bulk-lookup → table với tick chọn để gửi báo giá.
// v2 refactor: restrained design (white + slate + violet primary, emerald only for CTA).
// Click model code or Eye icon → opens SourcingFormDrawer via onOpenDetail prop.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Clipboard, Search, X, RefreshCw, AlertCircle, CheckCircle2, Send, Eye,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface BulkLookupItem {
  query_raw: string;
  query_norm: string;
  id: number;
  model: string;
  product_name: string | null;
  maker: string | null;
  customer_name: string | null;
  inquiry_date: string | null;
  sale_vnd: number | null;
  cost_vnd: number | null;
  supplier_name: string | null;
  image_url: string | null;
  brand_canonical: string | null;
  catalog_status: string | null;
  stage: number | null;
  total_inquiries: number;
  min_sale: number | null;
  max_sale: number | null;
  avg_sale: number | null;
  suppliers: string[] | null;
  customers: string[] | null;
}

interface BulkLookupResponse {
  data: {
    items: BulkLookupItem[];
    missing: string[];
    found_count: number;
    missing_count: number;
    input_count: number;
    search_mode: string;
  };
}

export function BulkLookupSourcingModal({
  onClose,
  onForwardToQuote,
  onOpenDetail,
}: {
  onClose: () => void;
  onForwardToQuote: (sourcingIds: number[]) => void;
  onOpenDetail: (sourcingId: number) => void;
}) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'exact' | 'fuzzy'>('exact');
  const [items, setItems] = useState<BulkLookupItem[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const mutation = useMutation({
    mutationFn: async () => {
      const codes = input
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (codes.length === 0) throw new Error('Hãy paste danh sách mã');
      if (codes.length > 500) throw new Error(`Tối đa 500 mã/lần (đang có ${codes.length})`);
      const r = await api.post<BulkLookupResponse>('/api/v1/sourcing/bulk-lookup', {
        codes,
        search_mode: mode,
      });
      return r.data;
    },
    onSuccess: (data) => {
      setItems(data.items);
      setMissing(data.missing);
      setSelected(new Set(data.items.map((it) => it.id)));
      toast.success(
        `Tra cứu xong: ${data.found_count}/${data.input_count} mã có trong thư viện` +
        (data.missing_count > 0 ? ` (${data.missing_count} chưa có)` : ''),
      );
    },
    onError: (e: any) => {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    },
  });

  const toggleSel = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((it) => it.id)));
  };

  const copyTSV = () => {
    const lines = [
      ['Mã input', 'Model DB', 'Tên SP', 'Maker', 'KH', 'Hỏi cuối', 'Giá bán', 'Số lần', 'NCC', 'Status'].join('\t'),
      ...items.map((it) => [
        it.query_raw,
        it.model,
        it.product_name ?? '',
        it.maker ?? '',
        it.customer_name ?? '',
        it.inquiry_date ?? '',
        it.sale_vnd ?? '',
        it.total_inquiries,
        (it.suppliers ?? []).join(', '),
        it.catalog_status ?? '',
      ].join('\t')),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => toast.success(`Đã copy ${items.length} dòng (TSV)`));
  };

  const fwd = () => {
    if (selected.size === 0) return;
    onForwardToQuote(Array.from(selected));
  };

  const fmtVnd = (v: number | null | undefined) => v != null ? v.toLocaleString('vi-VN') : '—';
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header — restrained: white bg, slate icon tile, violet not in use here */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
              <Clipboard className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight text-slate-900">Tra cứu thư viện nguồn cung</h3>
              <p className="text-sm text-slate-500 font-medium">Paste 1-500 mã model → kiểm tra lịch sử báo giá</p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Input area */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh sách Model (1 mã/dòng, tối đa 500)
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder={"Ví dụ:\nPOM KT120XD8\nFTLX8574D3BCL\nFSP400-60AGGBQ\n... hoặc paste cả 1 cột Model từ Excel"}
              className="mt-2 w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-all"
            />
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !input.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50 shadow-sm transition-colors"
              >
                {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Tra cứu
              </button>
              <div className="inline-flex rounded-lg bg-slate-100 ring-1 ring-slate-200 p-0.5 text-sm">
                {(['exact', 'fuzzy'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setMode(v)}
                    className={cn(
                      'px-3 py-1.5 rounded-md font-semibold transition-all',
                      mode === v
                        ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    {v === 'exact' ? 'Chính xác' : 'Fuzzy'}
                  </button>
                ))}
              </div>
              {items.length > 0 && (
                <>
                  <button
                    onClick={copyTSV}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold ring-1 ring-slate-200"
                  >
                    <Clipboard className="h-4 w-4" />Copy TSV
                  </button>
                  <div className="text-sm text-slate-600 ml-auto font-medium">
                    <span className="text-emerald-700 font-bold tabular-nums">{items.length}</span> có ·{' '}
                    <span className="text-rose-700 font-bold tabular-nums">{missing.length}</span> chưa có
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Results */}
          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider font-bold text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === items.length && items.length > 0}
                        onChange={toggleAll}
                        className="rounded text-brand-600 focus:ring-brand-300 cursor-pointer h-4 w-4"
                      />
                    </th>
                    <th className="px-3 py-3 text-left">Mã input</th>
                    <th className="px-3 py-3 text-left">Model DB</th>
                    <th className="px-3 py-3 text-left max-w-[200px]">Tên SP</th>
                    <th className="px-3 py-3 text-left">Maker</th>
                    <th className="px-3 py-3 text-left">KH</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap">Hỏi cuối</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Giá bán</th>
                    <th className="px-3 py-3 text-right">Số lần</th>
                    <th className="px-3 py-3 text-left">NCC</th>
                    <th className="px-3 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      className={cn(
                        'group hover:bg-brand-50/30 transition-colors cursor-pointer',
                        selected.has(it.id) && 'bg-emerald-50/40',
                      )}
                      onClick={() => toggleSel(it.id)}
                    >
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleSel(it.id)}
                          className="rounded text-brand-600 focus:ring-brand-300 cursor-pointer h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] text-slate-700">{it.query_raw}</td>
                      <td className="px-3 py-3 max-w-[200px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDetail(it.id);
                          }}
                          title={`Mở chi tiết: ${it.model}`}
                          className="font-mono text-[14px] font-bold text-brand-700 hover:text-brand-900 hover:underline truncate text-left max-w-full"
                        >
                          {it.model}
                        </button>
                      </td>
                      <td className="px-3 py-3 max-w-[200px] truncate text-slate-700 text-[15px]" title={it.product_name ?? ''}>
                        {it.product_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 max-w-[140px] truncate text-slate-700" title={it.maker ?? ''}>
                        {it.maker ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 max-w-[120px] truncate font-semibold text-slate-700" title={it.customer_name ?? ''}>
                        {it.customer_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap tabular-nums">{fmtDate(it.inquiry_date)}</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700 tabular-nums text-[14px]">{fmtVnd(it.sale_vnd)}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-200 font-bold text-xs">
                          {it.total_inquiries}
                        </span>
                      </td>
                      <td className="px-3 py-3 max-w-[160px] truncate text-slate-700 text-[13px]" title={(it.suppliers ?? []).join(', ')}>
                        {it.supplier_name ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDetail(it.id);
                          }}
                          title="Mở chi tiết"
                          className="h-8 w-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-brand-700 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Missing codes */}
          {missing.length > 0 && (
            <div className="border border-rose-200 rounded-xl bg-rose-50/40 p-4">
              <div className="text-sm font-bold text-rose-800 flex items-center gap-1.5 mb-2.5">
                <AlertCircle className="h-4 w-4" /> {missing.length} mã chưa có trong thư viện
              </div>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((m, i) => (
                  <span key={i} className="inline-flex items-center px-2 py-1 rounded-md bg-white text-rose-700 ring-1 ring-rose-200 text-xs font-mono font-semibold">
                    {m}
                  </span>
                ))}
              </div>
              <p className="text-xs text-rose-600 mt-2.5">
                Các mã này chưa có trong thư viện. Vào trang /sourcing → "Thêm mới" để bổ sung.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-slate-600">
            {selected.size > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-bold">
                <CheckCircle2 className="h-4 w-4" /> {selected.size} đã chọn
              </span>
            ) : (
              <span className="italic">Tick mã để chọn → tạo báo giá hàng loạt</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors">Đóng</button>
            <button
              onClick={fwd}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50 shadow-sm transition-colors"
            >
              <Send className="h-4 w-4" /> Tạo báo giá ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
