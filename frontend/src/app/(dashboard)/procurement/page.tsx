'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShoppingCart,
  Plus,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Package,
  Users,
  ClipboardList,
  Trophy,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { cn, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader } from '@/components/shared/page-header';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import type { StatusVariant } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: number;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  is_approved: boolean;
  quote_count: number;
  created_at: string;
}

interface Batch {
  id: number;
  batch_code: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'evaluating' | 'awarded' | 'closed' | 'cancelled' | string;
  award_mode: 'per_item' | 'per_batch';
  item_count: number;
  quote_count: number;
  created_at: string;
  published_at: string | null;
}

interface VendorListResponse {
  data: Vendor[];
}

interface BatchListResponse {
  data: Batch[];
  total: number;
}

interface CreateBatchForm {
  title: string;
  description: string;
  award_mode: 'per_item' | 'per_batch';
  notes_internal: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Thang 2026-06-22 (fix crash "Có lỗi xảy ra" khi vào Mua hàng): switch cũ chỉ
// có 4 case + KHÔNG default → đợt thầu status='evaluating'/'closed' (procurement
// v2) trả undefined → `const { label } = undefined` vỡ cả trang trong .map().
// Thêm đủ trạng thái v2 + default an toàn — KHÔNG bao giờ trả undefined nữa.
function getBatchStatusConfig(status: string): { label: string; variant: StatusVariant } {
  switch (status) {
    case 'draft':      return { label: 'Nháp',          variant: 'neutral' };
    case 'published':  return { label: 'Đang mở',       variant: 'info'    };
    case 'evaluating': return { label: 'Đang chấm thầu', variant: 'warning' };
    case 'awarded':    return { label: 'Đã chọn NCC',   variant: 'success' };
    case 'closed':     return { label: 'Đã đóng',       variant: 'neutral' };
    case 'cancelled':  return { label: 'Đã hủy',        variant: 'danger'  };
    default:           return { label: status || '—',   variant: 'neutral' };
  }
}

function getAwardModeLabel(mode: 'per_item' | 'per_batch'): string {
  return mode === 'per_item' ? 'Theo hạng mục' : 'Theo đợt';
}

// ─── Create Batch Modal ───────────────────────────────────────────────────────

interface CreateBatchModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (id: number) => void;
}

