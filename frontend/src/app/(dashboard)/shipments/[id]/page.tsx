'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, CheckCircle2, Circle, Ship, Plane, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
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

// ─── Types ──────────────────────────────────────────────────────────

type ShipmentStatus = 'pending' | 'departed' | 'in_transit' | 'arrived' | 'received';

interface ShipmentItem {
  id: number;
  bqms_code: string;
  product_name: string;
  quantity_shipped: number;
  quantity_received: number;
  unit: string;
}

interface Shipment {
  id: number;
  shipment_number: string;
  status: ShipmentStatus;
  shipping_method: 'sea' | 'air' | 'road';
  carrier?: string;
  tracking_number?: string;
  etd?: string;
  atd?: string;
  eta?: string;
  ata?: string;
  po_number?: string;
  po_id?: number;
  customs_declaration?: string;
  supplier_name: string;
  items: ShipmentItem[];
  created_at: string;
}

// ─── Status Stepper Config ──────────────────────────────────────────

const STEPS: Array<{ key: ShipmentStatus; label: string }> = [
  { key: 'pending',    label: 'Chờ xuất' },
  { key: 'departed',  label: 'Xuất phát' },
  { key: 'in_transit', label: 'Vận chuyển' },
  { key: 'arrived',   label: 'Đến cảng' },
  { key: 'received',  label: 'Nhận hàng' },
];

const STATUS_ORDER: Record<ShipmentStatus, number> = {
  pending:    0,
  departed:   1,
  in_transit: 2,
  arrived:    3,
  received:   4,
};

// ─── Stepper Component ──────────────────────────────────────────────

