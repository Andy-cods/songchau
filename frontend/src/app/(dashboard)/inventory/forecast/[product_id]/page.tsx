'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Package,
  TrendingDown,
  Calendar,
  ShoppingCart,
  ArrowLeft,
  BarChart2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ─────────────────────────────────────────────────────

interface ForecastData {
  product_name: string;
  avg_daily_consumption: number;
  forecast_30d: number;
  forecast_90d: number;
  suggested_reorder_qty: number;
  days_until_stockout: number;
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

// ─── Page ───────────────────────────────────────────────────────

export default function ProductForecastPage({
  params,
}: {
  params: Promise<{ product_id: string }>;
}) {
  const { product_id } = use(params);
  const router = useRouter();

  const { data: forecastData, isLoading: forecastLoading } = useQuery<{ data: ForecastData }>({
    queryKey: ['smart-inventory-forecast', product_id],
    queryFn: () => api.get(`/api/v1/smart-inventory/forecast/${product_id}`),
    retry: false,
  });

  const { data: movementsData, isLoading: movementsLoading } = useQuery<{
    data: { items: MovementItem[] };
  }>({
    queryKey: ['smart-inventory-movements-product', product_id],
    queryFn: () =>
      api.get(`/api/v1/smart-inventory/movements?product_id=${product_id}&type=out`),
    retry: false,
  });

  const forecast = forecastData?.data;
  const movements = movementsData?.data?.items ?? [];

  // Build last 30 days consumption bar chart data
  const chartData = (() => {
    const byDay: Record<string, number> = {};
    movements.forEach((m) => {
      const day = new Date(m.created_at).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
      });
      byDay[day] = (byDay[day] ?? 0) + m.quantity;
    });
    return Object.entries(byDay)
      .slice(-30)
      .map(([day, qty]) => ({ day, qty }));
  })();

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/inventory/forecast"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kho thông minh
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">Dự báo sản phẩm</span>
      </div>

      {/* Product Info Card */}
      <Card className="p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Package className="h-7 w-7" />
          </div>
          <div>
            {forecastLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : (
              <>
                <h2 className="text-xl font-display font-bold text-slate-900">
                  {forecast?.product_name ?? `Sản phẩm #${product_id}`}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">ID: {product_id}</p>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Forecast Stats */}
      {forecastLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCard key={i} label="" value="" loading />
          ))}
        </div>
      ) : forecast ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="TB tiêu thụ/ngày"
            value={(forecast.avg_daily_consumption ?? 0).toLocaleString('vi-VN')}
            icon={TrendingDown}
            tone="brand"
            sub="đơn vị/ngày"
          />
          <StatCard
            label="Ngày hết hàng"
            value={
              forecast.days_until_stockout > 0
                ? `${forecast.days_until_stockout} ngày`
                : 'Đã hết hàng'
            }
            icon={Calendar}
            tone={
              (forecast.days_until_stockout <= 7
                ? 'danger'
                : forecast.days_until_stockout <= 30
                ? 'warning'
                : 'success') as StatTone
            }
            sub="kể từ hôm nay"
          />
          <StatCard
            label="Dự báo 30 ngày"
            value={(forecast.forecast_30d ?? 0).toLocaleString('vi-VN')}
            icon={BarChart2}
            tone="brand"
            sub="đơn vị cần dùng"
          />
          <StatCard
            label="Đề xuất đặt hàng"
            value={(forecast.suggested_reorder_qty ?? 0).toLocaleString('vi-VN')}
            icon={ShoppingCart}
            tone="brand"
            sub="đơn vị"
          />
        </div>
      ) : (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Không có dữ liệu dự báo cho sản phẩm này.
        </div>
      )}

      {/* Consumption Bar Chart */}
      <Card className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Lịch sử xuất kho 30 ngày gần nhất
        </h3>
        {movementsLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            <p className="text-sm">Không có dữ liệu xuất kho</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [v.toLocaleString('vi-VN'), 'Xuất kho']}
                labelFormatter={(label) => `Ngày ${label}`}
              />
              <Bar dataKey="qty" fill={CHART.brand} radius={[3, 3, 0, 0]} name="Xuất kho" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* CTA */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Tạo yêu cầu mua hàng</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Tạo báo giá nhà cung cấp dựa trên đề xuất đặt hàng từ dự báo
            </p>
          </div>
          <button
            onClick={() =>
              router.push(
                `/supplier-quotes/new?product_id=${product_id}&qty=${forecast?.suggested_reorder_qty ?? ''}&product_name=${encodeURIComponent(forecast?.product_name ?? '')}`
              )
            }
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <ShoppingCart className="h-4 w-4" />
            Tạo yêu cầu mua hàng
          </button>
        </div>
      </Card>
    </div>
  );
}
