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
  Scale,
  Contact,
  Mail,
  Scan,
  CalendarDays,
  Globe,
  CalendarOff,
  Award,
  CloudDownload,
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
  draft: { label: 'Nháp', variant: 'neutral' },
  pending_l1: { label: 'Chờ duyệt cấp 1', variant: 'warning', pulse: true },
  pending_l2: { label: 'Chờ duyệt cấp 2', variant: 'warning', pulse: true },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Từ chối', variant: 'danger' },
  cancelled: { label: 'Đã hủy', variant: 'neutral' },
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
  { key: 'bqms-won', label: 'Trúng BG', href: '/bqms/won-quotations', icon: Trophy },
  { key: 'giao-hang', label: 'Giao hàng', href: '/bqms/deliveries', icon: Truck },
  // Phase E (Thang 2026-05-13): Ẩn "Duyệt Vendor Portal" — báo giá giờ làm trực
  // tiếp ở /bqms (nút "Báo giá" cột Hành động), không cần duyệt manual riêng.
  // Component /admin/vendor-staging/page.tsx vẫn còn — accessible qua URL trực tiếp.
  // { key: 'vendor-staging', label: 'Duyệt Vendor Portal', href: '/admin/vendor-staging', icon: CloudDownload },
];

const NAV_IMV: SidebarItem[] = [
  { key: 'imv', label: 'IMV iMarketVietnam', href: '/imv', icon: Building2 },
];

// Merged 2026-05-04 per user request: Mua hàng + Khách hàng -> 1 group
const NAV_BUSINESS: SidebarItem[] = [
  { key: 'crm', label: 'Khách hàng', href: '/crm', icon: Contact },
  { key: 'procurement', label: 'Mua hàng', href: '/procurement', icon: ShoppingCart },
];

// Thang 2026-06-19: tách Đấu thầu NCC + Phân tích + Xếp hạng thành 1 nhóm riêng
// (trước đây rải ở "Khách hàng & Mua hàng" và "Phân tích"). 1 trung tâm quản lý NCC.
const NAV_VENDOR_BIDDING: SidebarItem[] = [
  { key: 'vendor-bidding', label: 'Phiên đấu thầu', href: '/vendor-bidding', icon: Award },
  { key: 'procurement-analytics', label: 'Phân tích đấu thầu', href: '/analytics/procurement', icon: BarChart3 },
  { key: 'vendor-scorecard', label: 'Xếp hạng NCC', href: '/analytics/vendor-scorecard', icon: Trophy },
];

// Consolidated 2026-05-04 per user request: 4 items -> 3.
// "Bảng kê HĐ quý" merged into "Hóa đơn" (accessible as a quarterly-view tab
// from inside /invoices). To restore standalone link, add the line back.
const NAV_FINANCE: SidebarItem[] = [
  { key: 'tai-chinh', label: 'Tài chính tổng hợp', href: '/finance/overview', icon: DollarSign },
  { key: 'invoices', label: 'Hóa đơn', href: '/finance/invoices', icon: Receipt },
  { key: 'payment-approvals', label: 'Duyệt thanh toán', href: '/finance/payment-approvals', icon: Banknote },
  { key: 'finance-reports', label: 'Báo cáo TC', href: '/finance/reports', icon: PieChart },
  // Thang 2026-07-04: GET /api/v1/finance/reconcile (đối soát AR/AP) đã có
  // backend từ lâu nhưng chưa FE nào gọi — thêm trang + mục điều hướng.
  { key: 'reconcile', label: 'Đối soát công nợ', href: '/finance/reconcile', icon: Scale },
];

