'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, Search, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────

type PipelineStage =
  | 'rfq'
  | 'quote'
  | 'win'
  | 'po_supplier'
  | 'shipment'
  | 'delivery'
  | 'invoice'
  | 'paid';

interface RevenueChain {
  chain_code: string;
  rfq_number?: string;
  customer_name: string;
  current_stage: PipelineStage;
  completed_stages: PipelineStage[];
  total_revenue_vnd?: number;
  margin_percent?: number;
  created_at: string;
  duration_days?: number;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  total_pages: number;
}

// ─── Pipeline Config ─────────────────────────────────────────────────

const PIPELINE_STAGES: Array<{ key: PipelineStage; label: string; shortLabel: string }> = [
  { key: 'rfq',         label: 'RFQ',          shortLabel: 'RFQ' },
  { key: 'quote',       label: 'Báo giá',      shortLabel: 'BG' },
  { key: 'win',         label: 'Thắng',        shortLabel: 'WIN' },
  { key: 'po_supplier', label: 'PO NCC',       shortLabel: 'PO' },
  { key: 'shipment',   label: 'Vận chuyển',   shortLabel: 'VCC' },
  { key: 'delivery',   label: 'Giao hàng',    shortLabel: 'GH' },
  { key: 'invoice',    label: 'Hóa đơn',      shortLabel: 'HĐ' },
  { key: 'paid',       label: 'Đã thanh toán', shortLabel: 'TT' },
];

const STAGE_ORDER: Record<PipelineStage, number> = {
  rfq: 0, quote: 1, win: 2, po_supplier: 3, shipment: 4, delivery: 5, invoice: 6, paid: 7,
};

// ─── Pipeline Dots ───────────────────────────────────────────────────

function PipelineDots({ currentStage, completedStages }: { currentStage: PipelineStage; completedStages: PipelineStage[] }) {
  const currentIdx = STAGE_ORDER[currentStage] ?? 0;
  const completedSet = new Set(completedStages);

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage, idx) => {
        const isCompleted = completedSet.has(stage.key) || STAGE_ORDER[stage.key] < currentIdx;
        const isCurrent = stage.key === currentStage;
        const isPending = !isCompleted && !isCurrent;

        return (
          <div key={stage.key} className="flex items-center gap-1">
            <div
              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                isCompleted ? 'bg-green-500' :
                isCurrent   ? 'bg-brand-500 ring-2 ring-brand-200' :
                              'bg-slate-200'
              }`}
              title={stage.label}
            />
            {idx < PIPELINE_STAGES.length - 1 && (
              <div className={`h-0.5 w-2 ${isCompleted ? 'bg-green-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage Badge ────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: PipelineStage }) {
  const config = PIPELINE_STAGES.find((s) => s.key === stage);
  const colorMap: Record<PipelineStage, string> = {
    rfq:         'bg-slate-100 text-slate-600',
    quote:       'bg-blue-100 text-blue-700',
    win:         'bg-emerald-100 text-emerald-700',
    po_supplier: 'bg-purple-100 text-purple-700',
    shipment:    'bg-sky-100 text-sky-700',
    delivery:    'bg-amber-100 text-amber-700',
    invoice:     'bg-orange-100 text-orange-700',
    paid:        'bg-green-100 text-green-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[stage]}`}>
      {config?.label ?? stage}
    </span>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-44 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ChainListPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery<PaginatedResponse<RevenueChain>>({
    queryKey: ['chains'],
    queryFn: () => api.get('/api/v1/chains'),
    retry: false,
  });

  // Handle both {items:[]} and {data:{items:[]}} response shapes
  const chainsRaw = data?.items ?? (data as any)?.data?.items ?? (data as any)?.data ?? [];
  const chains = (Array.isArray(chainsRaw) ? chainsRaw : []).filter((c: RevenueChain) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.chain_code.toLowerCase().includes(s) ||
      c.customer_name.toLowerCase().includes(s) ||
      (c.rfq_number ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Chuỗi doanh thu</h2>
          <p className="text-sm text-slate-500 mt-0.5">Theo dõi toàn bộ vòng đời của từng deal kinh doanh</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã chuỗi, khách hàng, RFQ..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Pipeline Stage Legend */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Giai đoạn:</span>
        {PIPELINE_STAGES.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-300" />
            {s.label}
          </span>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error || chains.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Link2 className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">Chưa có chuỗi doanh thu nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã chuỗi</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">RFQ</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Khách hàng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Pipeline</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giai đoạn</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Doanh thu (VNĐ)</th>
                  <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {chains.map((chain) => (
                  <tr
                    key={chain.chain_code}
                    onClick={() => router.push(`/chains/${chain.chain_code}`)}
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono font-medium text-brand-600">{chain.chain_code}</span>
                    </td>
                    <td className="px-4 py-3">
                      {chain.rfq_number ? (
                        <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {chain.rfq_number}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-700">{chain.customer_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <PipelineDots
                        currentStage={chain.current_stage}
                        completedStages={chain.completed_stages}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={chain.current_stage} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {chain.total_revenue_vnd != null ? (
                        <span className="text-sm font-mono text-slate-900">
                          {(chain.total_revenue_vnd ?? 0).toLocaleString('vi-VN')}₫
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {chain.margin_percent != null ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${
                          chain.margin_percent >= 15 ? 'bg-green-100 text-green-700' :
                          chain.margin_percent >= 5  ? 'bg-amber-100 text-amber-700' :
                                                       'bg-red-100 text-red-700'
                        }`}>
                          {chain.margin_percent.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {chain.duration_days != null ? (
                        <span className="text-sm text-slate-500">{chain.duration_days} ngày</span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && ((data.total ?? (data as any)?.data?.total) > 0) && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {chains.length} / {data.total ?? (data as any)?.data?.total ?? 0} chuỗi</span>
          <span>Trang {data.page ?? 1} / {data.total_pages ?? 1}</span>
        </div>
      )}
    </div>
  );
}
