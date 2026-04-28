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
  FileSpreadsheet,
  Brain,
  TrendingUp,
  Trophy,
  Calendar,
  FileText,
  Ship,
  Receipt,
  Link2,
  ListTodo,
  DollarSign,
  Bell,
  Activity,
  AlertTriangle,
  RotateCcw,
  Server,
  HardDrive,
  ShieldCheck,
  FolderOpen,
  Shield,
  Eye,
  BookOpen,
  CreditCard,
  Banknote,
  PieChart,
  Contact,
  Mail,
  Scan,
  CalendarDays,
  Globe,
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

export const STATUS_CONFIG: Record<WorkflowStatus, StatusConfig> = {
  pending: { label: 'Chờ duyệt', variant: 'warning', pulse: true },
  in_review: { label: 'Đang xem xét', variant: 'info', pulse: true },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Từ chối', variant: 'danger' },
  escalated: { label: 'Chuyển cấp trên', variant: 'warning', pulse: true },
};

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

// ═══ NAV GROUPS (theo yêu cầu mới) ═══════════════════════════

const NAV_MAIN: SidebarItem[] = [
  { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
  { key: 'daily-report', label: 'Báo cáo hàng ngày', href: '/reports/daily', icon: BarChart3 },
  { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
  // Ẩn: Kho hàng, Đơn mua hàng, Vận chuyển, Phê duyệt
];

const NAV_BQMS: SidebarItem[] = [
  { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
  { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
  { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
  // Tra cứu giá nội bộ đã tích hợp vào thanh tìm kiếm (Ctrl+K) — không cần mục riêng
  // Gộp: Tạo BG, Lịch sử BG, Template, RFQ → tất cả trong mục BQMS
  // Ẩn: Lọc đơn AI, Báo cáo (chờ phát triển)
];

const NAV_PROCUREMENT: SidebarItem[] = [
  { key: 'procurement', label: 'Mua hàng', href: '/procurement', icon: ShoppingCart },
];

const NAV_FINANCE: SidebarItem[] = [
  { key: 'tai-chinh', label: 'Tài chính tổng hợp', href: '/finance/overview', icon: DollarSign },
  { key: 'invoices', label: 'Hóa đơn', href: '/invoices', icon: Receipt },
  { key: 'quarterly-invoices', label: 'Bảng kê HĐ quý', href: '/finance/quarterly-invoices', icon: Receipt },
  { key: 'finance-reports', label: 'Báo cáo TC', href: '/finance/reports', icon: PieChart },
];

const NAV_CRM: SidebarItem[] = [
  { key: 'crm', label: 'Khách hàng', href: '/crm', icon: Contact },
];

const NAV_ANALYTICS: SidebarItem[] = [
  { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
  // Ẩn: Win/Loss, Báo cáo tự động, Chuỗi doanh thu, Lợi nhuận (có thể mở lại sau)
];

const NAV_ADMIN: SidebarItem[] = [
  { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
  { key: 'users', label: 'Người dùng', href: '/users', icon: Users },
  { key: 'settings', label: 'Cài đặt', href: '/settings', icon: Settings },
];

// ═══ SIDEBAR CONFIG PER ROLE ═══════════════════════════════════

export function getSidebarConfig(role: UserRole): SidebarSection[] {
  switch (role) {
    case 'admin':
      return [
        { title: 'Tổng quan', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'Mua hàng', items: NAV_PROCUREMENT },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Khách hàng', items: NAV_CRM },
        { title: 'Phân tích', items: NAV_ANALYTICS },
        { title: 'Hệ thống', items: NAV_ADMIN },
      ];

    case 'director':
    case 'manager':
      return [
        { title: 'Tổng quan', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'Mua hàng', items: NAV_PROCUREMENT },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Khách hàng', items: NAV_CRM },
        { title: 'Phân tích', items: NAV_ANALYTICS },
      ];

    case 'accountant':
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
          ],
        },
        { title: 'Tài chính', items: NAV_FINANCE },
      ];

    case 'warehouse':
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
            { key: 'inventory', label: 'Kho hàng', href: '/inventory', icon: Package },
            { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
          ],
        },
      ];

    case 'sales':
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'daily-report', label: 'Báo cáo hàng ngày', href: '/reports/daily', icon: BarChart3 },
            { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
            { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
            { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
          ],
        },
        { title: 'Khách hàng', items: NAV_CRM },
        {
          title: 'Phân tích',
          items: [
            { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
          ],
        },
      ];

    case 'viewer':
    default:
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
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
