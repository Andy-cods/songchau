'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';

interface RfqItem {
  id: number;
  item_no: number;
  specification: string;
  bqms_code?: string;
  quantity: number;
  unit: string;
  required_material?: string;
  notes?: string;
}

interface QuoteItemInput {
  item_id: number;
  unit_price: string;
  quantity: string;
  lead_time_days: string;
  notes: string;
}

export default function RfqDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = Number(params.id);

  const [batch, setBatch] = useState<any>(null);
  const [items, setItems] = useState<RfqItem[]>([]);
  const [myQuote, setMyQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [currency, setCurrency] = useState('USD');
  const [leadTime, setLeadTime] = useState('');
  const [moqNotes, setMoqNotes] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [quoteItems, setQuoteItems] = useState<QuoteItemInput[]>([]);

  useEffect(() => {
    if (!batchId) return;
    api.get<any>(`/api/vendor/batches/${batchId}`)
      .then(res => {
        const d = res.data;
        setBatch(d);
        setItems(d.items || []);
        setMyQuote(d.my_quote);

        // Init quote items
        if (d.my_quote) {
          setCurrency(d.my_quote.currency || 'USD');
          const existingItems = (d.my_quote.items || []).reduce((m: any, qi: any) => {
            m[qi.item_id] = qi;
            return m;
          }, {} as Record<number, any>);

          setQuoteItems((d.items || []).map((item: RfqItem) => {
            const eq = existingItems[item.id];
            return {
              item_id: item.id,
              unit_price: eq ? String(eq.unit_price) : '',
              quantity: eq ? String(eq.quantity || item.quantity) : String(item.quantity),
              lead_time_days: eq ? String(eq.lead_time_days || '') : '',
              notes: eq?.notes || '',
            };
          }));
        } else {
          setQuoteItems((d.items || []).map((item: RfqItem) => ({
            item_id: item.id,
            unit_price: '',
            quantity: String(item.quantity),
            lead_time_days: '',
            notes: '',
          })));
        }
      })
      .catch(() => setError('Không tải được dữ liệu'))
      .finally(() => setLoading(false));
  }, [batchId]);

  const updateItem = (idx: number, field: keyof QuoteItemInput, value: string) => {
    setQuoteItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const totalAmount = quoteItems.reduce((sum, qi) => {
    const price = parseFloat(qi.unit_price) || 0;
    const qty = parseFloat(qi.quantity) || 0;
    return sum + price * qty;
  }, 0);

  const handleSubmit = async () => {
    const filledItems = quoteItems.filter(qi => qi.unit_price && parseFloat(qi.unit_price) > 0);
    if (filledItems.length === 0) {
      setError('Vui lòng nhập giá cho ít nhất 1 item');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/vendor/quotes/submit', {
        batch_id: batchId,
        currency,
        lead_time_days: leadTime ? parseInt(leadTime) : null,
        moq_notes: moqNotes || null,
        notes: generalNotes || null,
        items: filledItems.map(qi => ({
          item_id: qi.item_id,
          unit_price: parseFloat(qi.unit_price),
          quantity: parseFloat(qi.quantity) || null,
          lead_time_days: qi.lead_time_days ? parseInt(qi.lead_time_days) : null,
          notes: qi.notes || null,
        })),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.detail ?? 'Gửi báo giá thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-slate-400">Đang tải...</p></div>;

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Báo giá đã gửi!</h2>
          <p className="text-sm text-slate-600 mb-1">Đợt: {batch?.batch_code} — {batch?.title}</p>
          <p className="text-sm text-slate-500 mb-4">Tổng: {totalAmount.toLocaleString()} {currency}</p>
          <Link href="/dashboard" className="text-brand-600 font-medium hover:underline">← Về trang chủ</Link>
        </div>
      </div>
    );
  }

  const alreadySubmitted = myQuote?.status === 'submitted';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-brand-600">← Quay lại</Link>
          <h1 className="text-lg font-bold text-brand-700">Song Châu</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Batch info */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded">{batch?.batch_code}</span>
            <h2 className="text-xl font-bold text-slate-800">{batch?.title}</h2>
          </div>
          {batch?.description && <p className="text-sm text-slate-500">{batch.description}</p>}
          <p className="text-xs text-slate-400 mt-2">{items.length} items · Chế độ: {batch?.award_mode === 'per_item' ? 'Chọn theo item' : 'Chọn theo đợt'}</p>
        </div>

        {alreadySubmitted && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-emerald-700 font-medium">✓ Bạn đã gửi báo giá cho đợt này. Không thể sửa sau khi gửi.</p>
          </div>
        )}

        {/* Quote form */}
        {!alreadySubmitted && (
          <>
            <div className="bg-white rounded-lg border border-slate-200 p-5 mb-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Thông tin chung</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Tiền tệ</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="USD">USD ($)</option>
                    <option value="RMB">RMB (¥)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Thời gian giao (ngày)</label>
                  <input type="number" value={leadTime} onChange={e => setLeadTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="14" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Điều kiện MOQ</label>
                  <input type="text" value={moqNotes} onChange={e => setMoqNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="MOQ 100 pcs" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Ghi chú</label>
                  <input type="text" value={generalNotes} onChange={e => setGeneralNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 text-xs font-mono text-slate-400 uppercase w-10">#</th>
                    <th className="text-left px-4 py-3 text-xs font-mono text-slate-400 uppercase">Spec / BQMS Code</th>
                    <th className="text-right px-4 py-3 text-xs font-mono text-slate-400 uppercase w-20">SL</th>
                    <th className="text-right px-4 py-3 text-xs font-mono text-slate-400 uppercase w-28">Đơn giá ({currency})</th>
                    <th className="text-right px-4 py-3 text-xs font-mono text-slate-400 uppercase w-28">Thành tiền</th>
                    <th className="text-center px-4 py-3 text-xs font-mono text-slate-400 uppercase w-20">Giao (ngày)</th>
                    <th className="text-left px-4 py-3 text-xs font-mono text-slate-400 uppercase w-32">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => {
                    const qi = quoteItems[idx];
                    if (!qi) return null;
                    const lineTotal = (parseFloat(qi.unit_price) || 0) * (parseFloat(qi.quantity) || 0);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs text-slate-400 font-mono">{item.item_no}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-700">{item.specification}</p>
                          {item.bqms_code && <p className="text-xs text-slate-400 font-mono">{item.bqms_code}</p>}
                          {item.required_material && <p className="text-xs text-blue-500">Vật liệu: {item.required_material}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" value={qi.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" step="0.01" value={qi.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                            placeholder="0.00"
                            className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-slate-700">
                          {lineTotal > 0 ? lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" value={qi.lead_time_days} onChange={e => updateItem(idx, 'lead_time_days', e.target.value)}
                            className="w-16 mx-auto block px-2 py-1 border border-slate-200 rounded text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="text" value={qi.notes} onChange={e => updateItem(idx, 'notes', e.target.value)}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Tổng cộng:</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-brand-700 font-mono">
                      {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {currency}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</div>}

            <div className="flex items-center justify-between">
              <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">← Hủy</Link>
              <button onClick={handleSubmit} disabled={submitting}
                className="px-6 py-2.5 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
                {submitting ? 'Đang gửi...' : 'Gửi báo giá'}
              </button>
            </div>
          </>
        )}

        {/* Show existing quote if submitted */}
        {alreadySubmitted && myQuote && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Báo giá đã gửi ({myQuote.currency})</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 text-xs text-slate-400">Item</th>
                  <th className="text-right py-2 text-xs text-slate-400">Đơn giá</th>
                  <th className="text-right py-2 text-xs text-slate-400">SL</th>
                </tr>
              </thead>
              <tbody>
                {(myQuote.items || []).map((qi: any) => {
                  const item = items.find(i => i.id === qi.item_id);
                  return (
                    <tr key={qi.item_id} className="border-b border-slate-50">
                      <td className="py-2 text-slate-700">{item?.specification || `Item #${qi.item_id}`}</td>
                      <td className="py-2 text-right font-mono">{qi.unit_price}</td>
                      <td className="py-2 text-right font-mono">{qi.quantity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-right font-bold text-brand-700 mt-2">Tổng: {myQuote.total_amount?.toLocaleString()} {myQuote.currency}</p>
          </div>
        )}
      </main>
    </div>
  );
}
