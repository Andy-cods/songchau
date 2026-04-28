'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  Loader2,
  ExternalLink,
  FileText,
  ShoppingCart,
  Ship,
  Receipt,
  CheckCircle2,
  Circle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

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

interface StageEntity {
  id?: number | string;
  code?: string;
  number?: string;
  status?: string;
  date?: string;
  amount_vnd?: number;
  amount_cny?: number;
  supplier_name?: string;
  customer_name?: string;
  note?: string;
}

interface ChainStage {
  stage: PipelineStage;
  completed: boolean;
  entity?: StageEntity;
}

interface MarginBreakdown {
  revenue_vnd: number;
  cost_of_goods_vnd: number;
  freight_vnd: number;
  customs_vnd: number;
  other_costs_vnd: number;
  profit_vnd: number;
  profit_percent: number;
}

interface ChainDetail {
  chain_code: string;
  rfq_number?: string;
  customer_name: string;
  current_stage: PipelineStage;
  stages: ChainStage[];
  margin_breakdown?: MarginBreakdown;
  created_at: string;
}

// ─── Pipeline Config ─────────────────────────────────────────────────

const STAGE_CONFIG: Record<
  PipelineStage,
  { label: string; icon: React.ElementType; href?: (entity: StageEntity) => string }
> = {
  rfq:         { label: 'RFQ',          icon: FileText,     href: (e) => `/bqms/rfq` },
  quote:       { label: 'Báo giá',      icon: FileText,     href: (e) => e.id ? `/bqms/quotation/${e.id}` : '/bqms/quotation' },
  win:         { label: 'Thắng thầu',   icon: CheckCircle2, href: undefined },
  po_supplier: { label: 'PO NCC',       icon: ShoppingCart, href: (e) => e.id ? `/purchase-orders/${e.id}` : '/purchase-orders' },
  shipment:    { label: 'Vận chuyển',   icon: Ship,         href: (e) => e.id ? `/shipments/${e.id}` : '/shipments' },
  delivery:    { label: 'Giao hàng',    icon: Ship,         href: (e) => e.id ? `/deliveries/${e.id}` : '/deliveries' },
  invoice:     { label: 'Hóa đơn',      icon: Receipt,      href: (e) => e.id ? `/invoices/${e.id}` : '/invoices' },
  paid:        { label: 'Đã thanh toán', icon: CheckCircle2, href: undefined },
};

const STAGE_ORDER: PipelineStage[] = [
  'rfq', 'quote', 'win', 'po_supplier', 'shipment', 'delivery', 'invoice', 'paid',
];

// ─── Stage Card ──────────────────────────────────────────────────────

