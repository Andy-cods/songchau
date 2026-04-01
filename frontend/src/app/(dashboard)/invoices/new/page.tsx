'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────

interface InvoiceItem {
  id: string;
  description: string;
  bqms_code: string;
  quantity: number;
  unit_price_vnd: number;
}

function newItem(): InvoiceItem {
  return {
    id: `item-${Date.now()}-${Math.random()}`,
    description: '',
    bqms_code: '',
    quantity: 1,
    unit_price_vnd: 0,
  };
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function NewInvoicePage() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerTaxCode, setCustomerTaxCode] = useState('');
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([newItem()]);

  const totalVnd = items.reduce((sum, item) => sum + item.quantity * item.unit_price_vnd, 0);

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/api/v1/invoices', body),
    onSuccess: (data: any) => {
      toast.success('Đã tạo hóa đơn thành công!');
      router.push(`/invoices/${data.id}`);
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Không thể tạo hóa đơn'),
  });

  const handleItemChange = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = () => {
    if (!customerName.trim()) { toast.error('Vui lòng nhập tên khách hàng'); return; }
    if (items.some((i) => !i.description.trim())) { toast.error('Vui lòng điền mô tả cho tất cả dòng hàng'); return; }
    createMutation.mutate({
      customer_name: customerName,
      customer_address: customerAddress || undefined,
      customer_tax_code: customerTaxCode || undefined,
      issued_date: issuedDate,
      due_date: dueDate || undefined,
      status: 'draft',
      items: items.map(({ id: _id, ...rest }) => ({
        ...rest,
        total_vnd: rest.quantity * rest.unit_price_vnd,
      })),
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/invoices" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tạo hóa đơn mới</h2>
          <p className="text-sm text-slate-500 mt-0.5">Hóa đơn sẽ được lưu dạng nháp</p>
        </div>
      </div>

      <div className="space-y-6 max-w-4xl">
        {/* Customer Info */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Thông tin khách hàng</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Tên khách hàng <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Tên công ty / cá nhân..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Mã số thuế</label>
              <input
                type="text"
                value={customerTaxCode}
                onChange={(e) => setCustomerTaxCode(e.target.value)}
                placeholder="VD: 0123456789"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Địa chỉ</label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Địa chỉ đầy đủ..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Ngày phát hành</label>
              <input
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Hạn thanh toán</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Dòng hàng hóa</h3>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, newItem()])}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 rounded-md transition-colors"
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
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mô tả hàng hóa</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-32">Mã BQMS</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-20">SL</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-36">Đơn giá (VNĐ)</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 w-36">Thành tiền</th>
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
                        value={item.description}
                        onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                        placeholder="Mô tả hàng hóa / dịch vụ..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={item.bqms_code}
                        onChange={(e) => handleItemChange(item.id, 'bqms_code', e.target.value)}
                        placeholder="BQMS-..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={item.unit_price_vnd}
                        onChange={(e) => handleItemChange(item.id, 'unit_price_vnd', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-sm font-mono text-slate-800">
                        {(item.quantity * item.unit_price_vnd).toLocaleString('vi-VN')}₫
                      </span>
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
          <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-t border-slate-100">
            <span className="text-sm text-slate-500">Tổng {items.length} dòng</span>
            <span className="text-base font-bold font-mono text-brand-700">
              {totalVnd.toLocaleString('vi-VN')}₫
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link href="/invoices" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Hủy</Link>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Tạo hóa đơn (Nháp)
          </button>
        </div>
      </div>
    </div>
  );
}
