'use client';

/**
 * HoSoTab — 📁 Hồ sơ khách hàng (Quote Hub, D4-6).
 *
 * Left virtual-folder rail (Báo giá / Đơn hàng / Tài liệu + live counts) +
 * right dense table for the active folder. Premium-enterprise, ONE indigo
 * brand token + slate, 5px status dots, 8pt grid. No rainbow/gradient/orbs.
 *
 * Data sources (verified):
 *  - Báo giá   GET /api/v1/sourcing/quote-batch?customer_id={id}
 *              → {data:[{quote_no,total_value_vnd,status,sent_at,created_at,...}],total}
 *  - Đơn hàng  GET /api/v1/sourcing/orders?customer_id={id}
 *              → {data:{items:[{order_number,status,total_value_vnd,order_date,...}],total}}
 *  - Tài liệu  GET /api/v1/documents/by-entity/customer/{id}
 *              → {data:{items:[{id,title,category,created_at,...}],total}}
 *
 * Actions:
 *  - [⬇ tải]  báo giá / tài liệu → window.open of the authed download_url.
 *  - [gửi]    POST /api/v1/sourcing/quote-batch/{quote_no}/send → invalidate.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Package, FolderOpen, Download, Send, Pencil, ShoppingCart, ArrowRight, Boxes } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DataPanel, StatusPill,
  TYPE, DEPTH, ROW_PADDING, type BadgeTone,
} from '@/components/cockpit';
import { QuoteBatchModal } from '@/components/sourcing/QuoteBatchModal';

// ─── Types ──────────────────────────────────────────────────────

type FolderKey = 'baogia' | 'donhang' | 'tailieu' | 'sourcing';

interface QuoteBatchRow {
  id: number;
  quote_no: string;
  customer_name: string | null;
  total_items: number | null;
  total_value_vnd: number | null;
  file_format: string | null;
  status: string | null;
  sent_at: string | null;
  created_by_email: string | null;
  created_at: string;
  // M3/M4 — versioning + conversion provenance.
  quote_group_id: number | null;
  version_no: number | null;
  is_current: boolean | null;
  converted_order_id: number | null;
  valid_until: string | null;
  expired: boolean | null;
}

interface OrderRow {
  id: number;
  order_number: string;
  status: string | null;
  total_value_vnd: number | null;
  order_date: string | null;
  created_at: string;
}

interface DocRow {
  id: number;
  title: string;
  category: string | null;
  file_name: string | null;
  created_at: string;
}

// GET /api/v1/sourcing/by-customer/{id} — mã đã sourcing gắn với khách (FK).
interface SourcingRow {
  id: number;
  bqms_code: string | null;
  model: string | null;
  product_name: string | null;
  maker: string | null;
  supplier_name: string | null;
  sale_vnd: number | null;
  cost_currency: string | null;
  inquiry_date: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ─── Status meta (bare StatusPill tones) ────────────────────────

const QUOTE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft:    { label: 'Nháp',      tone: 'slate' },
  sent:     { label: 'Đã gửi',    tone: 'sky' },
  accepted: { label: 'Chấp nhận', tone: 'emerald' },
  rejected: { label: 'Từ chối',   tone: 'rose' },
  expired:  { label: 'Hết hạn',   tone: 'amber' },
};

// Sourcing-order 8-state machine → functional tone.
const ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft:             { label: 'Nháp',        tone: 'slate' },
  quoted:            { label: 'Đã báo giá',  tone: 'sky' },
  confirmed:         { label: 'Đã xác nhận', tone: 'sky' },
  payment_requested: { label: 'Chờ duyệt TT', tone: 'amber' },
  payment_approved:  { label: 'Đã duyệt TT', tone: 'amber' },
  shipped:           { label: 'Đã gửi hàng', tone: 'sky' },
  delivered:         { label: 'Đã giao',     tone: 'emerald' },
  cancelled:         { label: 'Đã huỷ',      tone: 'rose' },
};

const DOC_CATEGORY: Record<string, string> = {
  general: 'Chung',
  contract: 'Hợp đồng',
  invoice: 'Hoá đơn',
  quotation: 'Báo giá',
  certificate: 'Chứng từ',
  drawing: 'Bản vẽ',
};

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number | null | undefined): string {
  if (value == null || isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(value))) + '₫';
}

/** Authed download URL — same token pattern as QuoteBatchModal. */
function buildAuthedUrl(url: string): string {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') ?? '' : '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function quotePill(status: string | null) {
  const meta = QUOTE_STATUS[status ?? ''] ?? { label: status ?? '—', tone: 'slate' as BadgeTone };
  return <StatusPill label={meta.label} tone={meta.tone} variant="bare" size="sm" />;
}

function orderPill(status: string | null) {
  const meta = ORDER_STATUS[status ?? ''] ?? { label: status ?? '—', tone: 'slate' as BadgeTone };
  return <StatusPill label={meta.label} tone={meta.tone} variant="bare" size="sm" />;
}

// ─── Dense table shells ─────────────────────────────────────────

function Th({ children, alignEnd }: { children: React.ReactNode; alignEnd?: boolean }) {
  return (
    <th className={cn(TYPE.th, 'whitespace-nowrap px-3 py-2', alignEnd ? 'text-right' : 'text-left')}>
      {children}
    </th>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-3 text-[12px] text-slate-400">{children}</div>;
}

function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <div className="space-y-px p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className={cn(
                'h-3 animate-pulse rounded bg-slate-200',
                j === 0 ? 'w-28' : j === cols - 1 ? 'ml-auto w-16' : 'w-20',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const ICON_BTN =
  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ring-1 ring-inset transition-colors disabled:opacity-50';

// ─── Folder rail ────────────────────────────────────────────────

interface FolderDef {
  key: FolderKey;
  label: string;
  icon: React.ReactNode;
  count: number | null;
  loading: boolean;
}

function FolderRail({
  folders, active, onSelect,
}: {
  folders: FolderDef[];
  active: FolderKey;
  onSelect: (k: FolderKey) => void;
}) {
  return (
    <nav className="space-y-1" aria-label="Thư mục hồ sơ">
      {folders.map((f) => {
        const selected = f.key === active;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onSelect(f.key)}
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
              DEPTH.focusRing,
              selected
                ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-inset ring-brand-200'
                : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            <span className={cn('shrink-0', selected ? 'text-brand-600' : 'text-slate-400')}>
              {f.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{f.label}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                selected ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500',
              )}
            >
              {f.loading ? '·' : f.count ?? 0}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── Folder: Báo giá ────────────────────────────────────────────

function BaoGiaTable({ customerId }: { customerId: number }) {
  const queryClient = useQueryClient();
  // Revision modal state — which quote_no is being "Sửa & gửi lại".
  const [reviseQuoteNo, setReviseQuoteNo] = useState<string | null>(null);

  const invalidateQuotes = () =>
    queryClient.invalidateQueries({ queryKey: ['hoso-quotes', customerId] });

  const { data, isLoading } = useQuery<{ data: QuoteBatchRow[]; total: number }>({
    queryKey: ['hoso-quotes', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/quote-batch?customer_id=${customerId}&limit=200`),
    retry: 1,
  });

  const sendMutation = useMutation({
    mutationFn: (quoteNo: string) =>
      api.post(`/api/v1/sourcing/quote-batch/${encodeURIComponent(quoteNo)}/send`, {}),
    onSuccess: (_res, quoteNo) => {
      toast.success(`Đã đánh dấu gửi báo giá ${quoteNo}`);
      invalidateQuotes();
    },
    onError: () => toast.error('Không thể đánh dấu gửi báo giá'),
  });

  // M4 — materialize a sourcing order from the quote snapshot. Idempotent:
  // already_existed=true surfaces a distinct toast and creates nothing new.
  const createOrderMutation = useMutation({
    mutationFn: (quoteNo: string) =>
      api.post<{ data: { order_id: number; order_number: string; already_existed: boolean } }>(
        `/api/v1/sourcing/quote-batch/${encodeURIComponent(quoteNo)}/create-order`,
        {},
      ),
    onSuccess: (res) => {
      const d = res.data;
      toast.success(d.already_existed ? `Đã có đơn ${d.order_number}` : `Đã tạo đơn ${d.order_number}`);
      invalidateQuotes();
      queryClient.invalidateQueries({ queryKey: ['hoso-orders', customerId] });
    },
    onError: () => toast.error('Không thể tạo đơn từ báo giá'),
  });

  const rows = data?.data ?? [];

  if (isLoading) return <TableSkeleton cols={5} />;
  if (rows.length === 0) return <EmptyLine>Chưa có báo giá nào cho khách hàng này.</EmptyLine>;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50/60">
            <tr>
              <Th>Số báo giá</Th>
              <Th>Ngày tạo</Th>
              <Th alignEnd>Giá trị</Th>
              <Th>Trạng thái</Th>
              <Th alignEnd>Thao tác</Th>
            </tr>
          </thead>
          <tbody className={DEPTH.divider}>
            {rows.map((q) => {
              const downloadUrl = `/api/v1/sourcing/quote-batch/${encodeURIComponent(q.quote_no)}/download`;
              const converted = q.converted_order_id != null;
              return (
                <tr key={q.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                  <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>
                    <div className="inline-flex items-center gap-1.5">
                      <span className={TYPE.code}>{q.quote_no}</span>
                      {(q.version_no ?? 1) > 1 && (
                        <span
                          className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-bold tabular-nums text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200"
                          title={`Phiên bản ${q.version_no}`}
                        >
                          v{q.version_no}
                        </span>
                      )}
                      {q.expired && (
                        <span className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-bold text-rose-700 bg-rose-50 ring-1 ring-inset ring-rose-200">
                          Hết hạn
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>{formatDate(q.created_at)}</td>
                  <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] font-semibold text-slate-800 text-right whitespace-nowrap')}>{fmtVnd(q.total_value_vnd)}</td>
                  <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>{quotePill(q.status)}</td>
                  <td className={cn(ROW_PADDING.compact, 'text-right whitespace-nowrap')}>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => window.open(buildAuthedUrl(downloadUrl), '_blank')}
                        title="Tải báo giá"
                        className={cn(ICON_BTN, 'text-slate-600 ring-slate-200 hover:bg-slate-50')}
                      >
                        <Download className="h-3.5 w-3.5" /> Tải
                      </button>
                      <button
                        type="button"
                        onClick={() => sendMutation.mutate(q.quote_no)}
                        disabled={sendMutation.isPending}
                        title={q.sent_at ? `Đã gửi ${formatDate(q.sent_at)} — gửi lại` : 'Đánh dấu đã gửi'}
                        className={cn(ICON_BTN, 'text-brand-700 ring-brand-200 hover:bg-brand-50')}
                      >
                        <Send className="h-3.5 w-3.5" /> {q.status === 'sent' ? 'Gửi lại' : 'Gửi'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviseQuoteNo(q.quote_no)}
                        title="Sửa & gửi lại (tạo phiên bản mới)"
                        className={cn(ICON_BTN, 'text-slate-600 ring-slate-200 hover:bg-slate-50')}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Sửa & gửi lại
                      </button>
                      {converted ? (
                        <a
                          href={`/sourcing/orders?order_id=${q.converted_order_id}`}
                          title={`Đơn #${q.converted_order_id} đã tạo từ báo giá này`}
                          className={cn(ICON_BTN, 'text-emerald-700 ring-emerald-200 hover:bg-emerald-50')}
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> Đơn {q.converted_order_id}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => createOrderMutation.mutate(q.quote_no)}
                          disabled={createOrderMutation.isPending}
                          title="Tạo đơn hàng từ báo giá này"
                          className={cn(ICON_BTN, 'text-brand-700 ring-brand-200 hover:bg-brand-50')}
                        >
                          <ShoppingCart className="h-3.5 w-3.5" /> Tạo đơn
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {reviseQuoteNo != null && (
        <QuoteBatchModal
          reviseOfQuoteNo={reviseQuoteNo}
          onClose={() => setReviseQuoteNo(null)}
          onCreated={() => {
            invalidateQuotes();
            setReviseQuoteNo(null);
          }}
        />
      )}
    </>
  );
}

// ─── Folder: Đơn hàng ───────────────────────────────────────────

function DonHangTable({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery<{
    data: { items: OrderRow[]; total: number };
  }>({
    queryKey: ['hoso-orders', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/orders?customer_id=${customerId}&page_size=200`),
    retry: 1,
  });

  const rows = data?.data?.items ?? [];

  if (isLoading) return <TableSkeleton cols={4} />;
  if (rows.length === 0) return <EmptyLine>Chưa có đơn hàng nào cho khách hàng này.</EmptyLine>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50/60">
          <tr>
            <Th>Số đơn</Th>
            <Th>Trạng thái</Th>
            <Th alignEnd>Giá trị</Th>
            <Th alignEnd>Ngày đặt</Th>
          </tr>
        </thead>
        <tbody className={DEPTH.divider}>
          {rows.map((o) => (
            <tr key={o.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
              <td className={cn(ROW_PADDING.compact, TYPE.code, 'whitespace-nowrap')}>{o.order_number}</td>
              <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>{orderPill(o.status)}</td>
              <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] font-semibold text-slate-800 text-right whitespace-nowrap')}>{fmtVnd(o.total_value_vnd)}</td>
              <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 text-right whitespace-nowrap')}>{formatDate(o.order_date ?? o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Folder: Tài liệu ───────────────────────────────────────────

function TaiLieuTable({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery<{
    data: { items: DocRow[]; total: number };
  }>({
    queryKey: ['hoso-docs', customerId],
    queryFn: () => api.get(`/api/v1/documents/by-entity/customer/${customerId}`),
    retry: 1,
  });

  const rows = data?.data?.items ?? [];

  if (isLoading) return <TableSkeleton cols={4} />;
  if (rows.length === 0) return <EmptyLine>Chưa có tài liệu nào cho khách hàng này.</EmptyLine>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50/60">
          <tr>
            <Th>Tiêu đề</Th>
            <Th>Loại</Th>
            <Th alignEnd>Ngày tải lên</Th>
            <Th alignEnd>Thao tác</Th>
          </tr>
        </thead>
        <tbody className={DEPTH.divider}>
          {rows.map((d) => {
            const downloadUrl = `/api/v1/documents/${d.id}/download`;
            return (
              <tr key={d.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                <td className={cn(ROW_PADDING.compact, 'text-[13px] text-slate-800 max-w-[280px] truncate')} title={d.title}>{d.title}</td>
                <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 whitespace-nowrap')}>
                  {DOC_CATEGORY[d.category ?? ''] ?? d.category ?? '—'}
                </td>
                <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 text-right whitespace-nowrap')}>{formatDate(d.created_at)}</td>
                <td className={cn(ROW_PADDING.compact, 'text-right whitespace-nowrap')}>
                  <button
                    type="button"
                    onClick={() => window.open(buildAuthedUrl(downloadUrl), '_blank')}
                    title="Tải tài liệu"
                    className={cn(ICON_BTN, 'text-slate-600 ring-slate-200 hover:bg-slate-50')}
                  >
                    <Download className="h-3.5 w-3.5" /> Tải
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Folder: Mã đã sourcing ─────────────────────────────────────

function SourcingTable({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery<{ data: { items: SourcingRow[]; total: number } }>({
    queryKey: ['hoso-sourcing', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/by-customer/${customerId}?limit=200`),
    retry: 1,
  });

  const rows = data?.data?.items ?? [];

  if (isLoading) return <TableSkeleton cols={4} />;
  if (rows.length === 0) return <EmptyLine>Chưa có mã sourcing cho khách này.</EmptyLine>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50/60">
          <tr>
            <Th>Model / mã</Th>
            <Th>NCC</Th>
            <Th alignEnd>Giá gần nhất</Th>
            <Th alignEnd>Cập nhật</Th>
          </tr>
        </thead>
        <tbody className={DEPTH.divider}>
          {rows.map((s) => {
            // Read-only model/mã cell — Thư viện nguồn cung chưa đọc ?search= từ URL
            // nên không tạo link lọc (tránh hứa hẹn lọc không chạy). Spec cho phép
            // read-only.
            return (
              <tr key={s.id} className={cn(DEPTH.rowHover, 'transition-colors')}>
                <td className={cn(ROW_PADDING.compact, 'whitespace-nowrap')}>
                  <span className={TYPE.code}>{s.model || s.bqms_code || '—'}</span>
                  {s.product_name && (
                    <span className="block max-w-[220px] truncate text-[12px] text-slate-500" title={s.product_name}>
                      {s.product_name}
                    </span>
                  )}
                </td>
                <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-600 max-w-[160px] truncate')} title={s.supplier_name ?? undefined}>
                  {s.supplier_name ?? '—'}
                </td>
                <td className={cn(ROW_PADDING.compact, 'font-mono text-[12px] font-semibold text-slate-800 text-right whitespace-nowrap')}>
                  {s.sale_vnd != null ? (
                    <>
                      {fmtVnd(s.sale_vnd)}
                      {s.cost_currency && s.cost_currency !== 'VND' && (
                        <span className="ml-1 text-[11px] font-normal text-slate-400">{s.cost_currency}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className={cn(ROW_PADDING.compact, 'text-[12px] text-slate-500 text-right whitespace-nowrap')}>
                  {formatDate(s.updated_at ?? s.created_at ?? s.inquiry_date)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────

export function HoSoTab({ customerId }: { customerId: number }) {
  const [active, setActive] = useState<FolderKey>('baogia');

  // Lightweight count queries (shared cache keys with the tables → no double-fetch
  // of payloads; counts come from the same endpoints' `total`).
  const quotesCount = useQuery<{ data: QuoteBatchRow[]; total: number }>({
    queryKey: ['hoso-quotes', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/quote-batch?customer_id=${customerId}&limit=200`),
    retry: 1,
  });
  const ordersCount = useQuery<{ data: { items: OrderRow[]; total: number } }>({
    queryKey: ['hoso-orders', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/orders?customer_id=${customerId}&page_size=200`),
    retry: 1,
  });
  const docsCount = useQuery<{ data: { items: DocRow[]; total: number } }>({
    queryKey: ['hoso-docs', customerId],
    queryFn: () => api.get(`/api/v1/documents/by-entity/customer/${customerId}`),
    retry: 1,
  });
  const sourcingCount = useQuery<{ data: { items: SourcingRow[]; total: number } }>({
    queryKey: ['hoso-sourcing', customerId],
    queryFn: () => api.get(`/api/v1/sourcing/by-customer/${customerId}?limit=200`),
    retry: 1,
  });

  const folders: FolderDef[] = useMemo(() => [
    {
      key: 'baogia', label: 'Báo giá', icon: <FileText className="h-4 w-4" />,
      count: quotesCount.data?.total ?? null, loading: quotesCount.isLoading,
    },
    {
      key: 'donhang', label: 'Đơn hàng', icon: <Package className="h-4 w-4" />,
      count: ordersCount.data?.data?.total ?? null, loading: ordersCount.isLoading,
    },
    {
      key: 'sourcing', label: 'Mã đã sourcing', icon: <Boxes className="h-4 w-4" />,
      count: sourcingCount.data?.data?.total ?? null, loading: sourcingCount.isLoading,
    },
    {
      key: 'tailieu', label: 'Tài liệu', icon: <FolderOpen className="h-4 w-4" />,
      count: docsCount.data?.data?.total ?? null, loading: docsCount.isLoading,
    },
  ], [quotesCount.data, quotesCount.isLoading, ordersCount.data, ordersCount.isLoading, sourcingCount.data, sourcingCount.isLoading, docsCount.data, docsCount.isLoading]);

  const activeFolder = folders.find((f) => f.key === active)!;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      {/* Virtual folder rail */}
      <aside className="rounded-lg bg-white p-2 ring-1 ring-slate-200 lg:sticky lg:top-[4.75rem] lg:self-start">
        <div className={cn(TYPE.eyebrow, 'px-2 pb-1.5 pt-1')}>Hồ sơ</div>
        <FolderRail folders={folders} active={active} onSelect={setActive} />
      </aside>

      {/* Active folder table */}
      <DataPanel
        title={
          <span className="inline-flex items-center gap-1.5">
            {activeFolder.icon}{activeFolder.label}
          </span>
        }
        eyebrow={activeFolder.loading ? '—' : `${activeFolder.count ?? 0} mục`}
        flush
      >
        {active === 'baogia' && <BaoGiaTable customerId={customerId} />}
        {active === 'donhang' && <DonHangTable customerId={customerId} />}
        {active === 'sourcing' && <SourcingTable customerId={customerId} />}
        {active === 'tailieu' && <TaiLieuTable customerId={customerId} />}
      </DataPanel>
    </div>
  );
}
