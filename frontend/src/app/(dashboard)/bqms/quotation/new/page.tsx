'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Upload,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  Check,
  Download,
  Loader2,
  AlertCircle,
  Search,
  Hash,
} from 'lucide-react';

type Step = 1 | 2 | 3 | 4;
type InputMode = 'rfq_code' | 'excel';

interface ParsedItem {
  id: string;
  don_hang: string;
  bqms: string;
  spec: string;
  loai_hang: string;
  maker: string;
  don_vi: string;
  so_luong: number;
  han_bg: string;
  is_urgent: boolean;
  suggested_price: number | null;
  price_history: Array<{ latest_price: number | null; result: string }>;
}

interface ParseResult {
  data: {
    items: ParsedItem[];
    total: number;
    gc_count: number;
    tm_count: number;
    with_price: number;
    rfq_number?: string;
  };
}

interface GenerateResult {
  data: {
    id: number;
    rfq_no: string;
    status: string;
    files: Array<{ type: string; path: string }>;
    total_items: number;
    filled_items: number;
    errors: string[];
  };
}

const STEP_LABELS = ['Nhập RFQ', 'Xem đơn hàng', 'Kiểm tra giá', 'Xuất file'];

export default function QuotationNewPage() {
  const [step, setStep] = useState<Step>(1);
  const [inputMode, setInputMode] = useState<InputMode>('rfq_code');
  const [rfqCode, setRfqCode] = useState('');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [generateResult, setGenerateResult] = useState<GenerateResult['data'] | null>(null);

  // Lookup by RFQ code
  const lookupMutation = useMutation({
    mutationFn: (code: string) =>
      api.get<ParseResult>(`/api/v1/quotations/lookup?rfq_code=${encodeURIComponent(code)}`),
    onSuccess: (data) => {
      setItems(data.data.items);
      setSelectedItems(new Set(data.data.items.map((i) => i.id)));
      setStep(2);
    },
  });

  // Parse Excel mutation
  const parseMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.upload<ParseResult>('/api/v1/quotations/parse', formData),
    onSuccess: (data) => {
      setItems(data.data.items);
      setSelectedItems(new Set(data.data.items.map((i) => i.id)));
      setStep(2);
    },
  });

  // Generate quotation mutation
  const generateMutation = useMutation({
    mutationFn: (payload: { rfq_no: string; items: ParsedItem[] }) =>
      api.post<GenerateResult>('/api/v1/quotations/generate', {
        rfq_no: payload.rfq_no,
        source_type: inputMode === 'rfq_code' ? 'rfq_code' : 'excel',
        items: payload.items,
      }),
    onSuccess: (data) => {
      setGenerateResult(data.data);
      setStep(4);
    },
  });

  const handleRfqLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rfqCode.trim()) return;
    lookupMutation.mutate(rfqCode.trim());
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    parseMutation.mutate(formData);
  };

  const filteredItems = items.filter((i) => selectedItems.has(i.id));

  const handleGenerate = () => {
    if (!filteredItems.length) return;
    generateMutation.mutate({
      rfq_no: filteredItems[0]?.don_hang || rfqCode || 'RFQ',
      items: filteredItems,
    });
  };

  const toggleItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isLoading = lookupMutation.isPending || parseMutation.isPending;
  const error = lookupMutation.error || parseMutation.error;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tạo Báo Giá Tự Động</h2>
          <p className="text-sm text-slate-500 mt-0.5">Nhập mã RFQ hoặc upload Excel → Auto-fill giá → Xuất file</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step > i + 1
                  ? 'bg-green-100 text-green-700'
                  : step === i + 1
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              <span>{label}</span>
            </div>
            {i < 3 && <ChevronRight className="h-4 w-4 text-slate-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Input RFQ Code or Upload */}
      {step === 1 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
          {/* Mode Tabs */}
          <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 max-w-md mx-auto">
            <button
              onClick={() => setInputMode('rfq_code')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                inputMode === 'rfq_code' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Hash className="h-4 w-4" />Nhập mã RFQ
            </button>
            <button
              onClick={() => setInputMode('excel')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                inputMode === 'excel' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Upload className="h-4 w-4" />Upload Excel
            </button>
          </div>

          {/* RFQ Code Input */}
          {inputMode === 'rfq_code' && (
            <div className="max-w-lg mx-auto text-center">
              <Search className="h-12 w-12 text-brand-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Nhập mã RFQ</h3>
              <p className="text-sm text-slate-500 mb-6">
                Hệ thống sẽ tìm các đơn hàng từ BQMS và tra giá tự động
              </p>
              <form onSubmit={handleRfqLookup} className="flex gap-2 max-w-sm mx-auto">
                <input
                  type="text"
                  value={rfqCode}
                  onChange={(e) => setRfqCode(e.target.value)}
                  placeholder="VD: QT24138430"
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading || !rfqCode.trim()}
                  className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {lookupMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Excel Upload */}
          {inputMode === 'excel' && (
            <div className="max-w-lg mx-auto text-center">
              <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Upload file BC BQMS</h3>
              <p className="text-sm text-slate-500 mb-6">
                Chọn file Excel (.xlsx) chứa danh sách đơn hàng từ Samsung BQMS
              </p>
              <label className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
                <FileSpreadsheet className="h-4 w-4" />
                {parseMutation.isPending ? 'Đang xử lý...' : 'Chọn file Excel'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isLoading}
                />
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 max-w-lg mx-auto p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {(error as any)?.detail || 'Có lỗi xảy ra'}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Review Items */}
      {step === 2 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600">
                {selectedItems.size}/{items.length} đơn đã chọn
              </span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                GC: {items.filter((i) => i.loai_hang === 'GC').length}
              </span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                TM: {items.filter((i) => i.loai_hang === 'TM').length}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">
                <ChevronLeft className="h-4 w-4 inline mr-1" />Quay lại
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg"
              >
                Tiếp tục<ChevronRight className="h-4 w-4 inline ml-1" />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="w-10 px-4 py-3"><input type="checkbox" checked={selectedItems.size === items.length} onChange={() => selectedItems.size === items.length ? setSelectedItems(new Set()) : setSelectedItems(new Set(items.map(i => i.id)))} /></th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đơn hàng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">BQMS</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Spec</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">SL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors ${item.is_urgent ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItem(item.id)} /></td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-700">{item.don_hang}</td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.bqms}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-[250px] truncate">{item.spec}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.maker}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.so_luong}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Price Review */}
      {step === 3 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">
              Có giá: {filteredItems.filter((i) => i.suggested_price).length}/{filteredItems.length}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">
                <ChevronLeft className="h-4 w-4 inline mr-1" />Quay lại
              </button>
              <button
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 inline mr-1 animate-spin" />Đang tạo...</>
                ) : (
                  <>Tạo báo giá<ChevronRight className="h-4 w-4 inline ml-1" /></>
                )}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">BQMS</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Spec</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">SL</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giá gợi ý</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nguồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.bqms}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-[200px] truncate">{item.spec}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.maker}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.so_luong}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {item.suggested_price ? (
                        <span className="text-green-700">{item.suggested_price.toLocaleString('vi-VN')} ₫</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {item.price_history?.length ? `${item.price_history.length} lịch sử` : 'Chưa có'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 4: Download */}
      {step === 4 && generateResult && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
          <div className="max-w-lg mx-auto text-center">
            <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Báo giá đã được tạo!</h3>
            <p className="text-sm text-slate-500 mb-6">
              {generateResult.filled_items}/{generateResult.total_items} items đã có giá
            </p>
            <div className="space-y-3">
              {generateResult.files.map((file, i) => (
                <a
                  key={i}
                  href={`/api/v1/quotations/download/${generateResult.id}/${file.type}`}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {file.type.includes('pdf') ? 'Tải PDF' : 'Tải Excel'} — {file.type.replace(/_/g, ' ').toUpperCase()}
                </a>
              ))}
            </div>
            {generateResult.errors.length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm text-left">
                <p className="font-medium mb-1">Cảnh báo:</p>
                {generateResult.errors.map((err, i) => <p key={i}>• {err}</p>)}
              </div>
            )}
            <button
              onClick={() => { setStep(1); setItems([]); setGenerateResult(null); setRfqCode(''); }}
              className="mt-6 text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              Tạo báo giá mới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
