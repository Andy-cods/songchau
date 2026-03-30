'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Route → Vietnamese label mapping ─────────────────────────

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Tổng quan',
  'purchase-orders': 'Đơn mua hàng',
  deliveries: 'Vận chuyển',
  approvals: 'Phê duyệt',
  inventory: 'Kho hàng',
  bqms: 'BQMS',
  reports: 'Báo cáo',
  suppliers: 'Nhà cung cấp',
  users: 'Người dùng',
  settings: 'Cài đặt',
  notifications: 'Thông báo',
  workflows: 'Quy trình',
  audit: 'Nhật ký',
  new: 'Tạo mới',
  rfq: 'Yêu cầu báo giá',
  quotation: 'Báo giá',
};

function getLabel(segment: string): string | null {
  // Known segments
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];

  // Dynamic IDs like [id] — skip rendering
  if (/^[0-9a-f-]{8,}$/i.test(segment)) return null;

  // Fallback: capitalize
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

interface BreadcrumbItem {
  label: string;
  href: string;
}

export function Breadcrumb() {
  const pathname = usePathname();

  // Build crumbs from pathname segments
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];

  let currentPath = '';
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = getLabel(segment);
    if (label) {
      crumbs.push({ label, href: currentPath });
    }
  }

  // Don't render if we only have the dashboard crumb (home)
  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
      {/* Home icon */}
      <Link
        href="/dashboard"
        className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
        aria-label="Trang chủ"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;

        return (
          <span key={crumb.href} className="flex items-center gap-1.5 min-w-0">
            <ChevronRight className="h-3 w-3 text-slate-300 flex-shrink-0" />
            {isLast ? (
              <span
                className="text-sm text-slate-600 font-medium truncate"
                aria-current="page"
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className={cn(
                  'text-sm text-slate-400 hover:text-slate-600 transition-colors truncate'
                )}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
