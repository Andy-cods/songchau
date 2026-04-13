'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

interface SaleInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  buyer_name: string;
  buyer_tax_code?: string;
  item_name?: string;
  unit?: string;
  quantity?: number;
  unit_price?: number;
  amount_before_tax?: number;
  tax_rate?: string;
  tax_amount?: number;
  total_amount?: number;
  supplier_name?: string;
  cost_price?: number;
  cost_vat?: number;
  shipping_cost?: number;
  customs_fee?: number;
  commission?: number;
  other_costs?: number;
  manual_adjustment?: number;
  notes?: string;
  source?: string;
}

interface PurchaseInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  seller_name: string;
  seller_tax_code?: string;
  item_name?: string;
  unit?: string;
  quantity?: number;
  unit_price?: number;
  amount_before_tax?: number;
  tax_rate?: string;
  tax_amount?: number;
  total_amount?: number;
  customer_code?: string;
  item_code?: string;
  shipping_cost?: number;
  customs_fee?: number;
  other_costs?: number;
  manual_adjustment?: number;
  notes?: string;
  source?: string;
}

type InvoiceType = 'sales' | 'purchases';

const QUARTERS = ['Q1-2026', 'Q2-2026', 'Q3-2026', 'Q4-2026'];

function fmtNum(n: number | null | undefined): string {
  if (n == null || n === 0) return '';
  return Number(n).toLocaleString('vi-VN');
}

