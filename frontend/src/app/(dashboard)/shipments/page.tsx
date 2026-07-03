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
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { StatusVariant } from '@/lib/constants';

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

// Trạng thái lô hàng → token status (info=sky / warning=amber / success=emerald / neutral=slate)
const STATUS_VARIANT: Record<ShipmentStatus, StatusVariant> = {
  pending:    'neutral',
  in_transit: 'info',
  arrived:    'warning',
  received:   'success',
};

// Kanban: cột nền slate trung tính (xem markup); chỉ chip tiêu đề mang status.
const COLUMN_HEADER_COLORS: Record<ShipmentStatus, string> = {
  pending:    'text-slate-600 bg-slate-100',
  in_transit: 'text-sky-700 bg-sky-100',
  arrived:    'text-amber-700 bg-amber-100',
  received:   'text-emerald-700 bg-emerald-100',
};

// ─── Helpers ────────────────────────────────────────────────────────

function isOverdue(eta?: string): boolean {
  if (!eta) return false;
  return new Date(eta) < new Date();
}

function ShippingIcon({ method }: { method: ShippingMethod }) {
  if (method === 'air') return <Plane className="h-4 w-4 text-slate-400" />;
  return <Ship className="h-4 w-4 text-slate-400" />;
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
        <div key={col.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending:    'Chờ xuất',
  in_transit: 'Đang vận chuyển',
  arrived:    'Đã đến cảng',
  received:   'Đã nhận',
};

function TableView({ shipments, onRowClick }: { shipments: Shipment[]; onRowClick: (id: number) => void }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Số lô hàng</TableHead>
            <TableHead>Mã PO</TableHead>
            <TableHead>Nhà cung cấp</TableHead>
            <TableHead className="text-center">Phương thức</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead className="text-center">Mặt hàng</TableHead>
            <TableHead>ETA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shipments.map((s) => {
            const overdue = isOverdue(s.eta) && s.status !== 'received';
            return (
              <TableRow
                key={s.id}
                onClick={() => onRowClick(s.id)}
                className={`cursor-pointer ${overdue ? 'bg-red-50/30' : ''}`}
              >
                <TableCell>
                  <span className="text-sm font-mono font-medium text-brand-600">{s.shipment_number}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-slate-700">{s.po_number}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-slate-600">{s.supplier_name}</span>
                </TableCell>
                <TableCell className="text-center">
                  <ShippingIcon method={s.shipping_method} />
                </TableCell>
                <TableCell>
                  <StatusBadge variant={STATUS_VARIANT[s.status]} label={STATUS_LABEL[s.status]} />
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm font-mono text-slate-700">{s.item_count}</span>
                </TableCell>
                <TableCell>
                  {s.eta ? (
                    <span className={`text-sm flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                      {formatDate(s.eta)}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-300">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
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
      <PageHeader
        icon={Ship}
        title="Vận chuyển"
        subtitle="Theo dõi tình trạng các lô hàng"
        className="mb-6"
        actions={
          <>
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
          </>
        }
      />

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : shipments.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Ship} heading="Chưa có lô hàng nào" />
        </Card>
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
