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
  CalendarOff,
  Award,
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
  // /dashboard now renders the daily report AND KPI charts combined on one
  // scrollable page (per user 2026-05-05). No separate "Báo cáo hàng ngày"
  // or "KPI & Biểu đồ" entries -- everything overview-related lives here.
  { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
  { key: 'documents', label: 'Quản lý tài liệu', href: '/documents/browser', icon: FolderOpen },
];

const NAV_BQMS: SidebarItem[] = [
  { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
  { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
  // Tra cứu giá XNK đã chuyển sang nhóm "Phân tích" (NAV_ANALYTICS)
  // Tra cứu giá nội bộ đã tích hợp vào thanh tìm kiếm (Ctrl+K) — không cần mục riêng
];

const NAV_IMV: SidebarItem[] = [
  { key: 'imv', label: 'IMV iMarketVietnam', href: '/imv', icon: Building2 },
];

// Merged 2026-05-04 per user request: Mua hàng + Khách hàng -> 1 group
const NAV_BUSINESS: SidebarItem[] = [
  { key: 'crm', label: 'Khách hàng', href: '/crm', icon: Contact },
  { key: 'procurement', label: 'Mua hàng', href: '/procurement', icon: ShoppingCart },
];

// Consolidated 2026-05-04 per user request: 4 items -> 3.
// "Bảng kê HĐ quý" merged into "Hóa đơn" (accessible as a quarterly-view tab
// from inside /invoices). To restore standalone link, add the line back.
const NAV_FINANCE: SidebarItem[] = [
  { key: 'tai-chinh', label: 'Tài chính tổng hợp', href: '/finance/overview', icon: DollarSign },
  { key: 'invoices', label: 'Hóa đơn', href: '/invoices', icon: Receipt },
  { key: 'finance-reports', label: 'Báo cáo TC', href: '/finance/reports', icon: PieChart },
];

const NAV_ANALYTICS: SidebarItem[] = [
  { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
  { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
  // Ẩn: Win/Loss, Báo cáo tự động, Chuỗi doanh thu, Lợi nhuận (có thể mở lại sau)
];

const NAV_ADMIN: SidebarItem[] = [
  { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
  { key: 'users', label: 'Người dùng', href: '/users', icon: Users },
  { key: 'settings', label: 'Cài đặt', href: '/settings', icon: Settings },
];

// M41 — Nhân sự (HR): nghỉ phép + đi muộn cho mọi role.
const NAV_HR: SidebarItem[] = [
  { key: 'hr', label: 'Nghỉ phép & Chuyên cần', href: '/hr', icon: CalendarOff },
];

// M40 — Năng suất nhân viên: chỉ manager / admin xem được.
const NAV_HR_PERFORMANCE: SidebarItem[] = [
  { key: 'hr-performance', label: 'Năng suất nhân viên', href: '/hr/performance', icon: Award },
];

// ═══ SIDEBAR CONFIG PER ROLE ═══════════════════════════════════

export function getSidebarConfig(role: UserRole): SidebarSection[] {
  switch (role) {
    case 'admin':
      return [
        { title: 'Tổng quan', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'IMV iMarketVietnam', items: NAV_IMV },
        { title: 'Khách hàng & Mua hàng', items: NAV_BUSINESS },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Phân tích', items: NAV_ANALYTICS },
        { title: 'Nhân sự', items: [...NAV_HR, ...NAV_HR_PERFORMANCE] },
        { title: 'Hệ thống', items: NAV_ADMIN },
      ];

    case 'director':
    case 'manager':
      return [
        { title: 'Tổng quan', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'IMV iMarketVietnam', items: NAV_IMV },
        { title: 'Khách hàng & Mua hàng', items: NAV_BUSINESS },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Phân tích', items: NAV_ANALYTICS },
        { title: 'Nhân sự', items: [...NAV_HR, ...NAV_HR_PERFORMANCE] },
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
        { title: 'Nhân sự', items: NAV_HR },
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
        { title: 'Nhân sự', items: NAV_HR },
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
        { title: 'Khách hàng & Mua hàng', items: NAV_BUSINESS },
        {
          title: 'Phân tích',
          items: [
            { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
            { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
          ],
        },
        { title: 'Nhân sự', items: NAV_HR },
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