function fmtVnd(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} tr`;
  return Number(n).toLocaleString('vi-VN');
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.replace(/,/g, '').replace(/\s+/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseRatePercent(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function salesConfiguredCost(row: Partial<SaleInvoice>): number {
  return asNumber(row.cost_price)
    + asNumber(row.cost_vat)
    + asNumber(row.shipping_cost)
    + asNumber(row.customs_fee)
    + asNumber(row.commission)
    + asNumber(row.other_costs)
    + asNumber(row.manual_adjustment);
}

function purchaseExtraCosts(row: Partial<PurchaseInvoice>): number {
  return asNumber(row.shipping_cost)
    + asNumber(row.customs_fee)
    + asNumber(row.other_costs)
    + asNumber(row.manual_adjustment);
}

export default function QuarterlyInvoicesPage() {
  const [activeTab, setActiveTab] = useState<InvoiceType>('sales');
  const [quarter, setQuarter] = useState('Q1-2026');
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bảng kê hóa đơn</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Dữ liệu thật theo quý. Có thể chỉnh VAT, thuế và các loại chi phí bổ sung trên từng hóa đơn.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={quarter}
            onChange={e => setQuarter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {QUARTERS.map(q => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowUpload(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Tải lên PDF
          </button>
        </div>
      </div>

      <div className="mb-4 flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('sales')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors',
            activeTab === 'sales'
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          Bán ra
        </button>
        <button
          onClick={() => setActiveTab('purchases')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors',
            activeTab === 'purchases'
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          Mua vào
        </button>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="Tìm số HĐ, đối tác, mặt hàng..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-80 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          Summary phản ánh dữ liệu thật của quý đang chọn và các chi phí anh chỉnh trên từng dòng.
        </div>
      </div>

      {activeTab === 'sales' ? (
        <SalesTable quarter={quarter} search={search} />
      ) : (
        <PurchasesTable quarter={quarter} search={search} />
      )}

      {showUpload && (
        <UploadPdfModal quarter={quarter} invoiceType={activeTab} onClose={() => setShowUpload(false)} />
      )}
    </div>
  );
}

function SalesTable({ quarter, search }: { quarter: string; search: string }) {
  const [page, setPage] = useState(1);
  const [editingInvoice, setEditingInvoice] = useState<SaleInvoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-q', quarter, search, page],
    queryFn: () =>
      api.get<any>(
        `/api/v1/quarterly-invoices/sales?quarter=${quarter}&search=${search}&page=${page}&limit=50`,
      ),
  });

  const rows: SaleInvoice[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary ?? {};

  return (
    <div>
      <div className="mb-3 grid grid-cols-6 gap-3">
        <SummaryCard label="Số HĐ" value={fmtNum(summary.count)} />
        <SummaryCard label="Doanh số chưa thuế" value={fmtVnd(summary.total_before_tax)} color="brand" />
        <SummaryCard label="Thuế GTGT" value={fmtVnd(summary.total_tax)} />
        <SummaryCard label="Tổng có thuế" value={fmtVnd(summary.total_with_tax)} color="emerald" />
        <SummaryCard label="Lợi nhuận gộp" value={fmtVnd(summary.gross_profit)} color="violet" />
        <SummaryCard label="Chi phí cấu hình" value={fmtVnd(summary.total_configured_cost)} color="amber" />
      </div>
      <div className="mb-3 grid grid-cols-[1fr_1.2fr] gap-3">
        <SummaryCard label="Lãi sau chi phí" value={fmtVnd(summary.net_profit_after_costs)} color="brand" />
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Có thể chỉnh: VAT, giá vốn, VAT đầu vào, vận chuyển, hải quan, hoa hồng, chi phí khác và điều chỉnh tay.
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-10 px-2 py-2 text-left font-mono text-slate-500">#</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Số HĐ</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Ngày</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Người mua</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Mặt hàng</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">Chưa thuế</th>
                <th className="px-2 py-2 text-center font-mono text-slate-500">Thuế</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">VAT</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">Giá vốn</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">CP cấu hình</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">Lãi sau CP</th>
                <th className="w-16 px-2 py-2 text-center font-mono text-slate-500">Sửa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400">
                    Đang tải...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400">
                    Chưa có hóa đơn
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const configuredCost = salesConfiguredCost(row);
                  const netProfit = asNumber(row.amount_before_tax) - configuredCost;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono text-slate-400">{(page - 1) * 50 + index + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-brand-600">{row.invoice_number}</td>
                      <td className="px-2 py-1.5 text-slate-600">{formatDate(row.invoice_date)}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700" title={row.buyer_name}>
                        {row.buyer_name}
                      </td>
                      <td className="max-w-[240px] truncate px-2 py-1.5 text-slate-600" title={row.item_name}>
                        {row.item_name}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtNum(row.amount_before_tax)}</td>
                      <td className="px-2 py-1.5 text-center text-slate-500">{row.tax_rate}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtNum(row.tax_amount)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-500">{fmtNum(row.cost_price)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmtNum(configuredCost)}</td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-800">{fmtNum(netProfit)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => setEditingInvoice(row)}
                          className="inline-flex items-center justify-center rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Sửa VAT và chi phí"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination rows={rows.length} total={total} page={page} onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)} />
      </div>

      {editingInvoice && (
        <QuarterlyInvoiceEditModal invoiceType="sales" invoice={editingInvoice} onClose={() => setEditingInvoice(null)} />
      )}
    </div>
  );
}

function PurchasesTable({ quarter, search }: { quarter: string; search: string }) {
  const [page, setPage] = useState(1);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases-q', quarter, search, page],
    queryFn: () =>
      api.get<any>(
        `/api/v1/quarterly-invoices/purchases?quarter=${quarter}&search=${search}&page=${page}&limit=50`,
      ),
  });

  const rows: PurchaseInvoice[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary ?? {};

  return (
    <div>
      <div className="mb-3 grid grid-cols-5 gap-3">
        <SummaryCard label="Số HĐ" value={fmtNum(summary.count)} />
        <SummaryCard label="Chưa thuế" value={fmtVnd(summary.total_before_tax)} color="brand" />
        <SummaryCard label="Thuế GTGT" value={fmtVnd(summary.total_tax)} />
        <SummaryCard label="Tổng có thuế" value={fmtVnd(summary.total_with_tax)} color="amber" />
        <SummaryCard label="Chi phí cộng thêm" value={fmtVnd(summary.total_extra_costs)} color="violet" />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-10 px-2 py-2 text-left font-mono text-slate-500">#</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Số HĐ</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Ngày</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Người bán</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">MST</th>
                <th className="px-2 py-2 text-left font-mono text-slate-500">Mặt hàng</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">Chưa thuế</th>
                <th className="px-2 py-2 text-center font-mono text-slate-500">Thuế</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">VAT</th>
                <th className="px-2 py-2 text-right font-mono text-slate-500">CP thêm</th>
                <th className="w-16 px-2 py-2 text-center font-mono text-slate-500">Sửa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    Đang tải...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    Chưa có hóa đơn
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const extraCosts = purchaseExtraCosts(row);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono text-slate-400">{(page - 1) * 50 + index + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-brand-600">{row.invoice_number}</td>
                      <td className="px-2 py-1.5 text-slate-600">{formatDate(row.invoice_date)}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700" title={row.seller_name}>
                        {row.seller_name}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-slate-500">{row.seller_tax_code ?? '—'}</td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-600" title={row.item_name}>
                        {row.item_name}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtNum(row.amount_before_tax)}</td>
                      <td className="px-2 py-1.5 text-center text-slate-500">{row.tax_rate}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtNum(row.tax_amount)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmtNum(extraCosts)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => setEditingInvoice(row)}
                          className="inline-flex items-center justify-center rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Sửa VAT và chi phí"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination rows={rows.length} total={total} page={page} onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)} />
      </div>

      {editingInvoice && (
        <QuarterlyInvoiceEditModal invoiceType="purchases" invoice={editingInvoice} onClose={() => setEditingInvoice(null)} />
      )}
    </div>
  );
}

function Pagination({
  rows,
  total,
  page,
  onPrev,
  onNext,
}: {
  rows: number;
  total: number;
  page: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs">
      <span className="text-slate-500">Hiển thị {rows} / {total} hóa đơn</span>
      <div className="flex items-center gap-2">
        <button disabled={page === 1} onClick={onPrev} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">
          Trước
        </button>
        <span className="font-mono">Trang {page} / {Math.ceil(total / 50) || 1}</span>
        <button disabled={page * 50 >= total} onClick={onNext} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">
          Sau
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = 'slate',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const colors: Record<string, string> = {
    slate: 'border-slate-200 text-slate-800',
    brand: 'border-brand-200 text-brand-700',
    emerald: 'border-emerald-200 text-emerald-700',
    amber: 'border-amber-200 text-amber-700',
    violet: 'border-violet-200 text-violet-700',
  };

  return (
    <div className={cn('rounded-lg border border-slate-200 border-l-4 bg-white px-4 py-3', colors[color])}>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}
function QuarterlyInvoiceEditModal({
  invoiceType,
  invoice,
  onClose,
}: {
  invoiceType: InvoiceType;
  invoice: SaleInvoice | PurchaseInvoice;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    amount_before_tax: asNumber(invoice.amount_before_tax),
    tax_rate: invoice.tax_rate ?? '10%',
    tax_amount: asNumber(invoice.tax_amount),
    total_amount: asNumber(invoice.total_amount),
    cost_price: asNumber((invoice as SaleInvoice).cost_price),
    cost_vat: asNumber((invoice as SaleInvoice).cost_vat),
    shipping_cost: asNumber(invoice.shipping_cost),
    customs_fee: asNumber(invoice.customs_fee),
    commission: asNumber((invoice as SaleInvoice).commission),
    other_costs: asNumber(invoice.other_costs),
    manual_adjustment: asNumber(invoice.manual_adjustment),
    notes: invoice.notes ?? '',
  });

  const recalcVat = () => {
    const taxAmount = Math.round((form.amount_before_tax * parseRatePercent(form.tax_rate)) / 100);
    setForm(prev => ({
      ...prev,
      tax_amount: taxAmount,
      total_amount: prev.amount_before_tax + taxAmount,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload =
        invoiceType === 'sales'
          ? {
              amount_before_tax: form.amount_before_tax,
              tax_rate: form.tax_rate,
              tax_amount: form.tax_amount,
              total_amount: form.total_amount,
              cost_price: form.cost_price,
              cost_vat: form.cost_vat,
              shipping_cost: form.shipping_cost,
              customs_fee: form.customs_fee,
              commission: form.commission,
              other_costs: form.other_costs,
              manual_adjustment: form.manual_adjustment,
              notes: form.notes,
            }
          : {
              amount_before_tax: form.amount_before_tax,
              tax_rate: form.tax_rate,
              tax_amount: form.tax_amount,
              total_amount: form.total_amount,
              shipping_cost: form.shipping_cost,
              customs_fee: form.customs_fee,
              other_costs: form.other_costs,
              manual_adjustment: form.manual_adjustment,
              notes: form.notes,
            };

      const path =
        invoiceType === 'sales'
          ? `/api/v1/quarterly-invoices/sales/${invoice.id}`
          : `/api/v1/quarterly-invoices/purchases/${invoice.id}`;

      await api.put(path, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales-q'] }),
        queryClient.invalidateQueries({ queryKey: ['purchases-q'] }),
      ]);
      onClose();
    } catch (err: any) {
      setError(err?.detail ?? 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const totalConfiguredCosts =
    invoiceType === 'sales'
      ? form.cost_price
        + form.cost_vat
        + form.shipping_cost
        + form.customs_fee
        + form.commission
        + form.other_costs
        + form.manual_adjustment
      : form.shipping_cost + form.customs_fee + form.other_costs + form.manual_adjustment;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[760px] rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-800">Chỉnh VAT và chi phí</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {invoice.invoice_number} · {formatDate(invoice.invoice_date)}
            </p>
          </div>
          <button onClick={onClose} className="text-lg text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 px-5 py-4">
          <NumberField label="Giá trị chưa thuế" value={form.amount_before_tax} onChange={value => setForm(prev => ({ ...prev, amount_before_tax: value }))} />
          <TextField label="Thuế suất" value={form.tax_rate} onChange={value => setForm(prev => ({ ...prev, tax_rate: value }))} />
          <NumberField label="Tiền VAT" value={form.tax_amount} onChange={value => setForm(prev => ({ ...prev, tax_amount: value }))} />
          <NumberField label="Tổng thanh toán" value={form.total_amount} onChange={value => setForm(prev => ({ ...prev, total_amount: value }))} />

          {invoiceType === 'sales' && (
            <>
              <NumberField label="Giá vốn" value={form.cost_price} onChange={value => setForm(prev => ({ ...prev, cost_price: value }))} />
              <NumberField label="VAT đầu vào" value={form.cost_vat} onChange={value => setForm(prev => ({ ...prev, cost_vat: value }))} />
              <NumberField label="Hoa hồng" value={form.commission} onChange={value => setForm(prev => ({ ...prev, commission: value }))} />
            </>
          )}

          <NumberField label="Phí vận chuyển" value={form.shipping_cost} onChange={value => setForm(prev => ({ ...prev, shipping_cost: value }))} />
          <NumberField label="Phí hải quan" value={form.customs_fee} onChange={value => setForm(prev => ({ ...prev, customs_fee: value }))} />
          <NumberField label="Chi phí khác" value={form.other_costs} onChange={value => setForm(prev => ({ ...prev, other_costs: value }))} />
          <NumberField label="Điều chỉnh tay" value={form.manual_adjustment} onChange={value => setForm(prev => ({ ...prev, manual_adjustment: value }))} />
        </div>

        <div className="px-5 pb-4">
          <label className="mb-1 block text-xs text-slate-500">Ghi chú kế toán</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="mx-5 mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span>Tổng chi phí đang cấu hình</span>
            <strong className="font-mono text-slate-800">{fmtNum(totalConfiguredCosts)}</strong>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Thuế suất hiện tại</span>
            <strong className="font-mono text-slate-800">{form.tax_rate || '0%'}</strong>
          </div>
        </div>

        {error && <div className="mx-5 mb-4 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

        <div className="flex justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <button
            onClick={recalcVat}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Tự tính lại VAT
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
              Đóng
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(asNumber(e.target.value))}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}

function UploadPdfModal({
  quarter,
  invoiceType,
  onClose,
}: {
  quarter: string;
  invoiceType: InvoiceType;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Chọn file PDF');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('invoice_type', invoiceType);
      fd.append('quarter', quarter);
      fd.append('file', file);

      const res = await api.upload<any>('/api/v1/quarterly-invoices/upload-pdf', fd);
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['sales-q'] });
      queryClient.invalidateQueries({ queryKey: ['purchases-q'] });
    } catch (err: any) {
      setError(err?.detail ?? 'Upload thất bại');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[500px] rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-800">Tải lên hóa đơn PDF</h3>
          <button onClick={onClose} className="text-lg text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs text-slate-500">
            Quý: <strong className="text-slate-700">{quarter}</strong> · Loại:{' '}
            <strong className="text-slate-700">{invoiceType === 'sales' ? 'Bán ra' : 'Mua vào'}</strong>
          </p>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Chọn file PDF</label>
            <input ref={fileRef} type="file" accept="application/pdf" className="w-full text-sm" />
          </div>

          {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

          {result && (
            <div className="space-y-1 rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-700">{result.message}</p>
              {result.parsed && (
                <div className="space-y-0.5 text-xs text-slate-600">
                  {result.parsed.invoice_number && (
                    <p>
                      Số HĐ: <strong>{result.parsed.invoice_number}</strong>
                    </p>
                  )}
                  {result.parsed.invoice_date && (
                    <p>
                      Ngày: <strong>{result.parsed.invoice_date}</strong>
                    </p>
                  )}
                  {result.parsed.total_amount && (
                    <p>
                      Tổng: <strong>{result.parsed.total_amount.toLocaleString('vi-VN')} VND</strong>
                    </p>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">Vào danh sách để review và chỉnh tiếp VAT hoặc chi phí nếu cần.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
            Đóng
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? 'Đang xử lý...' : 'Tải lên + Parse'}
          </button>
        </div>
      </div>
    </div>
  );
}
