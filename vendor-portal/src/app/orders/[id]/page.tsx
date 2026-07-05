'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatAmount, formatDate, formatMoneyNum } from '@/lib/format';
import type { VendorPoDetail, VendorPoItem, VendorDelivery } from '@/lib/types';
import { Badge } from '@/components/Badge';
import { FieldGrid } from '@/components/ui/FieldGrid';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { poStatusCfg } from '@/lib/format';

// Vendor-selectable delivery methods — mirror procurement_deliveries.delivery_method CHECK.
const DELIVERY_METHODS: { value: string; label: string }[] = [
  { value: 'courier', label: 'Chuyển phát' },
  { value: 'vendor_delivery', label: 'NCC tự giao' },
  { value: 'pickup', label: 'Đến lấy' },
  { value: 'express', label: 'Hỏa tốc' },
];

const DELIVERY_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  DELIVERY_METHODS.map(m => [m.value, m.label]),
);

// Payment-status labels (procurement_pos.payment_status). Falls back to the raw value.
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Chưa thanh toán',
  partial: 'Thanh toán một phần',
  paid: 'Đã thanh toán',
};

function num(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString('vi-VN');
}

function toNum(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0;
  return n == null || isNaN(n) ? 0 : n;
}

function remaining(item: VendorPoItem): number {
  return Math.max(0, toNum(item.ordered_qty) - toNum(item.delivered_qty));
}