function CreateBatchModal({ open, onClose, onSuccess }: CreateBatchModalProps) {
  const [form, setForm] = useState<CreateBatchForm>({
    title: '',
    description: '',
    award_mode: 'per_item',
    notes_internal: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      api.post('/api/v1/procurement/batches', {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        award_mode: form.award_mode,
        notes_internal: form.notes_internal.trim() || undefined,
      }) as Promise<{ data: { id: number; batch_code: string } }>,
    onSuccess: (res) => {
      onSuccess(res.data.id);
      onClose();
      setForm({ title: '', description: '', award_mode: 'per_item', notes_internal: '' });
      setError(null);
    },
    onError: () => setError('Tạo đợt thất bại. Vui lòng thử lại.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Tên đợt không được để trống.');
      return;
    }
    setError(null);
    mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Plus className="h-4 w-4 text-brand-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Tạo đợt báo giá mới</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Tên đợt <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="VD: Đợt báo giá vật tư tháng 4/2026"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Mô tả</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Mô tả ngắn về đợt báo giá..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Phương thức chọn NCC</label>
            <div className="grid grid-cols-2 gap-2">
              {(['per_item', 'per_batch'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, award_mode: mode }))}
                  className={cn(
                    'px-3 py-2.5 rounded-lg border text-xs font-medium text-left transition-colors',
                    form.award_mode === mode
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  )}
                >
                  <div className="font-semibold">{getAwardModeLabel(mode)}</div>
                  <div className="text-slate-400 mt-0.5 font-normal">
                    {mode === 'per_item' ? 'Mỗi hạng mục chọn NCC riêng' : 'Chọn 1 NCC cho toàn đợt'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Ghi chú nội bộ</label>
            <textarea
              value={form.notes_internal}
              onChange={(e) => setForm((f) => ({ ...f, notes_internal: e.target.value }))}
              rows={2}
              placeholder="Ghi chú chỉ dành cho nội bộ..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-400 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Tạo đợt
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── KPI Card (local lightweight) ────────────────────────────────────────────

interface KPIProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accentColor: string;
  loading?: boolean;
}

function KPICard({ label, value, icon: Icon, accentColor, loading }: KPIProps) {
  if (loading) {
    return (
      <div className={cn('bg-white rounded-lg p-4 border-t-[3px] shadow-sm', accentColor)}>
        <div className="h-3 w-24 bg-slate-200 rounded animate-pulse mb-3" />
        <div className="h-7 w-12 bg-slate-200 rounded animate-pulse" />
      </div>
    );
  }
  return (
    <div className={cn('bg-white rounded-lg p-4 border-t-[3px] shadow-sm hover:shadow-md transition-shadow', accentColor)}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono uppercase text-slate-400 tracking-wider">{label}</p>
        <Icon className="h-4 w-4 text-slate-300" />
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

// ─── Vendor Row Actions ───────────────────────────────────────────────────────

interface VendorActionsProps {
  vendor: Vendor;
  onAction: (id: number, action: 'approve' | 'reject') => void;
  isPending: boolean;
}

function VendorActions({ vendor, onAction, isPending }: VendorActionsProps) {
  if (vendor.is_approved) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Đã duyệt
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onAction(vendor.id, 'approve')}
        disabled={isPending}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
        Duyệt
      </button>
      <button
        onClick={() => onAction(vendor.id, 'reject')}
        disabled={isPending}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors"
      >
        <XCircle className="h-3 w-3" />
        Từ chối
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const { user } = useAuth();
  const isAdmin = (user?.role ?? '') === 'admin';
  const [activeTab, setActiveTab] = useState<'batches' | 'vendors'>('batches');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [vendorStatusFilter, setVendorStatusFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [batchStatusFilter, setBatchStatusFilter] = useState<'all' | 'draft' | 'published' | 'awarded'>('all');
  const queryClient = useQueryClient();

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: vendorData, isLoading: vendorsLoading, refetch: refetchVendors } = useQuery({
    queryKey: ['procurement-vendors', vendorStatusFilter],
    queryFn: () =>
      api.get(`/api/v1/procurement/vendors?status=${vendorStatusFilter}`) as Promise<VendorListResponse>,
  });

  const { data: batchData, isLoading: batchesLoading, refetch: refetchBatches } = useQuery({
    queryKey: ['procurement-batches', batchStatusFilter],
    queryFn: () =>
      api.get(`/api/v1/procurement/batches?status=${batchStatusFilter}&page=1&limit=50`) as Promise<BatchListResponse>,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const { mutate: vendorAction, variables: vendorActionVars, isPending: isVendorActionPending } = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      api.patch(`/api/v1/procurement/vendors/${id}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procurement-vendors'] });
    },
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────

  const vendors = vendorData?.data ?? [];
  const batches = batchData?.data ?? [];

  const kpiTotalVendors = vendors.length;
  const kpiPendingVendors = vendors.filter((v) => !v.is_approved).length;
  const kpiOpenBatches = batches.filter((b) => b.status === 'published').length;
  const kpiAwardedBatches = batches.filter((b) => b.status === 'awarded').length;

  const isLoading = vendorsLoading || batchesLoading;

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Mua hàng"
        subtitle="Quản lý đợt báo giá & nhà cung cấp"
        icon={ShoppingCart}
        actions={
          <>
            <button
              onClick={() => { refetchBatches(); refetchVendors(); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {/* create_batch is admin-only on the backend (P7) — hide for others. */}
            {isAdmin && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Tạo đợt mới
              </button>
            )}
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          label="Tổng NCC"
          value={kpiTotalVendors}
          icon={Users}
          accentColor="border-brand-500"
          loading={isLoading}
        />
        <KPICard
          label="NCC chờ duyệt"
          value={kpiPendingVendors}
          icon={AlertCircle}
          accentColor="border-brand-500"
          loading={isLoading}
        />
        <KPICard
          label="Đợt đang mở"
          value={kpiOpenBatches}
          icon={ClipboardList}
          accentColor="border-brand-500"
          loading={isLoading}
        />
        <KPICard
          label="Đợt đã chọn NCC"
          value={kpiAwardedBatches}
          icon={Trophy}
          accentColor="border-brand-500"
          loading={isLoading}
        />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab header */}
        <div className="flex border-b border-slate-200">
          {([
            { key: 'batches', label: 'Đợt báo giá', icon: ClipboardList },
            { key: 'vendors', label: 'Nhà cung cấp', icon: Package },
          ] as const).map(({ key, label, icon: TabIcon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <TabIcon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Batches Tab ── */}
        {activeTab === 'batches' && (
          <div>
            {/* Filter bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              {(['all', 'draft', 'published', 'awarded'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setBatchStatusFilter(s)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    batchStatusFilter === s
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  )}
                >
                  {s === 'all' ? 'Tất cả' : getBatchStatusConfig(s as Batch['status']).label}
                </button>
              ))}
            </div>

            {/* Table */}
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Mã đợt</TableHead>
                  <TableHead>Tên đợt</TableHead>
                  <TableHead className="whitespace-nowrap">Trạng thái</TableHead>
                  <TableHead className="whitespace-nowrap">Phương thức</TableHead>
                  <TableHead className="text-right whitespace-nowrap">HM</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Báo giá</TableHead>
                  <TableHead className="whitespace-nowrap">Ngày tạo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-3 bg-slate-100 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : batches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">
                      Chưa có đợt báo giá nào
                    </TableCell>
                  </TableRow>
                ) : (
                  batches.map((batch) => {
                    const { label, variant } = getBatchStatusConfig(batch.status);
                    return (
                      <TableRow key={batch.id}>
                        <TableCell className="font-mono text-slate-500 whitespace-nowrap">
                          {batch.batch_code}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="font-medium text-slate-800 truncate block">{batch.title}</span>
                          {batch.description && (
                            <span className="text-slate-400 truncate block mt-0.5">{batch.description}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge
                            label={label}
                            variant={variant}
                            pulse={batch.status === 'published'}
                          />
                        </TableCell>
                        <TableCell className="text-slate-500 whitespace-nowrap">
                          {getAwardModeLabel(batch.award_mode)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-700">{batch.item_count}</TableCell>
                        <TableCell className="text-right font-mono text-slate-700">{batch.quote_count}</TableCell>
                        <TableCell className="text-slate-500 whitespace-nowrap font-mono">
                          {formatDate(batch.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/procurement/${batch.id}`}
                            className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap"
                          >
                            Chi tiết
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* ── Vendors Tab ── */}
        {activeTab === 'vendors' && (
          <div>
            {/* Filter bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              {([
                { value: 'all',     label: 'Tất cả'       },
                { value: 'pending', label: 'Chờ duyệt'    },
                { value: 'approved',label: 'Đã duyệt'     },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setVendorStatusFilter(value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    vendorStatusFilter === value
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Table */}
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Công ty</TableHead>
                  <TableHead className="whitespace-nowrap">Liên hệ</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="whitespace-nowrap">Điện thoại</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Lần BG</TableHead>
                  <TableHead className="whitespace-nowrap">Ngày đăng ký</TableHead>
                  <TableHead className="whitespace-nowrap">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-3 bg-slate-100 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : vendors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                      Không có nhà cung cấp nào
                    </TableCell>
                  </TableRow>
                ) : (
                  vendors.map((vendor) => {
                    const isActing =
                      isVendorActionPending &&
                      (vendorActionVars as { id: number } | undefined)?.id === vendor.id;
                    return (
                      <TableRow key={vendor.id}>
                        <TableCell>
                          <span className="font-medium text-slate-800 block max-w-[180px] truncate">
                            {vendor.company_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-600 whitespace-nowrap">{vendor.contact_name}</TableCell>
                        <TableCell className="text-slate-500 max-w-[160px] truncate">{vendor.email}</TableCell>
                        <TableCell className="text-slate-500 font-mono whitespace-nowrap">{vendor.phone}</TableCell>
                        <TableCell className="text-right font-mono text-slate-700">{vendor.quote_count}</TableCell>
                        <TableCell className="text-slate-500 font-mono whitespace-nowrap">
                          {formatDate(vendor.created_at)}
                        </TableCell>
                        <TableCell>
                          <VendorActions
                            vendor={vendor}
                            onAction={(id, action) => vendorAction({ id, action })}
                            isPending={isActing}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create Batch Modal */}
      <CreateBatchModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(id) => {
          queryClient.invalidateQueries({ queryKey: ['procurement-batches'] });
          window.location.href = `/procurement/${id}`;
        }}
      />
    </div>
  );
}