const NAV_ANALYTICS: SidebarItem[] = [
  { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
  { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
  { key: 'sourcing', label: 'Thư viện nguồn cung', href: '/sourcing', icon: ClipboardList },
  // Thang 2026-07-02: BỎ "Dự báo nhu cầu" (/analytics/forecast) — dự báo số lượng bán
  //   vô nghĩa với mô hình báo giá RFQ + đường ống dữ liệu gãy. Trang redirect về price-trends.
  //   /analytics/xnk (mồ côi) redirect về /market-prices. Thay bằng Radar mã sắp bị hỏi lại + gộp giá đa nguồn.
  // Phân tích đấu thầu + Xếp hạng NCC đã chuyển sang nhóm "Đấu thầu NCC" (2026-06-19).
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
        { title: 'Đấu thầu NCC', items: NAV_VENDOR_BIDDING },
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
        { title: 'Đấu thầu NCC', items: NAV_VENDOR_BIDDING },
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
    // 'staff' (nhân viên văn phòng/KD — 6 user thật trong prod, DB role_enum)
    // có quyền backend giống hệt 'sales' trên mọi route dùng ở dưới đây
    // (dashboard, file-browser, procurement, crm, bqms, market-prices,
    // price-trends, sourcing, payment-approvals, hr đều require_role liệt kê
    // cả 'sales' lẫn 'staff') — tái dùng luôn cấu hình sidebar của sales
    // thay vì lặp lại (Thang 2026-07-04 gap audit: role 'staff' trước đây rơi
    // vào nhánh `default`, chỉ thấy Tổng quan + Quản lý tài liệu).
    case 'staff':
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
        // Sale tham gia phiên đấu thầu (không có quyền xem phân tích/xếp hạng — endpoint
        // require_role admin/manager/procurement/staff, sale sẽ 403 nên chỉ hiện phiên).
        { title: 'Đấu thầu NCC', items: [NAV_VENDOR_BIDDING[0]] },
        {
          title: 'Tài chính',
          // Sale chỉ thấy đề xuất TT của chính mình (backend auto-filter).
          items: [
            { key: 'payment-approvals', label: 'Đề xuất TT của tôi', href: '/finance/payment-approvals', icon: Banknote },
          ],
        },
        {
          title: 'Phân tích',
          items: [
            { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
            { key: 'price-trends', label: 'Xu hướng giá', href: '/analytics/price-trends', icon: TrendingUp },
            { key: 'sourcing', label: 'Thư viện nguồn cung', href: '/sourcing', icon: ClipboardList },
          ],
        },
        { title: 'Nhân sự', items: NAV_HR },
      ];

    case 'procurement':
      // 5 user thật trong prod (DB role_enum), trước đây rơi vào nhánh
      // `default`. Menu dưới đây CHỈ gồm route mà backend thực sự cho phép
      // procurement vào (đối chiếu require_role, Thang 2026-07-04):
      //   procurement.py, procurement_analytics.py, suppliers.py, imv.py,
      //   market_prices.py, sourcing.py, leave.py (hr), payment_requests.py
      //   đều liệt kê "procurement" trong allowed roles.
      // KHÔNG thêm: file-browser (documents), crm.py, bqms.py, price_analytics.py,
      // finance.py/finance_management.py — các route này KHÔNG cấp quyền
      // procurement → sẽ 403 nếu thêm vào đây.
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'dashboard', label: 'Tổng quan', href: '/dashboard', icon: LayoutDashboard },
          ],
        },
        { title: 'Mua hàng', items: NAV_BUSINESS.filter((item) => item.key === 'procurement') },
        { title: 'Đấu thầu NCC', items: NAV_VENDOR_BIDDING },
        { title: 'IMV iMarketVietnam', items: NAV_IMV },
        {
          title: 'Phân tích',
          items: [
            { key: 'market-prices', label: 'Tra cứu giá XNK', href: '/market-prices', icon: ClipboardList },
            { key: 'sourcing', label: 'Thư viện nguồn cung', href: '/sourcing', icon: ClipboardList },
          ],
        },
        {
          title: 'Nhà cung cấp',
          items: [
            { key: 'suppliers', label: 'Nhà cung cấp', href: '/suppliers', icon: Building2 },
          ],
        },
        {
          title: 'Tài chính',
          // Procurement chỉ thấy đề xuất TT của chính mình (backend auto-filter),
          // giống sale — payment_requests.py cấp quyền cho cả hai.
          items: [
            { key: 'payment-approvals', label: 'Đề xuất TT của tôi', href: '/finance/payment-approvals', icon: Banknote },
          ],
        },
        { title: 'Nhân sự', items: NAV_HR },
      ];

    case 'viewer':
      // Viewer = guest read-only. Per Thang 2026-05-25, viewer KHÔNG thấy "Trúng BG"
      // — chỉ BQMS + Giao hàng.
      return [
        {
          title: 'Tổng quan',
          items: [
            { key: 'daily-report', label: 'Báo cáo hàng ngày', href: '/reports/daily', icon: BarChart3 },
          ],
        },
        {
          title: 'BQMS Samsung',
          items: NAV_BQMS.filter((item) => item.key !== 'bqms-won'),
        },
      ];

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
  viewer: 'Khách (Xem)',
  procurement: 'Phòng mua hàng',
  staff: 'Nhân viên',
};

// ─── Currency Labels ────────────────────────────────────────────

export const CURRENCY_LABELS: Record<string, string> = {
  VND: 'VNĐ',
  USD: 'USD',
  RMB: 'CNY',
};
