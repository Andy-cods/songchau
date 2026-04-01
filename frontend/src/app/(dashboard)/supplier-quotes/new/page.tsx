'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Trash2, Search, ChevronLeft, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────

interface Supplier {
  id: number;
  name: string;
  code?: string;
}

interface LineItem {
  id: string;
  bqms_code: string;
  specification: string;
  maker: string;
  quantity: number;
  unit: string;
}

interface RFQ {
  id: number;
  rfq_number: string;
  items: Array<{
    bqms_code: string;
    specification: string;
    maker: string;
    quantity: number;
    unit: string;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────

function newLine(): LineItem {
  return {
    id: `line-${Date.now()}-${Math.random()}`,
    bqms_code: '',
    specification: '',
    maker: '',
    quantity: 1,
    unit: 'bộ',
  };
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function NewSupplierQuotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rfqIdParam = searchParams.get('rfq_id');

  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [rfqSearch, setRfqSearch] = useState('');
  const [linkedRfqId, setLinkedRfqId] = useState<number | null>(rfqIdParam ? Number(rfqIdParam) : null);
  const [lines, setLines] = useState<LineItem[]>([newLine()]);
  const [rfqError, setRfqError] = useState('');

  // Fetch suppliers list
  const { data: suppliersData, isLoading: suppliersLoading } = useQuery<{ items: Supplier[] }>({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/api/v1/suppliers'),
  });
  const suppliers = suppliersData?.items ?? [];

  // Auto-fill from RFQ param if provided
  const { data: rfqData, isLoading: rfqLoading } = useQuery<RFQ>({
    queryKey: ['rfq-detail', linkedRfqId],
    queryFn: () => api.get(`/api/v1/bqms/rfq/${linkedRfqId}`),
    enabled: linkedRfqId != null,
  });

  useEffect(() => {
    if (rfqData?.items && rfqData.items.length > 0) {
      setLines(
        rfqData.items.map((item) => ({
          id: `rfq-${Math.random()}`,
          bqms_code: item.bqms_code ?? '',
          specification: item.specification ?? '',
          maker: item.maker ?? '',
          quantity: item.quantity ?? 1,
          unit: item.unit ?? 'bộ',
        }))
      );
      setRfqSearch(rfqData.rfq_number);
    }
  }, [rfqData]);

  // RFQ lookup by number
  const rfqLookupMutation = useMutation({
    mutationFn: (rfqNumber: string) => api.get<RFQ>(`/api/v1/bqms/rfq/by-number/${rfqNumber}`),
    onSuccess: (data) => {
      setLinkedRfqId(data.id);
      setRfqError('');
      toast.success(`Đã tìm thấy RFQ: ${data.rfq_number}`);
    },
    onError: () => {
      setRfqError('Không tìm thấy RFQ với số này');
    },
  });

  // Submit mutation
  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/api/v1/supplier-quotes', body),
    onSuccess: (data: any) => {
      toast.success('Đã tạo báo giá NCC thành công!');
      router.push(`/supplier-quotes/${data.id}`);
    },
    onError: (err: any) => {
      toast.error(err?.detail ?? 'Không thể tạo báo giá');
    },
  });

  const handleAddLine = () => setLines((prev) => [...prev, newLine()]);

  const handleRemoveLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const handleLineChange = (id: string, field: keyof LineItem, value: string | number) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const handleSubmit = () => {
    if (!supplierId) {
      toast.error('Vui lòng chọn nhà cung cấp');
      return;
    }
    if (lines.some((l) => !l.bqms_code)) {
      toast.error('Vui lòng điền mã BQMS cho tất cả dòng hàng');
      return;
    }
    createMutation.mutate({
      supplier_id: supplierId,
      rfq_id: linkedRfqId ?? undefined,
      status: 'draft',
      items: lines.map(({ id: _id, ...rest }) => rest),
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/supplier-quotes" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tạo báo giá nhà cung cấp</h2>
          <p className="text-sm text-slate-500 mt-0.5">Yêu cầu báo giá từ nhà cung cấp</p>
        </div>
      </div>

      <div className="space-y-6 max-w-4xl">
        {/* Supplier Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Thông tin chung</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Supplier */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Nhà cung cấp <span className="text-red-500">*</span>
              </label>
              {suppliersLoading ? (
                <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={supplierId ?? ''}
                  onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                >
                  <option value="">-- Chọn nhà cung cấp --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* RFQ Lookup */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Liên kết RFQ (tùy chọn)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={rfqSearch}
                  onChange={(e) => {
                    setRfqSearch(e.target.value);
                    setRfqError('');
                  }}
                  placeholder="Nhập số RFQ..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && rfqSearch.trim()) {
                      rfqLookupMutation.mutate(rfqSearch.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => rfqSearch.trim() && rfqLookupMutation.mutate(rfqSearch.trim())}
                  disabled={rfqLookupMutation.isPending}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {rfqLookupMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </button>
              </div>
              {rfqError && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {rfqError}
                </p>
              )}
              {linkedRfqId && !rfqError && (
                <p className="mt-1 text-xs text-green-600">Đã liên kết RFQ #{linkedRfqId}</p>
              )}
              {rfqLoading && (
                <p className="mt-1 text-xs text-slate-400">Đang tải dữ liệu RFQ...</p>
              )}
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Danh sách hàng hóa</h3>
            <button
              type="button"
              onClick={handleAddLine}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-md transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm dòng
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-10">#</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã BQMS</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thông số kỹ thuật</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-24">Số lượng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-24">Đơn vị</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="group">
                    <td className="px-4 py-2 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.bqms_code}
                        onChange={(e) => handleLineChange(line.id, 'bqms_code', e.target.value)}
                        placeholder="BQMS-XXXX"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.specification}
                        onChange={(e) => handleLineChange(line.id, 'specification', e.target.value)}
                        placeholder="Nhập thông số..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.maker}
                        onChange={(e) => handleLineChange(line.id, 'maker', e.target.value)}
                        placeholder="Hãng sản xuất..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => handleLineChange(line.id, 'quantity', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => handleLineChange(line.id, 'unit', e.target.value)}
                        placeholder="bộ"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.id)}
                          className="p-1 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
            <span className="text-xs text-slate-400">Tổng {lines.length} dòng hàng</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link href="/supplier-quotes" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Hủy
          </Link>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Tạo báo giá (Nháp)
          </button>
        </div>
      </div>
    </div>
  );
}
