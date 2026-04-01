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
  overstock: { label: 'Tồn dư', className: 'bg-blue-100 text-blue-700' },
  reorder_suggested: { label: 'Đề xuất đặt hàng', className: 'bg-green-100 text-green-700' },
};

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  in: 'Nhập kho',
  out: 'Xuất kho',
  adjust: 'Điều chỉnh',
};

// ─── KPI Card ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  colorClass: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 flex items-center gap-4">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</p>
        {loading ? (
          <div className="h-6 w-20 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        )}
      </div>
    </div>
  );
}

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-brand-600" />
            Kho Thông Minh
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Theo dõi cảnh báo tồn kho và dự báo nhu cầu</p>
        </div>
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
      </div>

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
        <KpiCard
          label="Tổng sản phẩm"
          value={(dashboard?.total_products ?? 0).toLocaleString('vi-VN')}
          icon={Package}
          colorClass="bg-blue-50 text-blue-600"
          loading={dashboardLoading}
        />
        <KpiCard
          label="Cảnh báo thấp"
          value={dashboard?.low_stock_count ?? 0}
          icon={AlertTriangle}
          colorClass="bg-amber-50 text-amber-600"
          loading={dashboardLoading}
        />
        <KpiCard
          label="Hết hàng"
          value={dashboard?.out_of_stock_count ?? 0}
          icon={XCircle}
          colorClass="bg-red-50 text-red-600"
          loading={dashboardLoading}
        />
        <KpiCard
          label="Giá trị kho"
          value={
            dashboard
              ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact' }).format(
                  dashboard.total_value
                )
              : '0 ₫'
          }
          icon={DollarSign}
          colorClass="bg-green-50 text-green-600"
          loading={dashboardLoading}
        />
      </div>

      {/* Stock Alerts */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6">
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
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Không có cảnh báo tồn kho</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Sản phẩm</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Loại cảnh báo</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tồn kho hiện tại</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngưỡng</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đề xuất đặt</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {alerts.map((alert) => {
                  const typeConfig = ALERT_TYPE_CONFIG[alert.alert_type] ?? {
                    label: alert.alert_type,
                    className: 'bg-slate-100 text-slate-600',
                  };
                  const isAcknowledged = acknowledgedIds.has(alert.id) || alert.status === 'acknowledged';

                  return (
                    <tr key={alert.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/inventory/forecast/${alert.id}`}
                          className="text-sm font-medium text-brand-600 hover:underline flex items-center gap-1"
                        >
                          {alert.product_name}
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeConfig.className}`}>
                          {typeConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">
                        {alert.current_qty.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-500">
                        {alert.threshold_qty.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">
                        {alert.suggested_order_qty.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movement History */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
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
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : movements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Không có lịch sử giao dịch</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã hàng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tên hàng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Loại</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số lượng</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trước</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Sau</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ghi chú</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-brand-600">{item.product_code}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.product_name}</td>
                    <td className="px-4 py-3">
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
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
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
                        {item.quantity.toLocaleString('vi-VN')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-slate-500">
                      {item.before_qty.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">
                      {item.after_qty.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 max-w-[150px] truncate">
                      {item.notes || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {new Date(item.created_at).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
