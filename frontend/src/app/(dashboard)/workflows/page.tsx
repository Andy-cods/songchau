'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { FileCheck, Check, X } from 'lucide-react';
import { getWorkflows, approveWorkflow, rejectWorkflow } from '@/services/workflows';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STATUS_CONFIG } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import type { Workflow, WorkflowStatus, PaginatedResponse } from '@/types/models';

// ─── Workflow type labels ──────────────────────────────────────

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  po_approval: 'Duyệt PO',
  payment_approval: 'Duyệt thanh toán',
  price_change: 'Thay đổi giá',
  supplier_onboard: 'NCC mới',
};

// ─── Column Definitions ────────────────────────────────────────

const columnHelper = createColumnHelper<Workflow>();

function ActionButtons({ workflow }: { workflow: Workflow }) {
  const queryClient = useQueryClient();

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  if (workflow.status !== 'pending_l1' && workflow.status !== 'pending_l2') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="default"
        className="h-7 px-2.5 text-xs"
        loading={approveMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          approveMutation.mutate(workflow.id);
        }}
      >
        <Check className="h-3 w-3" />
        Duyệt
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="h-7 px-2.5 text-xs"
        loading={rejectMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          rejectMutation.mutate(workflow.id);
        }}
      >
        <X className="h-3 w-3" />
        Từ chối
      </Button>
    </div>
  );
}

const columns = [
  columnHelper.accessor('title', {
    header: 'Tiêu đề',
    cell: (info) => (
      <div>
        <span className="text-sm font-medium text-slate-900">
          {info.getValue()}
        </span>
        {info.row.original.description && (
          <span className="block text-xs text-slate-400 truncate max-w-[240px]">
            {info.row.original.description}
          </span>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('workflow_type', {
    header: 'Loại',
    cell: (info) => (
      <span className="text-sm text-slate-700">
        {WORKFLOW_TYPE_LABELS[info.getValue()] || info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Trạng thái',
    cell: (info) => {
      const config = STATUS_CONFIG[info.getValue()];
      return config ? (
        <StatusBadge
          label={config.label}
          variant={config.variant}
          pulse={config.pulse}
        />
      ) : (
        <span className="text-sm text-slate-400">{info.getValue()}</span>
      );
    },
  }),
  columnHelper.display({
    id: 'initiator',
    header: 'Người tạo',
    cell: (info) => (
      <span className="text-sm text-slate-600">
        {info.row.original.initiator?.full_name || '—'}
      </span>
    ),
  }),
  columnHelper.accessor('created_at', {
    header: 'Ngày tạo',
    cell: (info) => (
      <span className="text-sm text-slate-500">{formatDate(info.getValue())}</span>
    ),
  }),
  columnHelper.display({
    id: 'actions',
    header: 'Hành động',
    enableSorting: false,
    cell: (info) => <ActionButtons workflow={info.row.original} />,
  }),
];

// ─── Page Component ────────────────────────────────────────────

export default function WorkflowsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');

  const { data, isLoading } = useQuery<PaginatedResponse<Workflow>>({
    queryKey: ['workflows', page, search, statusFilter],
    queryFn: () =>
      getWorkflows({
        page,
        page_size: 20,
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
  });

  const workflows = data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <PageHeader
        className="mb-6"
        icon={FileCheck}
        title="Phê duyệt"
        subtitle="Quản lý luồng phê duyệt và yêu cầu"
      />

      {/* Status filter */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-slate-500">Lọc theo trạng thái:</span>
        <Select
          value={statusFilter}
          onValueChange={(val) => {
            setStatusFilter(val as WorkflowStatus | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tất cả" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="pending_l1">Chờ duyệt cấp 1</SelectItem>
            <SelectItem value="pending_l2">Chờ duyệt cấp 2</SelectItem>
            <SelectItem value="approved">Đã duyệt</SelectItem>
            <SelectItem value="rejected">Từ chối</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={workflows}
        isLoading={isLoading}
        searchPlaceholder="Tìm kiếm theo tiêu đề, mã tham chiếu..."
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        pagination={
          data
            ? {
                page: data.page,
                pageSize: data.page_size,
                total: data.total,
                totalPages: data.total_pages,
              }
            : undefined
        }
        onPageChange={setPage}
        emptyState={
          <EmptyState
            icon={FileCheck}
            heading="Không có yêu cầu phê duyệt"
            description="Các yêu cầu phê duyệt sẽ hiển thị khi có đơn hàng hoặc thay đổi cần duyệt"
          />
        }
      />
    </div>
  );
}
