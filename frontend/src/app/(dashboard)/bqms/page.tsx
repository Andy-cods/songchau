'use client';

import { useState, useCallback, useRef, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ClipboardList,
  RefreshCw,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  History,
  AlertTriangle,
  Clock,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  Inbox,
  Copy,
  ExternalLink,
  ChevronLeft,
  Loader2,
  Download,
  FileSpreadsheet,
  CheckCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RFQItem {
  id: number;
  rfq_number: string | null;
  bqms_code: string | null;
  specification: string | null;
  maker: string | null;
  expected_qty: number | null;
  unit: string | null;
  purchase_price_rmb: number | null;
  purchase_price_vnd: number | null;
  quoted_price_ama: number | null;
  quoted_price_bqms_v1: number | null;
  quoted_price_bqms_v2: number | null;
  quoted_price_bqms_v3: number | null;
  quoted_price_bqms_v4: number | null;
  supplier_name: string | null;
  result: string | null;
  notes: string | null;
  report: string | null;
  person_in_charge_name: string | null;
  inquiry_date: string | null;
  effective_date: string | null;
  created_at: string | null;
}

interface MonthSummary {
  year: number;
  month: number;
  count: number;
  won: number;
  lost: number;
}

interface KPIs {
  total_month: number;
  won: number;
  lost: number;
  pending: number;
  win_rate: number;
}

interface RFQTableResponse {
  data: {
    items: RFQItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    kpis: KPIs;
    months: MonthSummary[];
  };
}

interface QuotationHistoryItem {
  id: number;
  rfq_no: string | null;
  quotation_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  created_at: string | null;
  submitted_at: string | null;
}

interface EditingCell {
  rowId: number;
  field: string;
  currentValue: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVnd(value?: number | null): string {
  if (value == null) return '—';
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function fmtNum(value?: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function getUrgency(item: RFQItem): 'red' | 'amber' | null {
  if (!item.inquiry_date || (item.result && item.result !== 'pending')) return null;
  const now = new Date();
  const d = new Date(item.inquiry_date);
  const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  // inquiry_date is "recent" = within last 7 days from now
  if (diffDays >= 0 && diffDays < 3) return 'red';
  if (diffDays >= 0 && diffDays < 7) return 'amber';
  return null;
}

function monthLabel(year: number, month: number) {
  return `Tháng ${month}/${year}`;
}

// ─── Result Badge ─────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result?: string | null }) {
  const val = (result ?? '').toLowerCase();
  if (val === 'won')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" />
        Trúng
      </span>
    );
  if (val === 'lost')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 whitespace-nowrap">
        <XCircle className="h-3 w-3" />
        Trượt
      </span>
    );
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
      Đang XL
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 flex items-center gap-3 min-w-0">
      <div className={`p-2.5 rounded-lg flex-shrink-0 ${colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {loading ? (
          <div className="h-6 w-16 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold font-mono text-slate-900 leading-tight">{value}</p>
        )}
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Inline Price Cell ────────────────────────────────────────────────────────

function PriceCell({
  item,
  field,
  value,
  editingCell,
  onStartEdit,
  onSave,
  onCancel,
}: {
  item: RFQItem;
  field: string;
  value: number | null;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSave: (rowId: number, field: string, value: string) => void;
  onCancel: () => void;
}) {
  const isEditing =
    editingCell?.rowId === item.id && editingCell?.field === field;
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = () => {
    onStartEdit({
      rowId: item.id,
      field,
      currentValue: value != null ? String(value) : '',
    });
    // Focus on next tick after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSave(item.id, field, inputRef.current?.value ?? '');
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (isEditing) {
    return (
      <td className="px-2 py-1.5 text-right">
        <input
          ref={inputRef}
          defaultValue={editingCell?.currentValue ?? ''}
          onKeyDown={handleKeyDown}
          onBlur={() => onCancel()}
          className="w-24 text-xs text-right font-mono border border-brand-400 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
        />
      </td>
    );
  }

  return (
    <td
      className="px-2 py-2 text-right cursor-text group"
      onDoubleClick={handleDoubleClick}
      title="Double-click để sửa"
    >
      <span className="text-xs font-mono text-slate-600 group-hover:text-brand-600 transition-colors">
        {fmtVnd(value)}
      </span>
    </td>
  );
}

// ─── Row Detail Panel ─────────────────────────────────────────────────────────

// ── Inline Create Quotation ──────────────────────────────────
function InlineCreateQuotation({ item }: { item: RFQItem }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'preview' | 'generating' | 'done' | 'error'>('preview');
  const [result, setResult] = useState<any>(null);

  // Lookup prices for this RFQ
  const { data: lookupData, isLoading: lookupLoading } = useQuery({
    queryKey: ['rfq-lookup', item.rfq_number],
    queryFn: () => api.get<{ data: { items: any[]; total: number } }>(
      `/api/v1/quotations/lookup?rfq_code=${encodeURIComponent(item.rfq_number ?? '')}`
    ),
    enabled: !!item.rfq_number,
  });

  const lookupItems = Array.isArray(lookupData?.data?.items) ? lookupData.data.items : [];

  const handleGenerate = async () => {
    setStep('generating');
    try {
      const items = lookupItems.length > 0 ? lookupItems : [{
        bqms: item.bqms_code ?? '', spec: item.specification ?? '',
        maker: item.maker ?? '', so_luong: item.expected_qty ?? 1,
        don_vi: item.unit ?? 'EA', don_hang: item.rfq_number ?? '',
      }];
      const res = await api.post<{ data: any; message: string }>('/api/v1/quotations/generate', {
        rfq_no: item.rfq_number ?? '',
        source_type: 'rfq_code',
        items,
      });
      setResult(res?.data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (err: any) {
      setResult({ error: err?.detail ?? err?.message ?? 'Lỗi tạo báo giá' });
      setStep('error');
    }
  };

  return (
    <div className="border-t border-brand-100 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-brand-700">
          Tạo báo giá cho {item.rfq_number}
        </h4>
        {step === 'preview' && (
          <span className="text-[11px] text-slate-400">
            {lookupLoading ? 'Đang tra giá...' : `${lookupItems.length} items tìm thấy`}
          </span>
        )}
      </div>

      {/* Preview items */}
      {step === 'preview' && lookupItems.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium text-slate-500">BQMS Code</th>
                <th className="text-left px-2 py-1.5 font-medium text-slate-500">Spec</th>
                <th className="text-left px-2 py-1.5 font-medium text-slate-500">Maker</th>
                <th className="text-right px-2 py-1.5 font-medium text-slate-500">SL</th>
                <th className="text-right px-2 py-1.5 font-medium text-slate-500">Giá gợi ý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lookupItems.slice(0, 10).map((li: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50/50">
                  <td className="px-2 py-1 font-mono text-slate-700">{li.bqms ?? '—'}</td>
                  <td className="px-2 py-1 text-slate-600 max-w-[200px] truncate">{li.spec ?? '—'}</td>
                  <td className="px-2 py-1 text-slate-600">{li.maker ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{li.so_luong ?? 0}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-600">
                    {li.suggested_price ? (li.suggested_price ?? 0).toLocaleString('vi-VN') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {step === 'preview' && (
        <button
          onClick={handleGenerate}
          disabled={lookupLoading}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Tạo báo giá ngay ({lookupItems.length || 1} items)
        </button>
      )}

      {step === 'generating' && (
        <div className="flex items-center gap-2 text-xs text-brand-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tạo báo giá...
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <CheckCircle className="h-4 w-4" />
            Báo giá đã tạo thành công!
          </div>
          <div className="text-[11px] text-emerald-600">
            {result.total_items ?? 0} items | {result.filled_items ?? 0} đã có giá
          </div>
          {result.files && result.files.length > 0 && (
            <div className="flex gap-2 mt-1">
              {result.files.map((f: any, i: number) => (
                <a key={i}
                  href={`/api/v1/quotations/download/${result.id}/${f.type}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700"
                >
                  <Download className="h-3 w-3" />
                  {f.type.includes('pdf') ? 'PDF' : 'Excel'}
                </a>
              ))}
            </div>
          )}
          <button onClick={() => setStep('preview')} className="text-[11px] text-emerald-600 underline">
            Tạo lại
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="text-xs text-red-700">{result?.error ?? 'Lỗi không xác định'}</div>
          <button onClick={() => setStep('preview')} className="text-[11px] text-red-600 underline mt-1">
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}

