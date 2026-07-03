'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Package,
  AlertTriangle,
  XCircle,
  DollarSign,
  RefreshCw,
  Eye,
  Loader2,
  Filter,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
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

// ─── Types ─────────────────────────────────────────────────────

interface DashboardData {
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_value: number;
}

interface AlertItem {
  id: string;
  product_name: string;
  alert_type: 'low_stock' | 'out_of_stock' | 'overstock' | 'reorder_suggested';
  current_qty: number;
  threshold_qty: number;
  suggested_order_qty: number;
  status: string;
}

interface MovementItem {
  id: string;
  product_code: string;
  product_name: string;
  movement_type: 'in' | 'out' | 'adjust';
  quantity: number;
  before_qty: number;
  after_qty: number;
  notes?: string;
  created_at: string;
}

// ─── Alert Type Config ──────────────────────────────────────────

const ALERT_TYPE_CONFIG: Record<AlertItem['alert_type'], { label: string; className: string }> = {
  low_stock: { label: 'Tồn thấp', className: 'bg-amber-100 text-amber-700' },
  out_of_stock: { label: 'Hết hàng', className: 'bg-red-100 text-red-700' },
  overstock: { label: 'Tồn dư', className: 'bg-sky-100 text-sky-700' },
  reorder_suggested: { label: 'Đề xuất đặt hàng', className: 'bg-green-100 text-green-700' },
};

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  in: 'Nhập kho',
  out: 'Xuất kho',
  adjust: 'Điều chỉnh',
};

// ─── Page ───────────────────────────────────────────────────────

