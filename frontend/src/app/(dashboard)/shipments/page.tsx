'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Ship,
  Plane,
  Plus,
  LayoutGrid,
  List,
  Clock,
  Package,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

type ShipmentStatus = 'pending' | 'in_transit' | 'arrived' | 'received';
type ShippingMethod = 'sea' | 'air' | 'road';

interface Shipment {
  id: number;
  shipment_number: string;
  po_number: string;
  supplier_name: string;
  status: ShipmentStatus;
  shipping_method: ShippingMethod;
  item_count: number;
  eta?: string;
  etd?: string;
  created_at: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

// ─── Column Config ──────────────────────────────────────────────────

const COLUMNS: Array<{ key: ShipmentStatus; label: string }> = [
  { key: 'pending',    label: 'Chờ xuất' },
  { key: 'in_transit', label: 'Đang vận chuyển' },
  { key: 'arrived',   label: 'Đã đến cảng' },
  { key: 'received',  label: 'Đã nhận' },
];

const COLUMN_COLORS: Record<ShipmentStatus, string> = {
  pending:    'bg-slate-50 border-slate-200',
  in_transit: 'bg-blue-50 border-blue-200',
  arrived:    'bg-amber-50 border-amber-200',
  received:   'bg-green-50 border-green-200',
};

const COLUMN_HEADER_COLORS: Record<ShipmentStatus, string> = {
  pending:    'text-slate-600 bg-slate-100',
  in_transit: 'text-blue-700 bg-blue-100',
  arrived:    'text-amber-700 bg-amber-100',
  received:   'text-green-700 bg-green-100',
};

// ─── Helpers ────────────────────────────────────────────────────────

function isOverdue(eta?: string): boolean {
  if (!eta) return false;
  return new Date(eta) < new Date();
}

function ShippingIcon({ method }: { method: ShippingMethod }) {
  if (method === 'air') return <Plane className="h-4 w-4 text-sky-500" />;
  return <Ship className="h-4 w-4 text-blue-500" />;
}

// ─── Kanban Card ─────────────────────────────────────────────────────

function ShipmentCard({ shipment, onClick }: { shipment: Shipment; onClick: () => void }) {
  const overdue = isOverdue(shipment.eta) && shipment.status !== 'received';
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border p-3 cursor-pointer hover:shadow-md transition-shadow ${
        overdue ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono font-medium text-brand-600">{shipment.shipment_number}</span>
        <ShippingIcon method={shipment.shipping_method} />
      </div>
      <p className="text-sm font-medium text-slate-800 mb-0.5 truncate">{shipment.po_number}</p>
      <p className="text-xs text-slate-500 mb-2 truncate">{shipment.supplier_name}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-slate-400">
          <Package className="h-3 w-3" />
          {shipment.item_count} mặt hàng
        </span>
        {shipment.eta ? (
          <span className={`flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
            {overdue && <AlertTriangle className="h-3 w-3" />}
            <Clock className="h-3 w-3" />
            ETA {formatDate(shipment.eta)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Kanban View ─────────────────────────────────────────────────────

function KanbanView({ shipments, onCardClick }: { shipments: Shipment[]; onCardClick: (id: number) => void }) {
  const grouped = COLUMNS.reduce<Record<ShipmentStatus, Shipment[]>>(
    (acc, col) => {
      acc[col.key] = shipments.filter((s) => s.status === col.key);
      return acc;
    },
    { pending: [], in_transit: [], arrived: [], received: [] }
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {COLUMNS.map((col) => (
        <div key={col.key} className={`rounded-xl border p-3 ${COLUMN_COLORS[col.status ?? col.key]}`}>
          <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${COLUMN_HEADER_COLORS[col.key]}`}>
            {col.label}
            <span className="bg-white/70 rounded-full px-1.5 py-0.5 font-mono text-xs">
              {grouped[col.key].length}
            </span>
          </div>
          <div className="space-y-2">
            {grouped[col.key].length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Không có lô hàng</p>
            ) : (
              grouped[col.key].map((s) => (
                <ShipmentCard key={s.id} shipment={s} onClick={() => onCardClick(s.id)} />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Table View ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ShipmentStatus, { label: string; className: string }> = {
  pending:    { label: 'Chờ xuất',         className: 'bg-slate-100 text-slate-600' },
  in_transit: { label: 'Đang vận chuyển',  className: 'bg-blue-100 text-blue-700' },
  arrived:    { label: 'Đã đến cảng',      className: 'bg-amber-100 text-amber-700' },
  received:   { label: 'Đã nhận',          className: 'bg-green-100 text-green-700' },
};

function TableView({ shipments, onRowClick }: { shipments: Shipment[]; onRowClick: (id: number) => void }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số lô hàng</th>
              <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã PO</th>
              <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nhà cung cấp</th>
              <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Phương thức</th>
              <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
              <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mặt hàng</th>
              <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shipments.map((s) => {
              const overdue = isOverdue(s.eta) && s.status !== 'received';
              const sc = STATUS_CONFIG[s.status];
              return (
                <tr
                  key={s.id}
                  onClick={() => onRowClick(s.id)}
                  className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${overdue ? 'bg-red-50/30' : ''}`}
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono font-medium text-brand-600">{s.shipment_number}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-700">{s.po_number}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-600">{s.supplier_name}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ShippingIcon method={s.shipping_method} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>{sc.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-mono text-slate-700">{s.item_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    {s.eta ? (
                      <span className={`text-sm flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                        {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                        {formatDate(s.eta)}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ShipmentsPage() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');

  const { data, isLoading } = useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['shipments'],
    queryFn: () => api.get('/api/v1/shipments'),
    retry: false,
  });

  // Handle both {items:[]} and {data:{items:[]}} response shapes
  const shipmentsRaw = data?.items ?? (data as any)?.data?.items ?? (data as any)?.data ?? [];
  const shipments = Array.isArray(shipmentsRaw) ? shipmentsRaw : [];

  const handleCardClick = (id: number) => router.push(`/shipments/${id}`);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Vận chuyển</h2>
          <p className="text-sm text-slate-500 mt-0.5">Theo dõi tình trạng các lô hàng</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                viewMode === 'kanban' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                viewMode === 'table' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Danh sách
            </button>
          </div>
          <Link
            href="/shipments/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo lô hàng
          </Link>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        </div>
      ) : shipments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Ship className="h-12 w-12 mb-3" />
          <p className="text-sm text-slate-400 font-medium">Chưa có lô hàng nào</p>
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanView shipments={shipments} onCardClick={handleCardClick} />
      ) : (
        <TableView shipments={shipments} onRowClick={handleCardClick} />
      )}

      {data && (data.total ?? (data as any)?.data?.total ?? 0) > 0 && (
        <p className="mt-4 text-sm text-slate-400 text-right">Tổng: {data.total ?? (data as any)?.data?.total} lô hàng</p>
      )}
    </div>
  );
}
