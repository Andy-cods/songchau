'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Brain,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';

interface ClassifyItem {
  bqms_code: string;
  specification?: string;
  maker?: string;
}

interface ClassifyResult {
  bqms_code: string;
  classification: 'chot' | 'xem' | 'bo';
  confidence: number;
  reasoning: string;
  source?: string;
}

interface BatchResponse {
  data: {
    batch_id: string;
    results: ClassifyResult[];
    summary: { chot: number; xem: number; bo: number; total: number };
    rule_based: number;
    ai_classified: number;
  };
  message: string;
}

const CLASS_CONFIG = {
  chot: { label: 'CHỐT', icon: CheckCircle, cls: 'bg-green-100 text-green-700 border-green-200', barCls: 'bg-green-500' },
  xem: { label: 'XEM XÉT', icon: AlertCircle, cls: 'bg-amber-100 text-amber-700 border-amber-200', barCls: 'bg-amber-500' },
  bo: { label: 'BỎ QUA', icon: XCircle, cls: 'bg-red-100 text-red-700 border-red-200', barCls: 'bg-red-500' },
};

export default function ClassifyPage() {
  const [items, setItems] = useState<ClassifyItem[]>([]);
  const [results, setResults] = useState<ClassifyResult[]>([]);
  const [summary, setSummary] = useState<BatchResponse['data']['summary'] | null>(null);

  // Parse uploaded file to get items
  const parseMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.upload<{ data: { items: any[] } }>('/api/v1/quotations/parse', formData),
    onSuccess: (data) => {
      const parsed = data.data.items.map((i: any) => ({
        bqms_code: i.bqms,
        specification: i.spec,
        maker: i.maker,
      }));
      setItems(parsed);
      setResults([]);
      setSummary(null);
    },
  });

  // Classify items
  const classifyMutation = useMutation({
    mutationFn: (payload: { items: ClassifyItem[] }) =>
      api.post<BatchResponse>('/api/v1/smart-classify/batch', payload),
    onSuccess: (data) => {
      setResults(data.data.results);
      setSummary(data.data.summary);
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    parseMutation.mutate(formData);
  };

  const handleClassify = () => {
    if (items.length === 0) return;
    classifyMutation.mutate({ items });
  };

  const chotItems = results.filter((r) => r.classification === 'chot');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <Brain className="h-5 w-5 inline mr-2 text-purple-600" />
            Lọc Đơn Thông Minh (AI)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            AI phân loại RFQ: CHỐT ✅ / XEM XÉT 🟡 / BỎ QUA ❌
          </p>
        </div>
      </div>

      {/* Upload Section */}
      {items.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
          <div className="max-w-lg mx-auto text-center">
            <Brain className="h-12 w-12 text-purple-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Upload BC BQMS để phân loại</h3>
            <p className="text-sm text-slate-500 mb-6">
              AI sẽ phân tích lịch sử win/loss và đề xuất nên báo giá hay bỏ qua
            </p>
            <label className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
              <FileSpreadsheet className="h-4 w-4" />
              {parseMutation.isPending ? 'Đang xử lý...' : 'Chọn file Excel'}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} disabled={parseMutation.isPending} />
            </label>
          </div>
        </div>
      )}

      {/* Items loaded, not yet classified */}
      {items.length > 0 && results.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-600">{items.length} items đã tải</span>
            <div className="flex gap-2">
              <button
                onClick={() => { setItems([]); setResults([]); }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                <RotateCcw className="h-4 w-4 inline mr-1" />Chọn file khác
              </button>
              <button
                onClick={handleClassify}
                disabled={classifyMutation.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {classifyMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 inline animate-spin mr-1" />AI đang phân loại...</>
                ) : (
                  <><Brain className="h-4 w-4 inline mr-1" />Phân loại bằng AI</>
                )}
              </button>
            </div>
          </div>
          <div className="text-sm text-slate-500">
            Nhấn &quot;Phân loại bằng AI&quot; để Gemini AI phân tích {items.length} items
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && summary && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Tổng</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{summary.total}</p>
            </div>
            <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4">
              <p className="text-xs text-green-600 uppercase tracking-wider">CHỐT ✅</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{summary.chot}</p>
            </div>
            <div className="bg-amber-50 rounded-lg shadow-sm border border-amber-200 p-4">
              <p className="text-xs text-amber-600 uppercase tracking-wider">XEM XÉT 🟡</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{summary.xem}</p>
            </div>
            <div className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-4">
              <p className="text-xs text-red-600 uppercase tracking-wider">BỎ QUA ❌</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{summary.bo}</p>
            </div>
          </div>

          {/* Action: Send CHỐT to auto-fill */}
          {chotItems.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center justify-between">
              <span className="text-sm text-green-700">
                <CheckCircle className="h-4 w-4 inline mr-1" />
                {chotItems.length} items CHỐT sẵn sàng báo giá
              </span>
              <Link
                href="/bqms/quotation/new"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
              >
                Chuyển sang Auto-Fill <ArrowRight className="h-4 w-4 inline ml-1" />
              </Link>
            </div>
          )}

          {/* Results Table */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">BQMS</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Phân loại</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tin cậy</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Lý do</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nguồn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r, i) => {
                    const cfg = CLASS_CONFIG[r.classification];
                    const Icon = cfg.icon;
                    return (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 text-sm font-mono text-slate-600">{r.bqms_code}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-semibold ${cfg.cls}`}>
                            <Icon className="h-3.5 w-3.5" />{cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${cfg.barCls}`} style={{ width: `${(r.confidence || 0) * 100}%` }} />
                            </div>
                            <span className="text-xs text-slate-500">{((r.confidence || 0) * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 max-w-[300px]">{r.reasoning}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${r.source === 'rules' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                            {r.source === 'rules' ? 'Quy tắc' : 'AI'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