export default function InventoryForecastPage() {
  const queryClient = useQueryClient();
  const [movementType, setMovementType] = useState('');
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery<{ data: DashboardData }>({
    queryKey: ['smart-inventory-dashboard'],
    queryFn: () => api.get('/api/v1/smart-inventory/dashboard'),
    retry: false,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery<{ data: { items: AlertItem[] } }>({
    queryKey: ['smart-inventory-alerts'],
    queryFn: () => api.get('/api/v1/smart-inventory/alerts'),
    retry: false,
  });

  const { data: movementsData, isLoading: movementsLoading } = useQuery<{ data: { items: MovementItem[] } }>({
    queryKey: ['smart-inventory-movements', movementType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (movementType) params.set('type', movementType);
      return api.get(`/api/v1/smart-inventory/movements?${params}`);
    },
    retry: false,
  });

  const reorderCheckMutation = useMutation({
    mutationFn: () => api.post('/api/v1/smart-inventory/reorder-check'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-inventory-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['smart-inventory-dashboard'] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/smart-inventory/alerts/${id}/acknowledge`),
    onSuccess: (_data, id) => {
      setAcknowledgedIds((prev) => new Set(prev).add(id));
      queryClient.invalidateQueries({ queryKey: ['smart-inventory-alerts'] });
    },
  });

  const dashboard = dashboardData?.data;
  const alerts = alertsData?.data?.items ?? [];
  const movements = movementsData?.data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <PageHeader
        icon={Package}
        title="Kho Thông Minh"
        subtitle="Theo dõi cảnh báo tồn kho và dự báo nhu cầu"
        className="mb-6"
        actions={
          <button
            onClick={() => reorderCheckMutation.mutate()}
            disabled={reorderCheckMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {reorderCheckMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Kiểm tra tồn kho
          </button>
        }
      />

      {/* Success/Error feedback for reorder check */}
      {reorderCheckMutation.isSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          Kiểm tra tồn kho hoàn tất. Danh sách cảnh báo đã được cập nhật.
        </div>
      )}
      {reorderCheckMutation.isError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Không thể kiểm tra tồn kho. Vui lòng thử lại.
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Tổng sản phẩm"
          value={(dashboard?.total_products ?? 0).toLocaleString('vi-VN')}
          icon={Package}
          loading={dashboardLoading}
        />
        <StatCard
          label="Cảnh báo thấp"
          value={dashboard?.low_stock_count ?? 0}
          icon={AlertTriangle}
          tone="warning"
          loading={dashboardLoading}
        />
        <StatCard
          label="Hết hàng"
          value={dashboard?.out_of_stock_count ?? 0}
          icon={XCircle}
          tone="danger"
          loading={dashboardLoading}
        />
        <StatCard
          label="Giá trị kho"
          value={
            dashboard
              ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact' }).format(
                  dashboard.total_value
                )
              : '0 ₫'
          }
          icon={DollarSign}
          tone="brand"
          loading={dashboardLoading}
        />
      </div>

      {/* Stock Alerts */}
      <Card padded={false} className="mb-6">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Cảnh báo tồn kho
            {alerts.length > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                {alerts.length}
              </span>
            )}
          </h3>
        </div>
        {alertsLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState icon={Package} heading="Không có cảnh báo tồn kho" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sản phẩm</TableHead>
                <TableHead>Loại cảnh báo</TableHead>
                <TableHead className="text-right">Tồn kho hiện tại</TableHead>
                <TableHead className="text-right">Ngưỡng</TableHead>
                <TableHead className="text-right">Đề xuất đặt</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => {
                const typeConfig = ALERT_TYPE_CONFIG[alert.alert_type] ?? {
                  label: alert.alert_type,
                  className: 'bg-slate-100 text-slate-600',
                };
                const isAcknowledged = acknowledgedIds.has(alert.id) || alert.status === 'acknowledged';

                return (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/forecast/${alert.id}`}
                        className="text-sm font-medium text-brand-600 hover:underline flex items-center gap-1"
                      >
                        {alert.product_name}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeConfig.className}`}>
                        {typeConfig.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-slate-700">
                      {(alert.current_qty ?? 0).toLocaleString('vi-VN')}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-slate-500">
                      {(alert.threshold_qty ?? 0).toLocaleString('vi-VN')}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-slate-700">
                      {(alert.suggested_order_qty ?? 0).toLocaleString('vi-VN')}
                    </TableCell>
                    <TableCell>
                      {isAcknowledged ? (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          Đã xem
                        </span>
                      ) : (
                        <button
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          disabled={acknowledgeMutation.isPending && acknowledgeMutation.variables === alert.id}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors text-slate-600"
                        >
                          {acknowledgeMutation.isPending && acknowledgeMutation.variables === alert.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                          Đã xem
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Movement History */}
      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Lịch sử nhập/xuất kho</h3>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700"
            >
              <option value="">Tất cả loại</option>
              <option value="in">Nhập kho</option>
              <option value="out">Xuất kho</option>
              <option value="adjust">Điều chỉnh</option>
            </select>
          </div>
        </div>
        {movementsLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <EmptyState icon={Package} heading="Không có lịch sử giao dịch" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã hàng</TableHead>
                <TableHead>Tên hàng</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead className="text-right">Số lượng</TableHead>
                <TableHead className="text-right">Trước</TableHead>
                <TableHead className="text-right">Sau</TableHead>
                <TableHead>Ghi chú</TableHead>
                <TableHead>Thời gian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm font-mono text-brand-600">{item.product_code}</TableCell>
                  <TableCell className="text-sm text-slate-700">{item.product_name}</TableCell>
                  <TableCell>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        item.movement_type === 'in'
                          ? 'bg-green-100 text-green-700'
                          : item.movement_type === 'out'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {MOVEMENT_TYPE_LABEL[item.movement_type] ?? item.movement_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">
                    <span
                      className={
                        item.movement_type === 'in'
                          ? 'text-green-600'
                          : item.movement_type === 'out'
                          ? 'text-red-600'
                          : 'text-slate-700'
                      }
                    >
                      {item.movement_type === 'in' ? '+' : item.movement_type === 'out' ? '-' : ''}
                      {(item.quantity ?? 0).toLocaleString('vi-VN')}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono text-slate-500">
                    {(item.before_qty ?? 0).toLocaleString('vi-VN')}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono text-slate-700">
                    {(item.after_qty ?? 0).toLocaleString('vi-VN')}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500 max-w-[150px] truncate">
                    {item.notes || '—'}
                  </TableCell>
                  <TableCell className="text-sm text-slate-400">
                    {new Date(item.created_at).toLocaleDateString('vi-VN', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
