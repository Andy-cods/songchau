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
  RefreshCw,
  RotateCcw,
  Server,
  HardDrive,
  ShieldCheck,
  FolderOpen,
  Shield,
  Eye,
  HelpCircle,
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
  { key: 'kho-hang', label: 'Kho hàng', href: '/inventory', icon: Package },
  { key: 'documents', label: 'Tài liệu', href: '/documents', icon: FolderOpen },
  { key: 'file-browser', label: 'Duyệt file OneDrive', href: '/documents/browser', icon: HardDrive },
  { key: 'help', label: 'Hướng dẫn', href: '/help', icon: HelpCircle },
  // Ẩn: Đơn mua hàng, Vận chuyển, Phê duyệt
];

const NAV_BQMS: SidebarItem[] = [
  { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
  { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
  // Gộp: Tạo BG, Lịch sử BG, Template, RFQ → tất cả trong mục BQMS
  // Ẩn: Lọc đơn AI, Báo cáo (chờ phát triển)
];

const NAV_FINANCE: SidebarItem[] = [
  { key: 'tai-chinh', label: 'Tài chính tổng hợp', href: '/finance/overview', icon: DollarSign },
  { key: 'invoices', label: 'Hóa đơn', href: '/invoices', icon: Receipt },
  { key: 'finance-reports', label: 'Báo cáo TC', href: '/finance/reports', icon: PieChart },
  // Gộp: Công nợ trả + Công nợ thu + Sổ quỹ → "Tài chính tổng hợp"
  // OCR tích hợp trong Hóa đơn
];

const NAV_CRM: SidebarItem[] = [
  { key: 'crm', label: 'Khách hàng', href: '/crm', icon: Contact },
];

const NAV_ANALYTICS: SidebarItem[] = [
  { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
  // Ẩn: Win/Loss, Báo cáo tự động, Chuỗi doanh thu, Lợi nhuận (có thể mở lại sau)
];

const NAV_OPERATIONS: SidebarItem[] = [
  { key: 'inventory-forecast', label: 'Kho thông minh', href: '/inventory/forecast', icon: Package },
  { key: 'tasks', label: 'Công việc', href: '/tasks', icon: ListTodo },
  { key: 'workload', label: 'Phân công', href: '/tasks/workload', icon: Users },
  { key: 'calendar', label: 'Lịch', href: '/calendar', icon: CalendarDays },
  { key: 'notifications', label: 'Thông báo', href: '/notifications/settings', icon: Bell },
];

const NAV_ADVANCED: SidebarItem[] = [
  { key: 'emails', label: 'Email Samsung', href: '/bqms/emails', icon: Mail },
  { key: 'forecast', label: 'Dự báo', href: '/analytics/forecast', icon: TrendingUp },
];

const NAV_ADMIN: SidebarItem[] = [
  { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
  { key: 'users', label: 'Người dùng', href: '/users', icon: Users },
  { key: 'settings', label: 'Cài đặt', href: '/settings', icon: Settings },
  { key: 'language', label: 'Ngôn ngữ', href: '/settings/language', icon: Globe },
  { key: 'performance', label: 'Hiệu suất', href: '/admin/performance', icon: Activity },
  { key: 'errors', label: 'Lỗi hệ thống', href: '/admin/errors', icon: AlertTriangle },
  { key: 'migration', label: 'Đồng bộ dữ liệu', href: '/admin/migration', icon: RefreshCw },
  { key: 'containers', label: 'Containers', href: '/admin/containers', icon: Server },
  { key: 'backups', label: 'Backup', href: '/admin/backups', icon: HardDrive },
  { key: 'data-quality', label: 'Chất lượng DL', href: '/admin/data-quality', icon: ShieldCheck },
  { key: 'security-log', label: 'Bảo mật', href: '/admin/security-log', icon: Shield },
  { key: 'audit', label: 'Audit Log', href: '/audit', icon: Eye },
];

// ═══ SIDEBAR CONFIG PER ROLE ═══════════════════════════════════

export function getSidebarConfig(role: UserRole): SidebarSection[] {
  switch (role) {
    case 'admin':
      return [
        { title: 'Chính', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Khách hàng', items: NAV_CRM },
        { title: 'Phân tích', items: NAV_ANALYTICS },
        { title: 'Vận hành', items: NAV_OPERATIONS },
        { title: 'Nâng cao', items: NAV_ADVANCED },
        { title: 'Hệ thống', items: NAV_ADMIN },
      ];

    case 'director':
    case 'manager':
      return [
        { title: 'Chính', items: NAV_MAIN },
        { title: 'BQMS Samsung', items: NAV_BQMS },
        { title: 'Tài chính', items: NAV_FINANCE },
        { title: 'Khách hàng', items: NAV_CRM },
        { title: 'Phân tích', items: NAV_ANALYTICS },
        { title: 'Vận hành', items: NAV_OPERATIONS },
        { title: 'Nâng cao', items: NAV_ADVANCED },
      ];

    case 'accountant':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'documents', label: 'Tài liệu', href: '/documents', icon: FolderOpen },
            { key: 'file-browser', label: 'Duyệt file OneDrive', href: '/documents/browser', icon: HardDrive },
            { key: 'help', label: 'Hướng dẫn', href: '/help', icon: HelpCircle },
          ],
        },
        { title: 'Tài chính', items: NAV_FINANCE },
      ];

    case 'warehouse':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
            { key: 'inventory', label: 'Kho hàng', href: '/inventory', icon: Package },
            { key: 'documents', label: 'Tài liệu', href: '/documents', icon: FolderOpen },
            { key: 'file-browser', label: 'Duyệt file OneDrive', href: '/documents/browser', icon: HardDrive },
          ],
        },
        {
          title: 'Vận hành',
          items: [
            { key: 'inventory-forecast', label: 'Kho thông minh', href: '/inventory/forecast', icon: Package },
            { key: 'tasks', label: 'Công việc', href: '/tasks', icon: ListTodo },
          ],
        },
      ];

    case 'sales':
      return [
        {
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'bqms', label: 'BQMS', href: '/bqms', icon: ClipboardList },
            { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
            { key: 'documents', label: 'Tài liệu', href: '/documents', icon: FolderOpen },
            { key: 'file-browser', label: 'Duyệt file OneDrive', href: '/documents/browser', icon: HardDrive },
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
          title: 'Chính',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
            { key: 'documents', label: 'Tài liệu', href: '/documents', icon: FolderOpen },
            { key: 'file-browser', label: 'Duyệt file OneDrive', href: '/documents/browser', icon: HardDrive },
            { key: 'help', label: 'Hướng dẫn', href: '/help', icon: HelpCircle },
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
