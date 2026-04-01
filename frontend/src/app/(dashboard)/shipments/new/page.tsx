'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────

interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier?: { name: string };
}

interface ShipmentItem {
  id: string;
  bqms_code: string;
  product_name: string;
  quantity_shipped: number;
  unit: string;
}

function newItem(): ShipmentItem {
  return {
    id: `item-${Date.now()}-${Math.random()}`,
    bqms_code: '',
    product_name: '',
    quantity_shipped: 1,
    unit: 'bộ',
  };
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function NewShipmentPage() {
  const router = useRouter();
  const [poId, setPoId] = useState<number | null>(null);
  const [shippingMethod, setShippingMethod] = useState<'sea' | 'air' | 'road'>('sea');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [etd, setEtd] = useState('');
  const [eta, setEta] = useState('');
  const [items, setItems] = useState<ShipmentItem[]>([newItem()]);

  const { data: posData } = useQuery<{ items: PurchaseOrder[] }>({
    queryKey: ['purchase-orders-list'],
    queryFn: () => api.get('/api/v1/purchase-orders?status=approved'),
  });
  const pos = posData?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/api/v1/shipments', body),
    onSuccess: (data: any) => {
      toast.success('Đã tạo lô hàng thành công!');
      router.push(`/shipments/${data.id}`);
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Không thể tạo lô hàng'),
  });

  const handleItemChange = (id: string, field: keyof ShipmentItem, value: string | number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = () => {
    if (!poId) { toast.error('Vui lòng chọn đơn mua hàng'); return; }
    createMutation.mutate({
      po_id: poId,
      shipping_method: shippingMethod,
      carrier: carrier || undefined,
      tracking_number: trackingNumber || undefined,
      etd: etd || undefined,
      eta: eta || undefined,
      status: 'pending',
      items: items.map(({ id: _id, ...rest }) => rest),
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/shipments" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tạo lô hàng mới</h2>
          <p className="text-sm text-slate-500 mt-0.5">Khai báo thông tin vận chuyển</p>
        </div>
      </div>

      <div className="space-y-6 max-w-4xl">
        {/* General Info */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Thông tin chung</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Đơn mua hàng <span className="text-red-500">*</span></label>
              <select
                value={poId ?? ''}
                onChange={(e) => setPoId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- Chọn PO --</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_number}{po.supplier ? ` — ${po.supplier.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Phương thức vận chuyển</label>
              <select
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value as 'sea' | 'air' | 'road')}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="sea">Đường biển</option>
                <option value="air">Hàng không</option>
                <option value="road">Đường bộ</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Hãng vận chuyển</label>
              <input
                type="text"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="VD: COSCO, DHL..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Mã tracking</label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Nhập mã theo dõi..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">ETD (Ngày xuất dự kiến)</label>
              <input
                type="date"
                value={etd}
                onChange={(e) => setEtd(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">ETA (Ngày đến dự kiến)</label>
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Danh sách hàng hóa</h3>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, newItem()])}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 rounded-md transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm dòng
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-10">#</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã BQMS</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tên sản phẩm</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-28">SL giao</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-24">Đơn vị</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <tr key={item.id} className="group">
                  <td className="px-4 py-2 text-xs text-slate-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={item.bqms_code}
                      onChange={(e) => handleItemChange(item.id, 'bqms_code', e.target.value)}
                      placeholder="BQMS-XXXX"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={item.product_name}
                      onChange={(e) => handleItemChange(item.id, 'product_name', e.target.value)}
                      placeholder="Tên sản phẩm..."
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity_shipped}
                      onChange={(e) => handleItemChange(item.id, 'quantity_shipped', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={item.unit}
                      onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
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

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link href="/shipments" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Hủy</Link>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Tạo lô hàng
          </button>
        </div>
      </div>
    </div>
  );
}
