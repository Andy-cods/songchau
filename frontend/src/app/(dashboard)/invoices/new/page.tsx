'use client';

// Trang "Tạo hóa đơn" — segment tĩnh /invoices/new (ưu tiên hơn [id] nên KHÔNG
// đụng /invoices/{số}). Trước đây nút "Tạo hóa đơn" trỏ /invoices/new nhưng KHÔNG
// có trang → match [id] với id="new" → GET /invoices/new (int) → 422 → dead-end.
// BE KHÔNG hỗ trợ tạo hóa đơn trắng thủ công — chỉ sinh TỪ đơn bán đã giao:
// POST /api/v1/invoices/auto-generate (require_role manager/admin).

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export default function NewInvoicePage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role === 'manager' || user?.role === 'admin';

  const [soId, setSoId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('NET30');
  const [bankAccount, setBankAccount] = useState('');
  const [notes, setNotes] = useState('');

  // Chỉ manager/admin (khớp require_role BE) — role khác đá về danh sách.
  useEffect(() => {
    if (user && !canManage) router.replace('/finance/invoices');
  }, [user, canManage, router]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: number; invoice_number: string }; message: string }>(
        '/api/v1/invoices/auto-generate',
        {
          sales_order_id: Number(soId),
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,
          payment_terms: paymentTerms,
          bank_account: bankAccount || null,
          notes: notes || null,
        },
      ),
    onSuccess: (res) => {
      toast.success(res?.message ?? 'Đã tạo hóa đơn');
      const newId = res?.data?.id;
      router.push(newId ? `/invoices/${newId}` : '/finance/invoices');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi tạo hóa đơn'),
  });

  const inputCls =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="max-w-xl">
      <div className="flex items-start gap-3 mb-6">
        <Link
          href="/finance/invoices"
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 mt-0.5"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tạo hóa đơn</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Sinh hóa đơn từ một đơn bán hàng đã giao (delivered / approved / completed).
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Mã đơn bán hàng (ID) <span className="text-rose-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            value={soId}
            onChange={(e) => setSoId(e.target.value)}
            placeholder="VD: 1024"
            className={inputCls + ' font-mono'}
          />
          <p className="text-xs text-slate-400 mt-1">
            Đơn phải ở trạng thái đã giao và chưa có hóa đơn.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Ngày hóa đơn</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Hạn thanh toán</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Điều khoản thanh toán</label>
            <input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="NET30" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Tài khoản ngân hàng</label>
            <input type="text" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Ghi chú</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push('/finance/invoices')}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!soId || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Tạo hóa đơn
          </button>
        </div>
      </div>
    </div>
  );
}