function StageCard({ stageData, isCurrent }: { stageData: ChainStage; isCurrent: boolean }) {
  const config = STAGE_CONFIG[stageData.stage];
  const Icon = config.icon;
  const entity = stageData.entity;
  const href = entity && config.href ? config.href(entity) : undefined;

  const cardBg =
    stageData.completed ? 'border-green-200 bg-green-50' :
    isCurrent            ? 'border-brand-200 bg-brand-50' :
                           'border-slate-200 bg-slate-50';

  const iconBg =
    stageData.completed ? 'bg-green-100 text-green-600' :
    isCurrent            ? 'bg-brand-100 text-brand-600' :
                           'bg-slate-100 text-slate-400';

  return (
    <div className={`rounded-lg border p-4 min-w-[160px] flex flex-col gap-2 ${cardBg}`}>
      <div className="flex items-center justify-between">
        <div className={`p-1.5 rounded-md ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
        {stageData.completed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : isCurrent ? (
          <div className="h-3 w-3 rounded-full bg-brand-500 animate-pulse" />
        ) : (
          <Circle className="h-4 w-4 text-slate-300" />
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700">{config.label}</p>
        {entity ? (
          <>
            {entity.number && (
              <p className="text-xs font-mono text-brand-600 mt-0.5">{entity.number}</p>
            )}
            {entity.status && (
              <p className="text-xs text-slate-500 mt-0.5">{entity.status}</p>
            )}
            {entity.date && (
              <p className="text-xs text-slate-400 mt-0.5">{formatDate(entity.date)}</p>
            )}
            {entity.amount_vnd != null && (
              <p className="text-xs font-mono text-slate-700 mt-1">
                {(entity.amount_vnd ?? 0).toLocaleString('vi-VN')}₫
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-400 mt-0.5">Chưa có dữ liệu</p>
        )}
      </div>

      {href && entity && (
        <Link
          href={href}
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 mt-auto"
          onClick={(e) => e.stopPropagation()}
        >
          Xem chi tiết
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────

function ChainTimeline({ stages, currentStage }: { stages: ChainStage[]; currentStage: PipelineStage }) {
  // Build a map for quick access
  const stageMap = new Map(stages.map((s) => [s.stage, s]));

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-start gap-0 min-w-max">
        {STAGE_ORDER.map((stageKey, idx) => {
          const stageData = stageMap.get(stageKey) ?? { stage: stageKey, completed: false };
          const isCurrent = stageKey === currentStage;

          return (
            <div key={stageKey} className="flex items-center">
              <StageCard stageData={stageData} isCurrent={isCurrent} />
              {idx < STAGE_ORDER.length - 1 && (
                <div className={`h-0.5 w-8 mx-1 mt-0 ${stageData.completed ? 'bg-green-300' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Margin Breakdown ────────────────────────────────────────────────

function MarginBreakdownCard({ breakdown }: { breakdown: MarginBreakdown }) {
  const rows: Array<{ label: string; value: number; isDeduction?: boolean; isBold?: boolean }> = [
    { label: 'Doanh thu',         value: breakdown.revenue_vnd },
    { label: 'Giá vốn hàng',     value: breakdown.cost_of_goods_vnd, isDeduction: true },
    { label: 'Chi phí vận chuyển', value: breakdown.freight_vnd, isDeduction: true },
    { label: 'Thuế hải quan',    value: breakdown.customs_vnd, isDeduction: true },
    { label: 'Chi phí khác',     value: breakdown.other_costs_vnd, isDeduction: true },
    { label: 'Lợi nhuận',        value: breakdown.profit_vnd, isBold: true },
  ];

  const isPositive = breakdown.profit_vnd >= 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-6">
        {isPositive ? (
          <TrendingUp className="h-5 w-5 text-green-500" />
        ) : (
          <TrendingDown className="h-5 w-5 text-red-500" />
        )}
        <h3 className="text-sm font-semibold text-slate-700">Phân tích biên lợi nhuận</h3>
        <span className={`ml-auto text-lg font-bold font-mono ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {Number(breakdown.profit_percent ?? 0).toFixed(1)}%
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx}>
            {idx === rows.length - 1 && <div className="border-t border-slate-200 my-3" />}
            <div className="flex items-center justify-between">
              <span className={`text-sm ${row.isBold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                {row.isDeduction && <span className="text-red-400 mr-1">−</span>}
                {row.label}
              </span>
              <span className={`text-sm font-mono ${
                row.isBold
                  ? isPositive ? 'font-bold text-green-600' : 'font-bold text-red-600'
                  : row.isDeduction ? 'text-red-500' : 'text-slate-800'
              }`}>
                {row.isDeduction ? '-' : ''}{(row.value ?? 0).toLocaleString('vi-VN')}₫
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Visual bar */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
          <span>Tỷ lệ chi phí / doanh thu</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
          {breakdown.revenue_vnd > 0 && (
            <>
              <div
                className="bg-red-400 h-full"
                style={{ width: `${(breakdown.cost_of_goods_vnd / breakdown.revenue_vnd) * 100}%` }}
                title="Giá vốn"
              />
              <div
                className="bg-amber-400 h-full"
                style={{ width: `${(breakdown.freight_vnd / breakdown.revenue_vnd) * 100}%` }}
                title="Vận chuyển"
              />
              <div
                className="bg-orange-400 h-full"
                style={{ width: `${(breakdown.customs_vnd / breakdown.revenue_vnd) * 100}%` }}
                title="Hải quan"
              />
              <div
                className="bg-slate-300 h-full"
                style={{ width: `${(breakdown.other_costs_vnd / breakdown.revenue_vnd) * 100}%` }}
                title="Khác"
              />
              <div className="bg-green-400 h-full flex-1" title="Lợi nhuận" />
            </>
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          {[
            { label: 'Giá vốn', color: 'bg-red-400' },
            { label: 'Vận chuyển', color: 'bg-amber-400' },
            { label: 'Hải quan', color: 'bg-orange-400' },
            { label: 'Khác', color: 'bg-slate-300' },
            { label: 'Lợi nhuận', color: 'bg-green-400' },
          ].map((item) => (
            <span key={item.label} className="flex items-center gap-1 text-xs text-slate-500">
              <span className={`h-2 w-2 rounded-full ${item.color}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ChainDetailPage() {
  const { code } = useParams<{ code: string }>();

  const { data: chain, isLoading, error } = useQuery<ChainDetail>({
    queryKey: ['chain', code],
    queryFn: () => api.get(`/api/v1/chains/${code}`),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (error || !chain) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-sm">Không tìm thấy chuỗi doanh thu hoặc có lỗi xảy ra.</p>
        <Link href="/chains" className="text-sm text-brand-600 mt-2 hover:underline">Quay lại danh sách</Link>
      </div>
    );
  }

  const currentStageLabel = STAGE_CONFIG[chain.current_stage]?.label ?? chain.current_stage;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/chains" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 mt-0.5">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-display font-bold text-slate-900">{chain.chain_code}</h2>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-700">
              {currentStageLabel}
            </span>
            {chain.rfq_number && (
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                RFQ: {chain.rfq_number}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {chain.customer_name} · Tạo ngày {formatDate(chain.created_at)}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-6">Tiến trình chuỗi</h3>
        <ChainTimeline stages={chain.stages} currentStage={chain.current_stage} />
      </div>

      {/* Margin Breakdown */}
      {chain.margin_breakdown && (
        <MarginBreakdownCard breakdown={chain.margin_breakdown} />
      )}

      {!chain.margin_breakdown && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">Chưa có dữ liệu phân tích lợi nhuận</p>
          <p className="text-xs text-slate-300 mt-1">Dữ liệu sẽ được cập nhật khi hoàn tất hóa đơn và thanh toán</p>
        </div>
      )}
    </div>
  );
}
