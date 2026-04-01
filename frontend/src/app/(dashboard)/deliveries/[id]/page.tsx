'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Truck,
  Package,
  Calendar,
  MapPin,
  Hash,
  Building2,
  Inbox,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';
import type { DeliveryStatus } from '@/types/models';

// ─── Timeline Steps ──────────────────────────────────────────

const TIMELINE_STEPS: { status: DeliveryStatus; label: string }[] = [
  { status: 'pending', label: 'Chờ lấy hàng' },
  { status: 'picked_up', label: 'Đã lấy hàng' },
  { status: 'in_transit', label: 'Đang vận chuyển' },
  { status: 'customs_clearance', label: 'Thông quan' },
  { status: 'delivered', label: 'Đã giao' },
  { status: 'completed', label: 'Hoàn tất' },
];

const STATUS_ORDER: Record<DeliveryStatus, number> = {
  pending: 0,
  picked_up: 1,
  in_transit: 2,
  customs_clearance: 3,
  delivered: 4,
  completed: 5,
};

// ─── Page Component ───────────────────────────────────────────

export default function DeliveryDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: deliveryRaw, isLoading, error } = useQuery({
    queryKey: ['deliveries', id],
    queryFn: async () => {
      // Try direct endpoint first, fallback to list filter
      try {
        return await api.get<any>(`/api/v1/bqms/deliveries/${id}`);
      } catch {
        const res = await api.get<any>('/api/v1/bqms/deliveries');
        const items = res?.items ?? res?.data ?? [];
        return items.find((d: any) => String(d.id) === String(id)) ?? null;
      }
    },
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-60 rounded-lg" />
          </div>
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    );
  }

  const delivery = deliveryRaw?.data ?? deliveryRaw;

  if (error || !delivery) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Inbox className="h-16 w-16 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-700 mb-2">
          Không tìm thấy thông tin vận chuyển
        </h3>
        <Link
          href="/deliveries"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách
        </Link>
      </div>
    );
  }

  const statusCfg = DELIVERY_STATUS_CONFIG[delivery.status as DeliveryStatus];
  const currentStatusOrder = STATUS_ORDER[delivery.status as DeliveryStatus] ?? 0;
  const po = delivery.purchase_order ?? {};
  const items: any[] = po.items ?? delivery.items ?? [];

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/deliveries"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-display font-bold text-slate-900">
              {delivery.delivery_number ?? `Vận đơn #${id}`}
            </h2>
            {statusCfg && (
              <StatusBadge
                label={statusCfg.label}
                variant={statusCfg.variant}
                pulse={statusCfg.pulse}
              />
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            PO: {po.po_number ?? '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Delivery Info */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Truck className="h-4 w-4 text-slate-400" />
              Thông tin vận chuyển
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <InfoRow
                icon={Hash}
                label="Mã vận đơn"
                value={delivery.delivery_number ?? '—'}
                mono
              />
              {delivery.tracking_number && (
                <InfoRow
                  icon={Hash}
                  label="Tracking"
                  value={delivery.tracking_number}
                  mono
                />
              )}
              {delivery.carrier && (
                <InfoRow
                  icon={Truck}
                  label="Hãng vận chuyển"
                  value={delivery.carrier}
                />
              )}
              {po.supplier?.name && (
                <InfoRow
                  icon={Building2}
                  label="Nhà cung cấp"
                  value={po.supplier.name}
                />
              )}
              {delivery.estimated_arrival && (
                <InfoRow
                  icon={Calendar}
                  label="Ngày dự kiến giao"
                  value={formatDate(delivery.estimated_arrival)}
                />
              )}
              {delivery.actual_arrival && (
                <InfoRow
                  icon={Calendar}
                  label="Ngày giao thực tế"
                  value={formatDate(delivery.actual_arrival)}
                />
              )}
              {delivery.destination && (
                <InfoRow
                  icon={MapPin}
                  label="Điểm đến"
                  value={delivery.destination}
                />
              )}
            </dl>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Package className="h-4 w-4 text-slate-400" />
                  Hạng mục ({items.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      {['#', 'Sản phẩm', 'SL', 'Đơn vị', 'Đơn giá'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-slate-400"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item: any, idx: number) => (
                      <tr key={item.id ?? idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-sm text-slate-400 font-mono">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-slate-700">
                            {item.product_name ?? '—'}
                          </p>
                          {item.product_code && (
                            <span className="text-xs font-mono text-slate-400">
                              {item.product_code}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-700">
                          {item.quantity != null
                            ? Number(item.quantity).toLocaleString('vi-VN')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {item.unit ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-700">
                          {item.unit_price != null
                            ? formatCurrency(item.unit_price, po.currency ?? 'VND')
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Timeline */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-5">
              Trạng thái vận chuyển
            </h3>
            <div className="relative">
              {/* Vertical connector */}
              <div className="absolute left-3 top-3 bottom-3 w-px bg-slate-200" />

              <div className="space-y-5">
                {TIMELINE_STEPS.map((step) => {
                  const stepOrder = STATUS_ORDER[step.status];
                  const isDone = stepOrder < currentStatusOrder;
                  const isCurrent = stepOrder === currentStatusOrder;
                  const isPending = stepOrder > currentStatusOrder;
                  const cfg = DELIVERY_STATUS_CONFIG[step.status];

                  return (
                    <div key={step.status} className="relative pl-8">
                      {/* Dot */}
                      <div
                        className={cn(
                          'absolute left-1.5 top-0.5 h-3 w-3 rounded-full border-2 border-white z-10',
                          isDone
                            ? 'bg-emerald-500'
                            : isCurrent
                            ? 'bg-brand-500'
                            : 'bg-slate-300'
                        )}
                      />
                      <p
                        className={cn(
                          'text-sm',
                          isCurrent
                            ? 'font-semibold text-brand-700'
                            : isDone
                            ? 'text-slate-600'
                            : 'text-slate-400'
                        )}
                      >
                        {step.label}
                      </p>
                      {isCurrent && cfg && (
                        <StatusBadge
                          label={cfg.label}
                          variant={cfg.variant}
                          pulse={cfg.pulse}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Notes */}
          {delivery.notes && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Ghi chú
              </h3>
              <p className="text-sm text-slate-600">{delivery.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className={cn('text-sm text-slate-700', mono && 'font-mono')}>
          {value}
        </p>
      </div>
    </div>
  );
}
