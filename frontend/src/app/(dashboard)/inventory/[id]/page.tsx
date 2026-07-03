'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Package,
  TrendingUp,
  TrendingDown,
  RotateCw,
  AlertTriangle,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { InventoryItem } from '@/types/models';

// ─── Types ────────────────────────────────────────────────────

interface InventoryMovement {
  id: string;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  stock_before: number;
  stock_after: number;
  reference?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
}

interface InventoryDetail extends InventoryItem {
  brand?: string;
  specification?: string;
  ordered_stock?: number;
  available_stock?: number;
}

// ─── Movement type config ─────────────────────────────────────

const MOVEMENT_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  in: {
    label: 'Nhập kho',
    icon: TrendingUp,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  out: {
    label: 'Xuất kho',
    icon: TrendingDown,
    color: 'text-red-600',
    bg: 'bg-red-50',
  },
  adjustment: {
    label: 'Điều chỉnh',
    icon: RotateCw,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
};

// ─── Stock Level Bar ──────────────────────────────────────────

function StockLevelBar({
  current,
  min,
  max,
}: {
  current: number;
  min: number;
  max?: number;
}) {
  const effectiveMax = max ?? Math.max(current * 1.5, min * 3);
  const percentage = Math.min((current / effectiveMax) * 100, 100);
  const minPercentage = (min / effectiveMax) * 100;
  const isBelowMin = current < min;

  return (
    <div className="w-full">
      <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
        {/* Current stock bar */}
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            isBelowMin
              ? 'bg-rose-500'
              : percentage > 80
              ? 'bg-emerald-500'
              : 'bg-brand-500'
          )}
          style={{ width: `${percentage}%` }}
        />
        {/* Min stock indicator line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-400"
          style={{ left: `${minPercentage}%` }}
          title={`Tồn kho tối thiểu: ${min}`}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-xs text-slate-400">
        <span>0</span>
        <span
          className={cn('font-medium', isBelowMin && 'text-red-500')}
          style={{ position: 'relative', left: `${minPercentage / 2 - 10}%` }}
        >
          Min: {min.toLocaleString('vi-VN')}
        </span>
        <span>Max: {effectiveMax.toLocaleString('vi-VN')}</span>
      </div>
    </div>
  );
}

// ─── Adjustment Modal ─────────────────────────────────────────

function AdjustmentModal({
  inventoryId,
  currentStock,
  unit,
  onClose,
}: {
  inventoryId: string;
  currentStock: number;
  unit: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [adjustQty, setAdjustQty] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: (data: { adjust_qty: number; reason: string }) =>
      api.put(`/api/v1/inventory/${inventoryId}`, data),
    onSuccess: () => {
      toast.success('Điều chỉnh tồn kho thành công!');
      queryClient.invalidateQueries({ queryKey: ['inventory', inventoryId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements', inventoryId] });
      onClose();
    },
    onError: () => toast.error('Không thể điều chỉnh tồn kho'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(adjustQty);
    if (isNaN(qty) || qty === 0) {
      toast.error('Vui lòng nhập số lượng điều chỉnh hợp lệ');
      return;
    }
    if (!reason.trim()) {
      toast.error('Vui lòng nhập lý do điều chỉnh');
      return;
    }
    mutation.mutate({ adjust_qty: qty, reason: reason.trim() });
  };

  const newStock = currentStock + (parseFloat(adjustQty) || 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-6 py-4 border-b border-slate-100">
          <DialogTitle className="text-base">Điều chỉnh tồn kho</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Tồn kho hiện tại</p>
            <p className="text-lg font-bold font-mono text-slate-900">
              {currentStock.toLocaleString('vi-VN')} {unit}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Điều chỉnh số lượng <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              placeholder="Dương (+) để thêm, âm (-) để giảm"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
            {adjustQty && !isNaN(parseFloat(adjustQty)) && (
              <p className="text-xs mt-1">
                Tồn kho sau điều chỉnh:{' '}
                <span
                  className={cn(
                    'font-mono font-semibold',
                    newStock < 0 ? 'text-red-600' : 'text-emerald-600'
                  )}
                >
                  {newStock.toLocaleString('vi-VN')} {unit}
                </span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Lý do điều chỉnh <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Nhập lý do điều chỉnh tồn kho..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              Có lỗi xảy ra. Vui lòng thử lại.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận điều chỉnh
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page Component ───────────────────────────────────────────

export default function InventoryDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  const { data: item, isLoading: itemLoading } = useQuery<InventoryDetail>({
    queryKey: ['inventory', id],
    queryFn: () => api.get(`/api/v1/inventory/${id}`),
    retry: false,
  });

  const { data: movements, isLoading: movementsLoading } = useQuery<
    InventoryMovement[]
  >({
    queryKey: ['inventory-movements', id],
    queryFn: () => api.get(`/api/v1/inventory/${id}/movements`),
    retry: false,
  });

  if (itemLoading) {
    return <DetailSkeleton />;
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center">
        <EmptyState icon={Package} heading="Không tìm thấy hàng hóa" />
        <Link href="/inventory" className="-mt-8">
          <Button variant="outline" size="sm">
            Quay lại kho hàng
          </Button>
        </Link>
      </div>
    );
  }

  const isBelowMin = item.current_stock < item.min_stock;
  const orderedStock = item.ordered_stock ?? 0;
  const availableStock = item.available_stock ?? item.current_stock;

  return (
    <div className="max-w-5xl">
      {showAdjustModal && (
        <AdjustmentModal
          inventoryId={id}
          currentStock={item.current_stock}
          unit={item.unit}
          onClose={() => setShowAdjustModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link
          href="/inventory"
          className="mt-1 p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader
          className="flex-1"
          title={
            <span className="flex items-center gap-3">
              {item.product_name}
              {isBelowMin && (
                <Badge variant="danger" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Dưới mức tối thiểu
                </Badge>
              )}
            </span>
          }
          subtitle={<span className="font-mono">{item.product_code}</span>}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdjustModal(true)}
              className="gap-2"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Điều chỉnh tồn kho
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Info Card */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Thông tin sản phẩm
            </h3>

            <dl className="space-y-3">
              <InfoRow label="Mã hàng" value={item.product_code} mono />
              <InfoRow label="Tên hàng" value={item.product_name} />
              {item.category && (
                <InfoRow label="Danh mục" value={item.category} />
              )}
              {item.brand && (
                <InfoRow label="Thương hiệu" value={item.brand} />
              )}
              {item.specification && (
                <InfoRow label="Quy cách" value={item.specification} />
              )}
              {item.warehouse_location && (
                <InfoRow label="Vị trí kho" value={item.warehouse_location} />
              )}
              <InfoRow label="Đơn vị" value={item.unit} />
            </dl>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400">
                Cập nhật: {formatDate(item.updated_at)}
              </p>
            </div>
          </Card>

          {/* Stock Numbers Card */}
          <Card>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Số lượng tồn
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <StockBox
                label="Tồn kho"
                value={item.current_stock}
                unit={item.unit}
                highlight={isBelowMin}
              />
              <StockBox
                label="Đã đặt"
                value={orderedStock}
                unit={item.unit}
              />
              <StockBox
                label="Khả dụng"
                value={availableStock}
                unit={item.unit}
              />
              <StockBox
                label="Tối thiểu"
                value={item.min_stock}
                unit={item.unit}
              />
            </div>

            {item.max_stock != null && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Tồn kho tối đa</span>
                  <span className="font-mono">
                    {(item.max_stock ?? 0).toLocaleString('vi-VN')} {item.unit}
                  </span>
                </div>
              </div>
            )}

            {/* Stock level visual */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2">
                Mức tồn kho
              </p>
              <StockLevelBar
                current={item.current_stock}
                min={item.min_stock}
                max={item.max_stock ?? undefined}
              />
            </div>
          </Card>
        </div>

        {/* Movements History */}
        <div className="lg:col-span-2">
          <Card padded={false}>
            <div className="flex items-center gap-2 p-4 border-b border-slate-100">
              <RotateCw className="h-4 w-4 text-brand-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Lịch sử xuất nhập
              </h3>
            </div>

            {movementsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4 items-center">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-32 ml-auto" />
                  </div>
                ))}
              </div>
            ) : !movements || movements.length === 0 ? (
              <EmptyState icon={RotateCw} heading="Chưa có lịch sử xuất nhập" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Ngày',
                      'Loại',
                      'SL',
                      'Trước',
                      'Sau',
                      'Tham chiếu',
                      'Ghi chú',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((mv) => {
                    const typeCfg = MOVEMENT_TYPE_CONFIG[mv.type] ??
                      MOVEMENT_TYPE_CONFIG.adjustment;
                    const TypeIcon = typeCfg.icon;
                    return (
                      <TableRow key={mv.id}>
                        <TableCell className="text-sm text-slate-500">
                          {formatDate(mv.created_at)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                              typeCfg.bg,
                              typeCfg.color
                            )}
                          >
                            <TypeIcon className="h-3 w-3" />
                            {typeCfg.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'text-sm font-mono font-medium',
                              mv.type === 'in'
                                ? 'text-emerald-600'
                                : mv.type === 'out'
                                ? 'text-red-600'
                                : 'text-amber-600'
                            )}
                          >
                            {mv.type === 'in' ? '+' : mv.type === 'out' ? '-' : ''}
                            {(mv.quantity ?? 0).toLocaleString('vi-VN')}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-slate-500">
                          {(mv.stock_before ?? 0).toLocaleString('vi-VN')}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-slate-700 font-medium">
                          {(mv.stock_after ?? 0).toLocaleString('vi-VN')}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500 font-mono">
                          {mv.reference ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[180px] truncate">
                          {mv.notes ?? '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd
        className={cn(
          'text-sm text-slate-700 text-right max-w-[60%]',
          mono && 'font-mono'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function StockBox({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 border',
        highlight
          ? 'bg-red-50 border-red-200'
          : 'bg-slate-50 border-slate-200'
      )}
    >
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p
        className={cn(
          'text-lg font-bold font-mono',
          highlight ? 'text-red-600' : 'text-slate-900'
        )}
      >
        {value.toLocaleString('vi-VN')}
      </p>
      <p className="text-xs text-slate-400">{unit}</p>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
