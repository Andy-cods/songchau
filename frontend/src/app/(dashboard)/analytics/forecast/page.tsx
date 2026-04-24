'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp,
  RefreshCw,
  Loader2,
  ChevronRight,
  X,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────

interface ForecastProduct {
  product_id: string;
  bqms_code: string;
  product_name: string;
  last_forecast_date: string | null;
  predicted_qty: number | null;
}

interface ForecastResult {
  product_name: string;
  forecasts: Array<{
    forecast_date: string;
    predicted_qty: number;
    confidence: number;
  }>;
  historical: Array<{
    month: string;
    actual_qty: number;
  }>;
}

// ─── Page ───────────────────────────────────────────────────────

export default function ForecastPage() {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const { data: productsRaw, isLoading: productsLoading, error } = useQuery<{
    data: { items: ForecastProduct[]; total: number; page: number; pages: number } | ForecastProduct[];
  }>({
    queryKey: ['demand-forecast', 'products'],
    queryFn: () => api.get('/api/v1/demand-forecast/products'),
    retry: 1,
  });

  const { data: resultRaw, isLoading: resultLoading } = useQuery<{
    data: ForecastResult;
  }>({
    queryKey: ['demand-forecast', 'results', selectedProductId],
    queryFn: () => api.get(`/api/v1/demand-forecast/results/${selectedProductId}`),
    enabled: !!selectedProductId,
    retry: 1,
  });

  const generateMutation = useMutation({
    mutationFn: (productId: string) =>
      api.post(`/api/v1/demand-forecast/generate/${productId}`),
    onMutate: (productId) => setGeneratingId(productId),
    onSettled: (_, __, productId) => {
      setGeneratingId(null);
      queryClient.invalidateQueries({ queryKey: ['demand-forecast', 'products'] });
      queryClient.invalidateQueries({
        queryKey: ['demand-forecast', 'results', productId],
      });
    },
  });

  const products = (() => {
    const d = productsRaw?.data;
    if (Array.isArray(d)) return d;
    return Array.isArray((d as any)?.items) ? (d as any).items : [];
  })() as ForecastProduct[];
  const result = resultRaw?.data;

  // Build chart data: historical (solid) + forecasts (dashed)
  const chartData = (() => {
    if (!result) return [];
    const hist = (result.historical ?? []).map((h) => ({
      label: h.month,
      actual: h.actual_qty,
      predicted: null as number | null,
    }));
    const fcast = (result.forecasts ?? []).map((f) => ({
      label: new Date(f.forecast_date).toLocaleDateString('vi-VN', {
        month: 'short',
        year: 'numeric',
      }),
      actual: null as number | null,
      predicted: f.predicted_qty,
    }));
    return [...hist, ...fcast];
  })();

  const selectedProduct = products.find((p) => p.product_id === selectedProductId);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <TrendingUp className="h-5 w-5 inline mr-2 text-brand-600" />
            Dự báo nhu cầu
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Phân tích và dự báo nhu cầu theo sản phẩm
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">
                Danh sách sản phẩm
              </h3>
            </div>

            {error && !productsLoading && (
              <div className="p-4">
                <p className="text-sm text-red-600">Không thể tải danh sách sản phẩm</p>
              </div>
            )}

            {productsLoading ? (
              <ProductListSkeleton />
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <TrendingUp className="h-8 w-8 mb-2" />
                <p className="text-sm">Chưa có sản phẩm</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {products.map((product) => {
                  const isSelected = selectedProductId === product.product_id;
                  const isGenerating = generatingId === product.product_id;

                  return (
                    <li key={product.product_id}>
                      <div
                        className={cn(
                          'px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors',
                          isSelected && 'bg-brand-50 border-l-2 border-l-brand-600'
                        )}
                        onClick={() => setSelectedProductId(product.product_id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {product.product_name}
                            </p>
                            <p className="text-xs font-mono text-slate-500 mt-0.5">
                              {product.bqms_code}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {product.predicted_qty != null && (
                                <span className="text-xs text-brand-600 font-semibold">
                                  Dự báo: {(product.predicted_qty ?? 0).toLocaleString('vi-VN')}
                                </span>
                              )}
                              {product.last_forecast_date && (
                                <span className="text-xs text-slate-400">
                                  {new Date(product.last_forecast_date).toLocaleDateString('vi-VN')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                generateMutation.mutate(product.product_id);
                              }}
                              disabled={isGenerating}
                              title="Tạo dự báo"
                              className={cn(
                                'p-1.5 rounded-md transition-colors',
                                isGenerating
                                  ? 'text-slate-300 cursor-wait'
                                  : 'text-slate-400 hover:text-brand-600 hover:bg-brand-50'
                              )}
                            >
                              {isGenerating ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </button>
                            <ChevronRight
                              className={cn(
                                'h-4 w-4 transition-colors',
                                isSelected ? 'text-brand-600' : 'text-slate-300'
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Forecast Detail */}
        <div className="lg:col-span-2">
          {!selectedProductId ? (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col items-center justify-center py-24 text-slate-400">
              <TrendingUp className="h-12 w-12 mb-3 text-slate-300" />
              <p className="text-sm">Chọn sản phẩm để xem dự báo</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Chart Card */}
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">
                      {selectedProduct?.product_name}
                    </h3>
                    <p className="text-xs font-mono text-slate-400 mt-0.5">
                      {selectedProduct?.bqms_code}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      generateMutation.mutate(selectedProductId);
                    }}
                    disabled={generatingId === selectedProductId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {generatingId === selectedProductId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Tạo dự báo
                  </button>
                </div>

                {resultLoading ? (
                  <div className="h-64 flex items-center justify-center text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-slate-400 flex-col gap-2">
                    <TrendingUp className="h-8 w-8 text-slate-300" />
                    <p className="text-sm">Chưa có dữ liệu dự báo. Nhấn "Tạo dự báo" để bắt đầu.</p>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={chartData}
                        margin={{ top: 5, right: 20, bottom: 20, left: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          axisLine={{ stroke: '#e2e8f0' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => v.toLocaleString('vi-VN')}
                        />
                        <Tooltip
                          formatter={(v: number, name: string) => [
                            v?.toLocaleString('vi-VN'),
                            name === 'actual' ? 'Thực tế' : 'Dự báo',
                          ]}
                        />
                        <Legend
                          formatter={(v) =>
                            v === 'actual' ? 'Lịch sử thực tế' : 'Dự báo'
                          }
                        />
                        {/* Separator between history & forecast */}
                        {result && result.historical.length > 0 && (
                          <ReferenceLine
                            x={
                              result.historical[result.historical.length - 1]?.month
                            }
                            stroke="#94a3b8"
                            strokeDasharray="4 2"
                            label={{
                              value: 'Hiện tại',
                              position: 'insideTopRight',
                              fontSize: 10,
                              fill: '#94a3b8',
                            }}
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="actual"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={{ r: 3, fill: '#3b82f6' }}
                          connectNulls={false}
                          name="actual"
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          dot={{ r: 3, fill: '#f59e0b' }}
                          connectNulls={false}
                          name="predicted"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>

              {/* Forecast Detail Table */}
              {result && result.forecasts.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Chi tiết dự báo
                    </h3>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                          Kỳ
                        </th>
                        <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                          Dự báo (qty)
                        </th>
                        <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                          Độ tin cậy
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.forecasts.map((f, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {new Date(f.forecast_date).toLocaleDateString('vi-VN', {
                              month: 'long',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-slate-800">
                            {(f.predicted_qty ?? 0).toLocaleString('vi-VN')}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    f.confidence >= 0.8
                                      ? 'bg-emerald-500'
                                      : f.confidence >= 0.6
                                      ? 'bg-amber-500'
                                      : 'bg-red-400'
                                  )}
                                  style={{ width: `${(f.confidence * 100).toFixed(0)}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-500 w-10 text-right">
                                {(f.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function ProductListSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-3 space-y-2">
          <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