function RowDetailPanel({
  item,
  onClose,
}: {
  item: RFQItem;
  onClose: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['rfq-history', item.id],
    queryFn: () => api.get<{ data: QuotationHistoryItem[]; total: number }>(`/api/v1/bqms/rfq/${item.id}/history`),
    enabled: showHistory,
    staleTime: 30_000,
  });

  const history: QuotationHistoryItem[] = historyData?.data ?? [];

  const handleCopyRFQ = () => {
    const code = item.rfq_number ?? item.bqms_code ?? '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <tr className="border-b border-brand-100 bg-brand-50/30">
      <td colSpan={15} className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">RFQ No.</span>
              <span className="font-mono font-semibold text-brand-700">{item.rfq_number ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">BQMS Code</span>
              <span className="font-mono text-slate-700">{item.bqms_code ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Tên hàng / Spec</span>
              <span className="text-slate-700 line-clamp-2">{item.specification ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Maker</span>
              <span className="text-slate-700">{item.maker ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Số lượng</span>
              <span className="font-mono text-slate-700">
                {fmtNum(item.expected_qty)} {item.unit ?? ''}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá mua RMB</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_rmb)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá mua VND</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_vnd)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá AMA</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.quoted_price_ama)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Nhà cung cấp</span>
              <span className="text-slate-700">{item.supplier_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Người phụ trách</span>
              <span className="text-slate-700">{item.person_in_charge_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Ngày inquiry</span>
              <span className="text-slate-700">
                {item.inquiry_date ? formatDate(item.inquiry_date) : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Kết quả</span>
              <ResultBadge result={item.result} />
            </div>
            {item.notes && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-400 block">Ghi chú</span>
                <span className="text-slate-700">{item.notes}</span>
              </div>
            )}
            {item.report && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-400 block">Báo cáo</span>
                <span className="text-slate-700">{item.report}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap border-t border-brand-100 pt-2">
            <button
              onClick={() => { setShowCreateForm((v) => !v); setShowHistory(false); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {showCreateForm ? 'Ẩn tạo BG' : 'Tạo báo giá'}
            </button>

            <button
              onClick={() => { setShowHistory((v) => !v); setShowCreateForm(false); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? 'Ẩn lịch sử BG' : 'Xem lịch sử BG'}
            </button>

            <button
              onClick={handleCopyRFQ}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Đã copy!' : 'Copy RFQ code'}
            </button>

            <Link
              href={`/bqms/quotation/new?rfq_code=${encodeURIComponent(item.rfq_number ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Mở tab mới
            </Link>

            <button
              onClick={onClose}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
            >
              Đóng
            </button>
          </div>

          {/* Inline Create Quotation Form */}
          {showCreateForm && (
            <InlineCreateQuotation item={item} />
          )}

          {/* Quotation history */}
          {showHistory && (
            <div className="border-t border-brand-100 pt-2">
              {historyLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang tải lịch sử...
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">Chưa có báo giá nào cho RFQ này.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-100">
                        <th className="text-left py-1 pr-4 font-medium">Số BG</th>
                        <th className="text-left py-1 pr-4 font-medium">Khách hàng</th>
                        <th className="text-right py-1 pr-4 font-medium">Giá trị</th>
                        <th className="text-left py-1 pr-4 font-medium">Trạng thái</th>
                        <th className="text-left py-1 font-medium">Ngày tạo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {history.map((h) => (
                        <tr key={h.id} className="hover:bg-white transition-colors">
                          <td className="py-1 pr-4 font-mono text-brand-600">
                            {h.quotation_number ?? `#${h.id}`}
                          </td>
                          <td className="py-1 pr-4 text-slate-700">{h.customer_name ?? '—'}</td>
                          <td className="py-1 pr-4 text-right font-mono text-slate-700">
                            {h.total_amount != null
                              ? `${fmtVnd(h.total_amount)} ${h.currency ?? ''}`
                              : '—'}
                          </td>
                          <td className="py-1 pr-4">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {h.status ?? '—'}
                            </span>
                          </td>
                          <td className="py-1 text-slate-500">
                            {h.created_at ? formatDate(h.created_at) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Month Group Header ───────────────────────────────────────────────────────

function MonthGroupHeader({
  summary,
  collapsed,
  onToggle,
}: {
  summary: MonthSummary;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      className="bg-slate-50 border-y border-slate-200 cursor-pointer select-none sticky top-[41px] z-10"
      onClick={onToggle}
    >
      <td colSpan={15} className="px-4 py-2">
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            {monthLabel(summary.year, summary.month)}
          </span>
          <span className="text-xs text-slate-400 ml-1">
            — {summary.count.toLocaleString('vi-VN')} RFQ
          </span>
          {summary.won > 0 && (
            <span className="text-xs text-emerald-600 font-medium">
              ({summary.won} trúng
            </span>
          )}
          {summary.won > 0 && summary.lost > 0 && (
            <span className="text-xs text-red-500 font-medium">, {summary.lost} trượt)</span>
          )}
          {summary.won > 0 && summary.lost === 0 && (
            <span className="text-xs text-emerald-600 font-medium">)</span>
          )}
          {summary.won === 0 && summary.lost > 0 && (
            <span className="text-xs text-red-500 font-medium">({summary.lost} trượt)</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 12 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100">
          {Array.from({ length: 14 }).map((_, j) => (
            <td key={j} className="px-3 py-2.5">
              <div
                className="h-3.5 bg-slate-200 rounded animate-pulse"
                style={{ width: `${40 + ((i * 7 + j * 13) % 60)}%`, opacity: 0.6 + (j % 4) * 0.1 }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BQMSPage() {
  const queryClient = useQueryClient();

  // ── Filter state
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(currentYear);
  const [month, setMonth] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  // ── UI state
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // ── Build query string
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (year) p.set('year', String(year));
    if (month) p.set('month', String(month));
    if (search) p.set('search', search);
    if (resultFilter && resultFilter !== 'all') p.set('result_filter', resultFilter);
    p.set('page', String(page));
    p.set('page_size', '100');
    return p.toString();
  }, [year, month, search, resultFilter, page]);

  // ── Data query
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['bqms-rfq-table', year, month, search, resultFilter, page],
    queryFn: () =>
      api.get<RFQTableResponse>(`/api/v1/bqms/rfq-table?${buildParams()}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  const items: RFQItem[] = Array.isArray(data?.data?.items) ? data!.data.items : [];
  const total = data?.data?.total ?? 0;
  const totalPages = data?.data?.total_pages ?? 1;
  const kpis = data?.data?.kpis;
  const months: MonthSummary[] = Array.isArray(data?.data?.months) ? data!.data.months : [];

  // ── Inline price update mutation
  const priceMutation = useMutation({
    mutationFn: ({ rowId, field, value }: { rowId: number; field: string; value: string }) =>
      api.patch<{ message: string }>(`/api/v1/bqms/rfq/${rowId}/price`, { field, value: value === '' ? null : Number(value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
      setEditingCell(null);
    },
    onError: () => {
      setEditingCell(null);
    },
  });

  const handleSaveCell = useCallback(
    (rowId: number, field: string, value: string) => {
      priceMutation.mutate({ rowId, field, value });
    },
    [priceMutation]
  );

  const handleCancelCell = useCallback(() => {
    setEditingCell(null);
  }, []);

  // ── Month collapse
  const toggleMonth = useCallback((key: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Group items by month using the months metadata from API
  // Build a map: "YYYY-M" -> items[]
  const itemsByMonth = new Map<string, RFQItem[]>();
  for (const item of items) {
    const d = item.effective_date ?? item.inquiry_date ?? item.created_at ?? '';
    if (!d) {
      const key = 'unknown';
      itemsByMonth.set(key, [...(itemsByMonth.get(key) ?? []), item]);
      continue;
    }
    const dt = new Date(d);
    const key = isNaN(dt.getTime()) ? 'unknown' : `${dt.getFullYear()}-${dt.getMonth() + 1}`;
    itemsByMonth.set(key, [...(itemsByMonth.get(key) ?? []), item]);
  }

  // ── Search submit
  const handleSearchSubmit = () => {
    setSearch(searchInput);
    setPage(1);
  };

  // ── Filter change resets page
  const handleYearChange = (v: number | null) => { setYear(v); setPage(1); };
  const handleMonthChange = (v: number | null) => { setMonth(v); setPage(1); };
  const handleResultChange = (v: string) => { setResultFilter(v); setPage(1); };

  // ── Row click
  const handleRowClick = (id: number) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  // ── Global row counter (for # column)
  let rowCounter = (page - 1) * 100;

  return (
    <div className="flex flex-col gap-4 min-h-0 pb-8">
      {/* ── Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 rounded-lg">
            <ClipboardList className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">BQMS — Quản lý RFQ Samsung</h1>
            <p className="text-xs text-slate-500">
              Bảng tổng hợp RFQ · {total.toLocaleString('vi-VN')} bản ghi
              {isFetching && !isLoading && (
                <span className="ml-2 text-brand-500">
                  <Loader2 className="inline h-3 w-3 animate-spin mr-0.5" />
                  Đang cập nhật...
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Làm mới
          </button>
          <Link
            href="/bqms/quotation/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Tạo báo giá
          </Link>
        </div>
      </div>

      {/* ── KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard
          label="Tổng RFQ (bộ lọc)"
          value={(kpis?.total_month ?? total).toLocaleString('vi-VN')}
          icon={ClipboardList}
          colorClass="bg-brand-100 text-brand-600"
          loading={isLoading}
        />
        <KPICard
          label="Trúng thầu"
          value={(kpis?.won ?? 0).toLocaleString('vi-VN')}
          icon={CheckCircle2}
          colorClass="bg-emerald-100 text-emerald-600"
          loading={isLoading}
        />
        <KPICard
          label="Trượt thầu"
          value={(kpis?.lost ?? 0).toLocaleString('vi-VN')}
          icon={XCircle}
          colorClass="bg-red-100 text-red-600"
          loading={isLoading}
        />
        <KPICard
          label="Đang xử lý"
          value={(kpis?.pending ?? 0).toLocaleString('vi-VN')}
          icon={Clock}
          colorClass="bg-amber-100 text-amber-600"
          loading={isLoading}
        />
        <KPICard
          label="Win rate"
          value={`${kpis?.win_rate ?? 0}%`}
          icon={Percent}
          colorClass="bg-violet-100 text-violet-600"
          loading={isLoading}
          sub={kpis ? `${kpis.won}/${kpis.won + kpis.lost} đã xử lý` : undefined}
        />
      </div>

      {/* ── Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Year */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 whitespace-nowrap">Năm:</span>
          <select
            value={year ?? ''}
            onChange={(e) => handleYearChange(e.target.value ? Number(e.target.value) : null)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Tất cả</option>
            {[2026, 2025, 2024, 2023].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Month */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 whitespace-nowrap">Tháng:</span>
          <select
            value={month ?? ''}
            onChange={(e) => handleMonthChange(e.target.value ? Number(e.target.value) : null)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Tất cả</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>Tháng {m}</option>
            ))}
          </select>
        </div>

        {/* Result filter */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 overflow-hidden">
          {[
            { val: 'all', label: 'Tất cả' },
            { val: 'pending', label: 'Đang xử lý' },
            { val: 'won', label: 'Trúng' },
            { val: 'lost', label: 'Trượt' },
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => handleResultChange(val)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                resultFilter === val
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="RFQ No, BQMS Code, tên hàng, maker..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            onClick={handleSearchSubmit}
            className="px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
          >
            Tìm
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
              className="px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Xóa
            </button>
          )}
        </div>
      </div>

      {/* ── Main Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <AlertTriangle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-slate-600">Không thể tải dữ liệu. Vui lòng thử lại.</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] })}
              className="mt-1 text-xs text-brand-600 hover:underline"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {/* Sticky header */}
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-800 text-slate-200">
                  <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-10">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Ngày</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Người PT</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">RFQ No.</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">BQMS Code</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Tên hàng</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Maker</th>
                  <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">SL</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V1</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V2</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V3</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V4</th>
                  <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Kết quả</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">NCC</th>
                </tr>
              </thead>

              {isLoading ? (
                <TableSkeleton />
              ) : items.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={14} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Inbox className="h-10 w-10" />
                        <p className="text-sm text-slate-400">Không có dữ liệu phù hợp</p>
                        {(search || resultFilter !== 'all' || year || month) && (
                          <button
                            onClick={() => {
                              setSearch('');
                              setSearchInput('');
                              setResultFilter('all');
                              setYear(null);
                              setMonth(null);
                              setPage(1);
                            }}
                            className="text-xs text-brand-600 hover:underline mt-1"
                          >
                            Xóa bộ lọc
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100">
                  {months.length > 0
                    ? // Render with month group headers
                      months.map((ms) => {
                        const monthKey = `${ms.year}-${ms.month}`;
                        const monthItems = itemsByMonth.get(monthKey) ?? [];
                        if (monthItems.length === 0) return null;
                        const collapsed = collapsedMonths.has(monthKey);

                        return (
                          <MonthGroupSection
                            key={monthKey}
                            summary={ms}
                            items={monthItems}
                            collapsed={collapsed}
                            onToggle={() => toggleMonth(monthKey)}
                            expandedRowId={expandedRowId}
                            onRowClick={handleRowClick}
                            editingCell={editingCell}
                            onStartEdit={setEditingCell}
                            onSaveCell={handleSaveCell}
                            onCancelCell={handleCancelCell}
                            rowCounterStart={rowCounter}
                          />
                        );
                      })
                    : // Fallback: flat list without month headers
                      items.map((item, idx) => {
                        rowCounter++;
                        const urgency = getUrgency(item);
                        const isExpanded = expandedRowId === item.id;
                        return (
                          <DataRow
                            key={item.id}
                            item={item}
                            idx={rowCounter}
                            urgency={urgency}
                            isExpanded={isExpanded}
                            onRowClick={handleRowClick}
                            editingCell={editingCell}
                            onStartEdit={setEditingCell}
                            onSaveCell={handleSaveCell}
                            onCancelCell={handleCancelCell}
                          />
                        );
                      })}
                </tbody>
              )}
            </table>
          </div>
        )}

        {/* ── Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              Trang {page}/{totalPages} · {total.toLocaleString('vi-VN')} bản ghi
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Page number buttons (show up to 7) */}
              {(() => {
                const start = Math.max(1, page - 3);
                const end = Math.min(totalPages, start + 6);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn(
                      'w-7 h-7 rounded-lg text-xs font-medium transition-colors border',
                      p === page
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    )}
                  >
                    {p}
                  </button>
                ));
              })()}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Double-click tip */}
      <p className="text-xs text-slate-400 text-center">
        Double-click vào ô Giá V1–V4 để chỉnh sửa trực tiếp · Enter để lưu · Escape để hủy
      </p>
    </div>
  );
}

// ─── Month Group Section (extracted for clean rendering) ──────────────────────

function MonthGroupSection({
  summary,
  items,
  collapsed,
  onToggle,
  expandedRowId,
  onRowClick,
  editingCell,
  onStartEdit,
  onSaveCell,
  onCancelCell,
  rowCounterStart,
}: {
  summary: MonthSummary;
  items: RFQItem[];
  collapsed: boolean;
  onToggle: () => void;
  expandedRowId: number | null;
  onRowClick: (id: number) => void;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSaveCell: (rowId: number, field: string, value: string) => void;
  onCancelCell: () => void;
  rowCounterStart: number;
}) {
  return (
    <>
      <MonthGroupHeader summary={summary} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed &&
        items.map((item, idx) => {
          const urgency = getUrgency(item);
          const isExpanded = expandedRowId === item.id;
          return (
            <DataRow
              key={item.id}
              item={item}
              idx={rowCounterStart + idx + 1}
              urgency={urgency}
              isExpanded={isExpanded}
              onRowClick={onRowClick}
              editingCell={editingCell}
              onStartEdit={onStartEdit}
              onSaveCell={onSaveCell}
              onCancelCell={onCancelCell}
            />
          );
        })}
    </>
  );
}

// ─── Data Row ─────────────────────────────────────────────────────────────────

function DataRow({
  item,
  idx,
  urgency,
  isExpanded,
  onRowClick,
  editingCell,
  onStartEdit,
  onSaveCell,
  onCancelCell,
}: {
  item: RFQItem;
  idx: number;
  urgency: 'red' | 'amber' | null;
  isExpanded: boolean;
  onRowClick: (id: number) => void;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSaveCell: (rowId: number, field: string, value: string) => void;
  onCancelCell: () => void;
}) {
  const dateStr = item.effective_date ?? item.inquiry_date ?? item.created_at ?? '';

  return (
    <>
      <tr
        onClick={() => onRowClick(item.id)}
        className={cn(
          'border-b border-slate-100 transition-colors cursor-pointer text-xs',
          isExpanded ? 'bg-brand-50/50' : 'hover:bg-slate-50/70',
          urgency === 'red' && !isExpanded ? 'bg-red-50/40' : '',
          urgency === 'amber' && !isExpanded ? 'bg-amber-50/25' : ''
        )}
      >
        {/* # */}
        <td className="px-3 py-2 text-center text-slate-400 tabular-nums w-10 select-none">
          {idx}
        </td>

        {/* Ngày */}
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {urgency === 'red' && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
            {urgency === 'amber' && <Clock className="h-3 w-3 text-amber-500 flex-shrink-0" />}
            {dateStr ? formatDate(dateStr) : '—'}
          </div>
        </td>

        {/* Người PT */}
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[100px]">
          <span className="truncate block">{item.person_in_charge_name ?? '—'}</span>
        </td>

        {/* RFQ No. */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="font-mono text-brand-600 font-medium">{item.rfq_number ?? '—'}</span>
        </td>

        {/* BQMS Code */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="font-mono text-slate-600">{item.bqms_code ?? '—'}</span>
        </td>

        {/* Tên hàng */}
        <td className="px-3 py-2 max-w-[200px]">
          <span className="text-slate-800 truncate block" title={item.specification ?? ''}>
            {item.specification ?? '—'}
          </span>
        </td>

        {/* Maker */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="text-slate-600">{item.maker ?? '—'}</span>
        </td>

        {/* SL */}
        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
          {item.expected_qty != null ? Number(item.expected_qty).toLocaleString('vi-VN') : '—'}
          {item.unit ? <span className="text-slate-400 ml-0.5">{item.unit}</span> : null}
        </td>

        {/* Giá V1 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v1"
          value={item.quoted_price_bqms_v1}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V2 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v2"
          value={item.quoted_price_bqms_v2}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V3 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v3"
          value={item.quoted_price_bqms_v3}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V4 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v4"
          value={item.quoted_price_bqms_v4}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Kết quả */}
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <ResultBadge result={item.result} />
        </td>

        {/* NCC */}
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[120px]">
          <span className="truncate block">{item.supplier_name ?? '—'}</span>
        </td>
      </tr>

      {/* Expanded detail panel */}
      {isExpanded && (
        <RowDetailPanel item={item} onClose={() => onRowClick(item.id)} />
      )}
    </>
  );
}
