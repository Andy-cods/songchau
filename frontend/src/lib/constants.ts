import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  FileCheck,
  Package,
  Users,
  BarChart3,
  Settings,
  Building2,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole, POStatus, DeliveryStatus, WorkflowStatus } from '@/types/models';

// ─── Status Badge Configs ───────────────────────────────────────

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusConfig {
  label: string;
  variant: StatusVariant;
  pulse?: boolean;
}

/** Workflow / Approval status configuration */
export const STATUS_CONFIG: Record<WorkflowStatus, StatusConfig> = {
  pending: { label: 'Chờ duyệt', variant: 'warning', pulse: true },
  in_review: { label: 'Đang xem xét', variant: 'info', pulse: true },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Từ chối', variant: 'danger' },
  escalated: { label: 'Chuyển cấp trên', variant: 'warning', pulse: true },
};

/** Purchase Order status configuration */
export const PO_STATUS_CONFIG: Record<POStatus, StatusConfig> = {
  draft: { label: 'Nháp', variant: 'neutral' },
  pending_approval: { label: 'Chờ duyệt', variant: 'warning', pulse: true },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Từ chối', variant: 'danger' },
  ordered: { label: 'Đã đặt hàng', variant: 'info' },
  in_transit: { label: 'Đang vận chuyển', variant: 'info', pulse: true },
  partial_received: { label: 'Nhận một phần', variant: 'warning' },
  received: { label: 'Đã nhận hàng', variant: 'success' },
  completed: { label: 'Hoàn tất', variant: 'success' },
  cancelled: { label: 'Đã hủy', variant: 'neutral' },
};

/** Delivery status configuration */
export const DELIVERY_STATUS_CONFIG: Record<DeliveryStatus, StatusConfig> = {
  pending: { label: 'Chờ lấy hàng', variant: 'neutral' },
  picked_up: { label: 'Đã lấy hàng', variant: 'info' },
  in_transit: { label: 'Đang vận chuyển', variant: 'info', pulse: true },
  customs_clearance: { label: 'Thông quan', variant: 'warning', pulse: true },
  delivered: { label: 'Đã giao', variant: 'success' },
  completed: { label: 'Hoàn tất', variant: 'success' },
};

// ─── Sidebar Navigation ────────────────────────────────────────

export interface SidebarItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const NAV_MAIN: SidebarItem[] = [
  { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
  { key: 'purchase-orders', label: 'Đơn mua hàng', href: '/purchase-orders', icon: ShoppingCart },
  { key: 'deliveries', label: 'Vận chuyển', href: '/deliveries', icon: Truck },
  { key: 'approvals', label: 'Phê duyệt', href: '/approvals', icon: FileCheck },
  { key: 'inventory', label: 'Kho hàng', href: '/inventory', icon: Package },
];

const NAV_BQMS: SidebarItem[] = [
  { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
  { key: 'reports', label: 'Báo cáo', href: '/reports', icon: BarChart3 },
];

const NAV_ADMIN: SidebarItem[] = [
  { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
  { key: 'users', label: 'Người dùng', href: '/users', icon: Users },
  { key: 'settings', label: 'Cài đặt', href: '/settings', icon: Settings },
];

/**
 * Get sidebar sections based on user role.
 */
export function getSidebarConfig(role: UserRole): SidebarSection[] {
  switch (role) {
    case 'admin':
      return [
        { title: 'Chính', items: NAV_MAIN },
        { title: 'Quản lý', items: NAV_BQMS },
        { title: 'Hệ thống', items: NAV_ADMIN },
      ];

    case 'director':
    case 'manager':
      return [
        { title: 'Chính', items: NAV_MAIN },
        { title: 'Quản lý', items: NAV_BQMS },
        {
          title: 'Hệ thống',
          items: [
            { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
          ],
        },
      ];

    case 'accountant':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'purchase-orders', label: 'Đơn mua hàng', href: '/purchase-orders', icon: ShoppingCart },
            { key: 'approvals', label: 'Phê duyệt', href: '/approvals', icon: FileCheck },
          ],
        },
        { title: 'Quản lý', items: [{ key: 'reports', label: 'Báo cáo', href: '/reports', icon: BarChart3 }] },
      ];

    case 'warehouse':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'deliveries', label: 'Vận chuyển', href: '/deliveries', icon: Truck },
            { key: 'inventory', label: 'Kho hàng', href: '/inventory', icon: Package },
          ],
        },
      ];

    case 'sales':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'purchase-orders', label: 'Đơn mua hàng', href: '/purchase-orders', icon: ShoppingCart },
            { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
          ],
        },
      ];

    case 'viewer':
    default:
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'reports', label: 'Báo cáo', href: '/reports', icon: BarChart3 },
          ],
        },
      ];
  }
}

// ─── Role Labels ────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Quản trị viên',
  director: 'Giám đốc',
  manager: 'Quản lý',
  accountant: 'Kế toán',
  warehouse: 'Kho vận',
  sales: 'Kinh doanh',
  viewer: 'Xem',
};

// ─── Currency Labels ────────────────────────────────────────────

export const CURRENCY_LABELS: Record<string, string> = {
  VND: 'VNĐ',
  USD: 'USD',
  RMB: 'CNY',
};