function StatusStepper({ currentStatus }: { currentStatus: ShipmentStatus }) {
  const currentIdx = STATUS_ORDER[currentStatus] ?? 0;

  return (
    <div className="flex items-center justify-between w-full">
      {STEPS.map((step, idx) => {
        const stepIdx = STATUS_ORDER[step.key];
        const isDone = stepIdx < currentIdx;
        const isCurrent = stepIdx === currentIdx;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              {isDone ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              ) : isCurrent ? (
                <div className="h-7 w-7 rounded-full bg-brand-600 border-2 border-brand-400 flex items-center justify-center">
                  <div className="h-2.5 w-2.5 rounded-full bg-white" />
                </div>
              ) : (
                <Circle className="h-7 w-7 text-slate-300" />
              )}
              <span className={`text-xs font-medium text-center ${
                isDone ? 'text-emerald-600' : isCurrent ? 'text-brand-700' : 'text-slate-400'
              }`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-4 ${stepIdx < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Info Card ───────────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value || '—'}</p>
    </div>
  );
}

// ─── Action Buttons Based on Status ────────────────────────────────

function ActionButtons({
  status,
  id,
  onAction,
  isPending,
}: {
  status: ShipmentStatus;
  id: string;
  onAction: (next: ShipmentStatus) => void;
  isPending: boolean;
}) {
  const actions: Partial<Record<ShipmentStatus, { label: string; next: ShipmentStatus; color: string }>> = {
    pending:    { label: 'Cập nhật xuất phát',    next: 'departed',   color: 'bg-brand-600 hover:bg-brand-700' },
    departed:   { label: 'Đang vận chuyển',        next: 'in_transit', color: 'bg-brand-600 hover:bg-brand-700' },
    in_transit: { label: 'Đã đến cảng',            next: 'arrived',   color: 'bg-brand-600 hover:bg-brand-700' },
    arrived:    { label: 'Xác nhận nhận hàng',     next: 'received',  color: 'bg-brand-600 hover:bg-brand-700' },
  };

  const action = actions[status];
  if (!action) return null;

  return (
    <button
      onClick={() => onAction(action.next)}
      disabled={isPending}
      className={`flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 ${action.color}`}
    >
      {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
      {action.label}
    </button>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: shipment, isLoading, error } = useQuery<Shipment>({
    queryKey: ['shipment', id],
    queryFn: () => api.get(`/api/v1/shipments/${id}`),
    retry: false,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: ShipmentStatus) =>
      api.post(`/api/v1/shipments/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment', id] });
      toast.success('Đã cập nhật trạng thái lô hàng');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi cập nhật trạng thái'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="flex flex-col items-center justify-center">
        <EmptyState
          variant="error"
          heading="Không tìm thấy lô hàng hoặc có lỗi xảy ra."
        />
        <Link href="/shipments" className="-mt-8 text-sm text-brand-600 hover:underline">Quay lại danh sách</Link>
      </div>
    );
  }

  const ShippingMethodIcon = shipment.shipping_method === 'air' ? Plane : Ship;
  const shippingLabel = shipment.shipping_method === 'air' ? 'Hàng không' :
    shipment.shipping_method === 'sea' ? 'Đường biển' : 'Đường bộ';

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/shipments" className="mt-1 p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <PageHeader
          className="flex-1"
          title={
            <span className="flex items-center gap-3 flex-wrap">
              {shipment.shipment_number}
              <span className="flex items-center gap-1 text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                <ShippingMethodIcon className="h-3.5 w-3.5" />
                {shippingLabel}
              </span>
            </span>
          }
          subtitle={`${shipment.supplier_name} · Tạo ngày ${formatDate(shipment.created_at)}`}
          actions={
            <ActionButtons
              status={shipment.status}
              id={id}
              onAction={(next) => updateStatusMutation.mutate(next)}
              isPending={updateStatusMutation.isPending}
            />
          }
        />
      </div>

      {/* Stepper */}
      <Card className="p-6 mb-6">
        <StatusStepper currentStatus={shipment.status} />
      </Card>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Hãng vận chuyển" value={shipment.carrier} />
        <InfoCard label="Mã tracking" value={shipment.tracking_number} />
        <InfoCard label="ETD (Dự kiến xuất)" value={shipment.etd ? formatDate(shipment.etd) : undefined} />
        <InfoCard label="ATD (Thực tế xuất)" value={shipment.atd ? formatDate(shipment.atd) : undefined} />
        <InfoCard label="ETA (Dự kiến đến)" value={shipment.eta ? formatDate(shipment.eta) : undefined} />
        <InfoCard label="ATA (Thực tế đến)" value={shipment.ata ? formatDate(shipment.ata) : undefined} />
        {shipment.po_number && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 col-span-1">
            <p className="text-xs text-slate-400 mb-1">Đơn mua hàng</p>
            <Link
              href={`/purchase-orders/${shipment.po_id}`}
              className="text-sm font-medium text-brand-600 hover:underline flex items-center gap-1"
            >
              {shipment.po_number}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
        {shipment.customs_declaration && (
          <InfoCard label="Tờ khai hải quan" value={shipment.customs_declaration} />
        )}
      </div>

      {/* Items Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Danh sách hàng hóa</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã BQMS</TableHead>
              <TableHead>Tên sản phẩm</TableHead>
              <TableHead className="text-right">SL giao</TableHead>
              <TableHead className="text-right">SL nhận</TableHead>
              <TableHead>Đơn vị</TableHead>
              <TableHead className="text-center">Tình trạng</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipment.items.map((item) => {
              const isComplete = item.quantity_received >= item.quantity_shipped;
              const isPartial = item.quantity_received > 0 && item.quantity_received < item.quantity_shipped;
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="text-sm font-mono font-medium text-brand-600">{item.bqms_code}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-slate-700">{item.product_name}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-mono text-slate-700">{item.quantity_shipped}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`text-sm font-mono ${isComplete ? 'text-emerald-600' : isPartial ? 'text-amber-600' : 'text-slate-400'}`}>
                      {item.quantity_received}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-slate-500">{item.unit}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    {isComplete ? (
                      <StatusBadge variant="success" label="Đủ" />
                    ) : isPartial ? (
                      <StatusBadge variant="warning" label="Một phần" />
                    ) : (
                      <StatusBadge variant="neutral" label="Chưa nhận" />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