// Local YYYY-MM-DD for the date input default (avoids UTC off-by-one from toISOString).
function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export default function OrderDetailPage() {
  const params = useParams();
  const poId = Number(params.id);

  const [po, setPo] = useState<VendorPoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Delivery declaration form state.
  const [qtyById, setQtyById] = useState<Record<number, string>>({});
  const [method, setMethod] = useState('vendor_delivery');
  const [trackingNo, setTrackingNo] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  // Đợt 8 #3 — packing/invoice (để kho đối chiếu + lên Phiếu Giao Nhận).
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [packingQty, setPackingQty] = useState('');
  const [packingUnit, setPackingUnit] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [noteBusy, setNoteBusy] = useState<number | null>(null);
  const [poPdfBusy, setPoPdfBusy] = useState(false);
  const [docBusy, setDocBusy] = useState<number | null>(null);
  // Đợt 9 #3 — xác nhận đã nhận đơn (PO acknowledge).
  const [ackBusy, setAckBusy] = useState(false);
  const [ackNote, setAckNote] = useState('');
  const [ackError, setAckError] = useState(''); // lỗi riêng cho ack (banner formError chỉ hiện trong form giao hàng)

  const load = async () => {
    try {
      const res = await api.get<{ data: VendorPoDetail }>(`/api/vendor/pos/${poId}`);
      setPo(res.data);
    } catch (err: any) {
      setError(err?.detail ?? 'Không tải được đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!poId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  // Seed each not-fully-delivered item's input with its remaining qty once the PO loads.
  useEffect(() => {
    if (!po) return;
    const seed: Record<number, string> = {};
    po.items.forEach(it => {
      const rem = remaining(it);
      if (rem > 0) seed[it.id] = String(rem);
    });
    setQtyById(seed);
  }, [po]);

  const handleSubmit = async () => {
    if (!po) return;
    setFormError('');

    // Build line items from inputs > 0, validating each against the remaining qty.
    const items: { po_item_id: number; delivered_qty: number; quality_status: 'ok' }[] = [];
    for (const it of po.items) {
      const raw = qtyById[it.id];
      if (raw == null || raw === '') continue;
      const qty = parseFloat(raw);
      if (isNaN(qty) || qty <= 0) continue;
      const rem = remaining(it);
      if (qty > rem) {
        setFormError(`Item #${it.item_no}: số lượng giao (${num(qty)}) vượt quá còn lại (${num(rem)})`);
        return;
      }
      items.push({ po_item_id: it.id, delivered_qty: qty, quality_status: 'ok' });
    }

    if (items.length === 0) {
      setFormError('Vui lòng nhập số lượng giao cho ít nhất một item');
      return;
    }
    if (!method) {
      setFormError('Vui lòng chọn phương thức giao hàng');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/api/vendor/pos/${poId}/deliveries`, {
        items,
        delivery_method: method,
        tracking_no: trackingNo.trim() || undefined,
        delivered_at: deliveredAt || undefined,
        notes: notes.trim() || undefined,
        // packing/invoice (Đợt 8 #3) — qty/weight gửi dạng SỐ (input type=number;
        // NaN → undefined để BE không nhận chuỗi rác).
        vendor_invoice_no: invoiceNo.trim() || undefined,
        invoice_date: invoiceDate || undefined,
        packing_qty: packingQty.trim() ? (parseFloat(packingQty) || undefined) : undefined,
        packing_unit: packingUnit.trim() || undefined,
        gross_weight: grossWeight.trim() ? (parseFloat(grossWeight) || undefined) : undefined,
      });
      // Reset transient fields and reload to reflect the new delivery + updated qtys/status.
      setTrackingNo('');
      setNotes('');
      setInvoiceNo('');
      setInvoiceDate('');
      setPackingQty('');
      setPackingUnit('');
      setGrossWeight('');
      await load();
    } catch (err: any) {
      setFormError(err?.detail ?? 'Khai báo giao hàng thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-5">
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-slate-100" />
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
              <div className="h-5 w-56 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-72 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-11 border-b border-slate-200 bg-slate-50" />
          <div className="divide-y divide-slate-100">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 px-3 py-3.5">
                <div className="h-3 w-6 animate-pulse rounded bg-slate-100" />
                <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-12 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-12 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );

  if (error || !po) {
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm text-rose-700"
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p>{error || 'Không tìm thấy đơn hàng'}</p>
          </div>
          <Link href="/orders" className="font-medium text-brand-600 hover:underline">
            ← Về danh sách đơn hàng
          </Link>
        </div>
      </main>
    );
  }

  const canDeclare = po.status === 'open' || po.status === 'partially_delivered';
  const isCancelled = po.status === 'cancelled';
  const openItems = po.items.filter(it => remaining(it) > 0);

  // ── PO item columns ─────────────────────────────────────────────────────────
  const itemColumns: Column<VendorPoItem>[] = [
    {
      key: 'item_no',
      header: 'STT',
      w: 52,
      align: 'right',
      render: row => <span className="font-mono tabular-nums text-slate-400">{row.item_no}</span>,
    },
    {
      key: 'specification',
      header: 'Mã / Quy cách',
      render: row => (
        <div className="min-w-0">
          <p className="text-slate-700">{row.specification}</p>
          {row.bqms_code && (
            <p className="font-mono text-[10px] text-slate-400">{row.bqms_code}</p>
          )}
        </div>
      ),
    },
    {
      key: 'ordered_qty',
      header: 'SL đặt',
      w: 88,
      align: 'right',
      render: row => <span className="font-mono tabular-nums text-slate-700">{num(row.ordered_qty)}</span>,
    },
    {
      key: 'delivered_qty',
      header: 'SL đã giao',
      w: 104,
      align: 'right',
      render: row => {
        const rem = remaining(row);
        const fully = rem <= 0;
        return (
          <span className="inline-flex flex-col items-end">
            <span className={`font-mono tabular-nums ${fully ? 'text-emerald-700' : 'text-slate-700'}`}>
              {num(row.delivered_qty)}
            </span>
            {!fully && <span className="text-[10px] tabular-nums text-slate-400">còn {num(rem)}</span>}
          </span>
        );
      },
    },
    {
      key: 'unit',
      header: 'ĐVT',
      w: 64,
      render: row => <span className="text-slate-500">{row.unit || 'EA'}</span>,
    },
    {
      key: 'unit_price',
      header: `Đơn giá (${po.currency ?? ''})`.trim(),
      w: 120,
      align: 'right',
      render: row => <span className="font-mono tabular-nums text-slate-700">{num(row.unit_price)}</span>,
    },
    {
      key: 'total_price',
      header: 'Thành tiền',
      w: 130,
      align: 'right',
      render: row => <span className="font-mono tabular-nums text-slate-800">{num(row.total_price)}</span>,
    },
  ];

  // Đợt 8 #9 — tải ĐƠN ĐẶT HÀNG PDF (authed blob, vendor-scoped).
  const downloadPoPdf = async () => {
    if (!po) return;
    setPoPdfBusy(true);
    try {
      const blob = await api.blob(`/api/vendor/pos/${poId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DonDatHang_${po.po_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setFormError(err?.detail ?? 'Tải PDF đơn hàng thất bại');
    } finally {
      setPoPdfBusy(false);
    }
  };

  // Đợt 9 #3 — NCC xác nhận đã nhận đơn → stamp + notif chiều ngược về internal team.
  const acknowledge = async () => {
    if (!po) return;
    setAckBusy(true);
    setAckError('');
    try {
      await api.post(`/api/vendor/pos/${poId}/acknowledge`, { note: ackNote || undefined });
      await load();
    } catch (err: any) {
      setAckError(err?.detail ?? 'Xác nhận thất bại');
    } finally {
      setAckBusy(false);
    }
  };

  // Đợt 8 #2 — tải Phiếu Giao Nhận PDF (authed blob, vendor-scoped endpoint).
  const downloadNote = async (deliveryId: number, deliveryNo: string) => {
    setNoteBusy(deliveryId);
    setFormError('');
    try {
      const blob = await api.blob(`/api/vendor/pos/${poId}/deliveries/${deliveryId}/note`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PhieuGiaoNhan_${deliveryNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setFormError(err?.detail ?? 'Tải Phiếu Giao Nhận thất bại');
    } finally {
      setNoteBusy(null);
    }
  };

  // Đợt 8 #6 — chứng từ CO/CQ: parse (mảng | chuỗi JSON), upload, tải.
  const parseDocs = (documents: VendorDelivery['documents']): { name: string }[] => {
    if (!documents) return [];
    if (Array.isArray(documents)) return documents;
    try { const a = JSON.parse(documents); return Array.isArray(a) ? a : []; } catch { return []; }
  };
  const uploadDoc = async (deliveryId: number, file: File) => {
    setDocBusy(deliveryId);
    setFormError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload(`/api/vendor/pos/${poId}/deliveries/${deliveryId}/upload-doc`, fd);
      await load();
    } catch (err: any) {
      setFormError(err?.detail ?? 'Tải chứng từ thất bại');
    } finally {
      setDocBusy(null);
    }
  };
  const downloadDoc = async (deliveryId: number, idx: number, name: string) => {
    try {
      const blob = await api.blob(`/api/vendor/pos/${poId}/deliveries/${deliveryId}/documents/${idx}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name || `chung-tu-${idx}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setFormError(err?.detail ?? 'Tải chứng từ thất bại');
    }
  };

  // ── Delivery history columns ────────────────────────────────────────────────
  const deliveryColumns: Column<VendorDelivery>[] = [
    {
      key: 'delivery_no',
      header: 'Số phiếu',
      w: 150,
      render: row => (
        <span className="font-mono text-[11px] font-medium text-brand-700">{row.delivery_no}</span>
      ),
    },
    {
      key: 'delivered_at',
      header: 'Ngày giao',
      w: 120,
      align: 'right',
      format: 'date',
    },
    {
      key: 'delivery_method',
      header: 'Phương thức',
      w: 130,
      render: row => (
        <span className="text-slate-600">
          {row.delivery_method ? DELIVERY_METHOD_LABEL[row.delivery_method] ?? row.delivery_method : '—'}
        </span>
      ),
    },
    {
      key: 'tracking_no',
      header: 'Mã vận đơn',
      w: 150,
      render: row => <span className="font-mono text-[11px] text-slate-500">{row.tracking_no || '—'}</span>,
    },
    {
      key: 'status',
      header: 'TT',
      w: 116,
      align: 'center',
      render: row => <StatusChip kind="delivery" status={row.status} />,
    },
    {
      key: 'note' as keyof VendorDelivery,
      header: 'Phiếu',
      w: 96,
      align: 'center',
      render: row => row.id == null ? (
        <span className="text-slate-300">—</span>
      ) : (
        <button
          onClick={() => downloadNote(row.id!, row.delivery_no)}
          disabled={noteBusy === row.id}
          className="text-[11px] font-medium text-brand-600 transition-colors hover:text-brand-700 hover:underline disabled:opacity-50"
          title="Tải Phiếu Giao Nhận (PDF)"
        >
          {noteBusy === row.id ? '...' : '↓ PDF'}
        </button>
      ),
    },
    {
      key: 'documents' as keyof VendorDelivery,
      header: 'Chứng từ (CO/CQ)',
      w: 170,
      render: row => row.id == null ? (
        <span className="text-slate-300">—</span>
      ) : (
        <div className="flex flex-col items-start gap-0.5">
          {parseDocs(row.documents).map((doc, i) => (
            <button key={i} onClick={() => downloadDoc(row.id!, i, doc.name)}
              className="max-w-[150px] truncate text-[11px] text-brand-600 hover:underline" title={doc.name}>
              📎 {doc.name}
            </button>
          ))}
          <label className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-brand-600">
            {docBusy === row.id ? 'Đang tải...' : '＋ Tải lên'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={docBusy === row.id}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(row.id!, f); e.currentTarget.value = ''; }} />
          </label>
        </div>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      {/* Back link */}
      <Link
        href="/orders"
        className="mb-4 inline-block text-sm text-slate-400 transition-colors hover:text-brand-600"
      >
        ← Danh sách đơn hàng
      </Link>

      {/* Header card */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 shadow-sm">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-sm text-brand-600">
                  {po.po_no}
                </span>
                <Badge {...poStatusCfg(po.status)} withDot />
              </div>
              <h1 className="text-xl font-bold text-slate-800">Đơn đặt hàng</h1>
              <p className="mt-1 text-xs text-slate-500">
                {po.contract_no && <>HĐ {po.contract_no} · </>}
                {po.items.length} mục
                {po.po_date && <> · Đặt ngày {formatDate(po.po_date)}</>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-400">Tổng tiền</p>
              <p className="font-mono text-lg font-bold tabular-nums text-brand-700">
                {formatAmount(po.total_amount, po.currency)}
              </p>
            </div>
            <button
              onClick={downloadPoPdf}
              disabled={poPdfBusy}
              title="Tải Đơn đặt hàng (PDF)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-700 disabled:opacity-50"
            >
              {poPdfBusy ? '...' : '↓ PDF'}
            </button>
          </div>
        </div>

        {/* Đợt 9 #3 — Xác nhận đã nhận đơn (ack KHÔNG phải status) */}
        {po.acknowledged_at ? (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            ✓ Đã xác nhận {formatDate(po.acknowledged_at)}
          </div>
        ) : (
          po.status !== 'cancelled' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={acknowledge}
                disabled={ackBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {ackBusy ? 'Đang xác nhận…' : '✓ Xác nhận đã nhận đơn'}
              </button>
              <input
                type="text"
                value={ackNote}
                onChange={e => setAckNote(e.target.value)}
                placeholder="Ghi chú (tùy chọn)"
                className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              {ackError && <p className="w-full text-xs text-rose-600">{ackError}</p>}
            </div>
          )
        )}

        {/* Meta grid */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <FieldGrid
            fields={[
              { label: 'Số PO', value: po.po_no, mono: true, tone: 'brand' },
              { label: 'Hợp đồng', value: po.contract_no ?? null, mono: true },
              { label: 'Ngày PO', value: po.po_date ? formatDate(po.po_date) : null, mono: true },
              {
                label: 'Ngày yêu cầu giao',
                value: po.requested_delivery_date ? formatDate(po.requested_delivery_date) : null,
                mono: true,
              },
              {
                label: 'Ngày giao thực tế',
                value: po.actual_delivery_date ? formatDate(po.actual_delivery_date) : null,
                mono: true,
              },
              {
                label: 'Tổng tiền',
                value: formatMoneyNum(po.total_amount, po.currency),
                mono: true,
                tone: 'brand',
              },
              {
                label: 'TT thanh toán',
                value: po.payment_status
                  ? PAYMENT_STATUS_LABEL[po.payment_status] ?? po.payment_status
                  : null,
              },
              {
                label: 'Địa chỉ giao',
                value: po.delivery_address ?? null,
                colSpan: 2,
              },
            ]}
          />
        </div>
      </div>

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="mb-5 rounded-2xl bg-rose-50 p-4 ring-1 ring-inset ring-rose-200">
          <p className="text-sm font-medium text-rose-700">Đơn hàng này đã bị hủy.</p>
        </div>
      )}

      {/* Items */}
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-bold text-slate-700">Danh sách mục</h2>
        <span className="text-xs tabular-nums text-slate-400">({po.items.length})</span>
      </div>
      <div className="mb-5">
        <DataTable<VendorPoItem>
          columns={itemColumns}
          rows={po.items}
          emptyLabel="Không có mục nào"
          stickyHeader={false}
        />
        <div className="mt-2 flex items-center justify-end gap-3 px-1">
          <span className="text-xs font-semibold text-slate-500">Tổng cộng:</span>
          <span className="font-mono text-sm font-bold tabular-nums text-brand-700">
            {formatAmount(po.total_amount, po.currency)}
          </span>
        </div>
      </div>

      {/* Deliveries */}
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-bold text-slate-700">Lịch sử giao hàng</h2>
        <span className="text-xs tabular-nums text-slate-400">({po.deliveries.length})</span>
      </div>
      <div className="mb-6">
        <DataTable<VendorDelivery>
          columns={deliveryColumns}
          rows={po.deliveries}
          emptyLabel="Chưa có lần giao hàng nào"
          stickyHeader={false}
        />
      </div>

      {/* Delivery declaration form — only when PO is open / partially_delivered. */}
      {canDeclare && (
        openItems.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
            <p className="text-sm font-medium text-emerald-700">
              Tất cả mục đã được giao đủ số lượng. Không còn gì để khai báo.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-brand-50/40 p-6 ring-1 ring-brand-200">
            <h3 className="mb-1 text-base font-bold text-slate-800">Khai báo giao hàng</h3>
            <p className="mb-4 text-sm text-slate-500">
              Nhập số lượng giao cho từng mục (mặc định = số còn lại). Sau khi gửi, Song Châu sẽ xác nhận khi
              hàng đến.
            </p>

            {/* Per-item qty inputs */}
            <div className="mb-4 overflow-x-auto rounded-lg border border-brand-200 bg-white">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="w-10 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">#</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Quy cách</th>
                    <th className="w-24 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Còn lại</th>
                    <th className="w-36 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">SL giao lần này</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openItems.map(item => {
                    const rem = remaining(item);
                    const raw = qtyById[item.id] ?? '';
                    const qtyNum = raw === '' ? 0 : parseFloat(raw);
                    const over = !isNaN(qtyNum) && qtyNum > rem;
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-3 align-top font-mono text-xs tabular-nums text-slate-400">{item.item_no}</td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-slate-700">{item.specification}</p>
                          {item.bqms_code && <p className="font-mono text-xs text-slate-400">{item.bqms_code}</p>}
                        </td>
                        <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums text-slate-600">
                          {num(rem)} {item.unit || 'EA'}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            step="any"
                            value={raw}
                            onChange={e => setQtyById(prev => ({ ...prev, [item.id]: e.target.value }))}
                            aria-invalid={over}
                            aria-label={`Số lượng giao cho item ${item.item_no}`}
                            className={`w-full rounded-lg border bg-white px-3 py-2 text-right text-sm tabular-nums transition-all focus:outline-none focus:ring-2 ${
                              over
                                ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                                : 'border-slate-200 focus:border-brand-400 focus:ring-brand-100'
                            }`}
                          />
                          {over && <p className="mt-1 text-right text-[11px] text-rose-600">Vượt quá còn lại</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Shipment meta */}
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="delivery-method" className="mb-1 block text-xs text-slate-500">
                  Phương thức giao hàng *
                </label>
                <select
                  id="delivery-method"
                  value={method}
                  onChange={e => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  {DELIVERY_METHODS.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="delivered-at" className="mb-1 block text-xs text-slate-500">
                  Ngày giao
                </label>
                <input
                  id="delivered-at"
                  type="date"
                  value={deliveredAt}
                  onChange={e => setDeliveredAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label htmlFor="tracking-no" className="mb-1 block text-xs text-slate-500">
                  Mã vận đơn
                </label>
                <input
                  id="tracking-no"
                  type="text"
                  value={trackingNo}
                  onChange={e => setTrackingNo(e.target.value)}
                  placeholder="Không bắt buộc"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </div>
              {/* Đợt 8 #3 — Đóng gói / hóa đơn (không bắt buộc, dùng cho Phiếu Giao Nhận) */}
              <div>
                <label htmlFor="invoice-no" className="mb-1 block text-xs text-slate-500">Số hóa đơn</label>
                <input id="invoice-no" type="text" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="Không bắt buộc"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label htmlFor="invoice-date" className="mb-1 block text-xs text-slate-500">Ngày hóa đơn</label>
                <input id="invoice-date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label htmlFor="packing-qty" className="mb-1 block text-xs text-slate-500">Số kiện</label>
                <input id="packing-qty" type="number" min="0" value={packingQty} onChange={e => setPackingQty(e.target.value)} placeholder="Không bắt buộc"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm tabular-nums transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label htmlFor="packing-unit" className="mb-1 block text-xs text-slate-500">ĐVT kiện</label>
                <input id="packing-unit" type="text" value={packingUnit} onChange={e => setPackingUnit(e.target.value)} placeholder="BOX / PALLET…"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
              <div>
                <label htmlFor="gross-weight" className="mb-1 block text-xs text-slate-500">Tổng KL (KG)</label>
                <input id="gross-weight" type="number" min="0" step="0.01" value={grossWeight} onChange={e => setGrossWeight(e.target.value)} placeholder="Không bắt buộc"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm tabular-nums transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="delivery-notes" className="mb-1 block text-xs text-slate-500">
                Ghi chú
              </label>
              <textarea
                id="delivery-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Không bắt buộc"
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>

            {formError && (
              <div
                role="alert"
                aria-live="polite"
                className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p>{formError}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Đang gửi...' : 'Gửi khai báo giao hàng'}
            </button>
          </div>
        )
      )}
    </main>
  );
}
