'use client';

import { useState, useMemo } from 'react';
import { ClipboardList, Filter, Search } from 'lucide-react';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'APPROVE'
  | 'REJECT';

interface AuditEntry {
  id: string;
  timestamp: string;
  user_name: string;
  user_email: string;
  action: AuditAction;
  table_name: string;
  record_id: string;
  detail: string;
}

// ─── Mock data ───────────────────────────────────────────────────

const MOCK_AUDIT: AuditEntry[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    user_name: 'Nguyễn Văn Admin',
    user_email: 'admin@songchau.vn',
    action: 'CREATE',
    table_name: 'purchase_orders',
    record_id: 'PO-2026-001',
    detail: 'Tạo đơn mua hàng PO-2026-001 từ NCC Công ty TNHH ABC',
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    user_name: 'Trần Thị Bích',
    user_email: 'bich@songchau.vn',
    action: 'APPROVE',
    table_name: 'workflows',
    record_id: 'WF-0045',
    detail: 'Phê duyệt workflow WF-0045 cho PO-2026-001',
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
    user_name: 'Lê Hoàng Minh',
    user_email: 'minh@songchau.vn',
    action: 'UPDATE',
    table_name: 'suppliers',
    record_id: 'SUP-012',
    detail: 'Cập nhật điều khoản thanh toán nhà cung cấp: TT30 → TT45',
  },
  {
    id: '4',
    timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    user_name: 'Phạm Thị Lan',
    user_email: 'lan@songchau.vn',
    action: 'LOGIN',
    table_name: 'users',
    record_id: 'USR-007',
    detail: 'Đăng nhập từ IP 192.168.1.105',
  },
  {
    id: '5',
    timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    user_name: 'Nguyễn Văn Admin',
    user_email: 'admin@songchau.vn',
    action: 'DELETE',
    table_name: 'inventory',
    record_id: 'INV-093',
    detail: 'Xóa mục tồn kho: Ốc vít M8x30 (hết hàng vĩnh viễn)',
  },
  {
    id: '6',
    timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    user_name: 'Trần Thị Bích',
    user_email: 'bich@songchau.vn',
    action: 'REJECT',
    table_name: 'workflows',
    record_id: 'WF-0044',
    detail: 'Từ chối phê duyệt: Giá vượt ngưỡng cho phép 15%',
  },
  {
    id: '7',
    timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    user_name: 'Lê Hoàng Minh',
    user_email: 'minh@songchau.vn',
    action: 'CREATE',
    table_name: 'suppliers',
    record_id: 'SUP-020',
    detail: 'Thêm nhà cung cấp mới: Công ty Cổ phần XYZ',
  },
  {
    id: '8',
    timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    user_name: 'Phạm Thị Lan',
    user_email: 'lan@songchau.vn',
    action: 'LOGOUT',
    table_name: 'users',
    record_id: 'USR-007',
    detail: 'Đăng xuất khỏi hệ thống',
  },
  {
    id: '9',
    timestamp: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    user_name: 'Nguyễn Văn Admin',
    user_email: 'admin@songchau.vn',
    action: 'UPDATE',
    table_name: 'purchase_orders',
    record_id: 'PO-2026-000',
    detail: 'Cập nhật trạng thái: draft → pending_approval',
  },
  {
    id: '10',
    timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    user_name: 'Trần Thị Bích',
    user_email: 'bich@songchau.vn',
    action: 'APPROVE',
    table_name: 'workflows',
    record_id: 'WF-0043',
    detail: 'Phê duyệt workflow WF-0043 — PO trị giá 120.000.000 VNĐ',
  },
];

// ─── Action Badge ─────────────────────────────────────────────────

const ACTION_STYLES: Record<
  AuditAction,
  { label: string; className: string }
> = {
  CREATE: {
    label: 'Tạo mới',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  UPDATE: {
    label: 'Cập nhật',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  DELETE: {
    label: 'Xóa',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  LOGIN: {
    label: 'Đăng nhập',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  LOGOUT: {
    label: 'Đăng xuất',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  APPROVE: {
    label: 'Phê duyệt',
    className: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  REJECT: {
    label: 'Từ chối',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

function ActionBadge({ action }: { action: AuditAction }) {
  const cfg = ACTION_STYLES[action] ?? {
    label: action,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        cfg.className
      )}
    >
      {cfg.label}
    </span>
  );
}

// ─── Table names ─────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  purchase_orders: 'Đơn mua hàng',
  suppliers: 'Nhà cung cấp',
  workflows: 'Phê duyệt',
  users: 'Người dùng',
  inventory: 'Kho hàng',
  deliveries: 'Vận chuyển',
};

// ─── Main Component ───────────────────────────────────────────────

export default function AuditLogPage() {
  const [filterAction, setFilterAction] = useState<AuditAction | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return MOCK_AUDIT.filter((entry) => {
      const matchAction =
        filterAction === 'ALL' || entry.action === filterAction;
      const searchLower = search.toLowerCase();
      const matchSearch =
        !search ||
        entry.user_name.toLowerCase().includes(searchLower) ||
        entry.table_name.toLowerCase().includes(searchLower) ||
        entry.record_id.toLowerCase().includes(searchLower) ||
        entry.detail.toLowerCase().includes(searchLower);
      return matchAction && matchSearch;
    });
  }, [filterAction, search]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Nhật ký hệ thống
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Theo dõi mọi hoạt động trong hệ thống (dữ liệu mẫu)
          </p>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-xs text-amber-700 font-medium">Dữ liệu mẫu — API chưa sẵn sàng</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search */}
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm người dùng, bảng, ID..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Action filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {(['ALL', ...Object.keys(ACTION_STYLES)] as (AuditAction | 'ALL')[]).map(
              (action) => (
                <button
                  key={action}
                  onClick={() => setFilterAction(action)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded border transition-colors',
                    filterAction === action
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                  )}
                >
                  {action === 'ALL'
                    ? 'Tất cả'
                    : ACTION_STYLES[action as AuditAction].label}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <ClipboardList className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400">Không có kết quả nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {[
                    'Thời gian',
                    'Người dùng',
                    'Hành động',
                    'Bảng',
                    'ID',
                    'Chi tiết',
                  ].map((h) => (
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
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Thời gian */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <p className="text-xs font-mono text-slate-600">
                          {formatRelativeTime(entry.timestamp)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(entry.timestamp).toLocaleTimeString(
                            'vi-VN',
                            { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                          )}{' '}
                          {formatDate(entry.timestamp)}
                        </p>
                      </div>
                    </td>

                    {/* Người dùng */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <p className="text-sm text-slate-800 font-medium">
                          {entry.user_name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {entry.user_email}
                        </p>
                      </div>
                    </td>

                    {/* Hành động */}
                    <td className="px-4 py-3">
                      <ActionBadge action={entry.action} />
                    </td>

                    {/* Bảng */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {TABLE_LABELS[entry.table_name] ?? entry.table_name}
                      </span>
                    </td>

                    {/* ID */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-mono text-indigo-600">
                        {entry.record_id}
                      </span>
                    </td>

                    {/* Chi tiết */}
                    <td className="px-4 py-3 max-w-[300px]">
                      <p className="text-sm text-slate-600 truncate" title={entry.detail}>
                        {entry.detail}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count */}
      <div className="mt-3 text-xs text-slate-400">
        Hiển thị {filtered.length} / {MOCK_AUDIT.length} bản ghi
      </div>
    </div>
  );
}
