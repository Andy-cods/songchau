'use client';

import { useState } from 'react';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  Package,
  TrendingUp,
  Clock,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface ReportCard {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  comingSoon: boolean;
}

// ─── Report definitions ───────────────────────────────────────────

const REPORTS: ReportCard[] = [
  {
    id: 'revenue',
    icon: TrendingUp,
    title: 'Báo cáo doanh thu tháng',
    description:
      'Thống kê tổng giá trị đơn hàng, tình trạng thanh toán và so sánh theo tháng.',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-100',
    comingSoon: true,
  },
  {
    id: 'supplier',
    icon: Building2,
    title: 'Báo cáo NCC',
    description:
      'Tổng hợp hiệu suất nhà cung cấp: đúng hạn giao hàng, chất lượng, giá cả.',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-100',
    comingSoon: true,
  },
  {
    id: 'bqms',
    icon: ClipboardCheck,
    title: 'Báo cáo BQMS',
    description:
      'Phân tích tỷ lệ thắng thầu, tổng giá trị hợp đồng và xu hướng theo quý.',
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-100',
    comingSoon: true,
  },
  {
    id: 'inventory',
    icon: Package,
    title: 'Báo cáo tồn kho',
    description:
      'Tình trạng kho: hàng tồn, hàng sắp hết, vòng quay tồn kho theo danh mục.',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-100',
    comingSoon: true,
  },
];

// ─── Toast notification ───────────────────────────────────────────

interface ToastProps {
  title: string;
  onClose: () => void;
}

function ComingSoonToast({ title, onClose }: ToastProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-start gap-3 bg-white border border-slate-200 shadow-lg rounded-xl p-4 max-w-sm animate-in slide-in-from-bottom-4 duration-200">
      <div className="p-2 bg-indigo-50 rounded-lg flex-shrink-0">
        <Clock className="h-4 w-4 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">Sắp ra mắt</p>
        <p className="text-xs text-slate-500 mt-0.5">
          &ldquo;{title}&rdquo; đang được phát triển.
        </p>
      </div>
      <button
        onClick={onClose}
        className="p-1 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Card component ───────────────────────────────────────────────

function ReportCardItem({
  report,
  onRequest,
}: {
  report: ReportCard;
  onRequest: (title: string) => void;
}) {
  const Icon = report.icon;

  return (
    <div
      className={cn(
        'bg-white rounded-xl shadow-sm border p-6 flex flex-col gap-4 transition-all duration-200 hover:shadow-md',
        report.borderColor
      )}
    >
      {/* Icon + Coming soon */}
      <div className="flex items-start justify-between">
        <div className={cn('p-3 rounded-xl', report.bgColor)}>
          <Icon className={cn('h-6 w-6', report.color)} />
        </div>
        {report.comingSoon && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Clock className="h-2.5 w-2.5" />
            Sắp ra mắt
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-slate-800 mb-1.5">
          {report.title}
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          {report.description}
        </p>
      </div>

      {/* Action */}
      <button
        onClick={() => onRequest(report.title)}
        className={cn(
          'w-full py-2 px-4 text-sm font-medium rounded-lg border transition-all duration-150',
          'border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
        )}
      >
        Tạo báo cáo
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────

export default function ReportsPage() {
  const [toastTitle, setToastTitle] = useState<string | null>(null);

  const handleRequest = (title: string) => {
    setToastTitle(title);
    setTimeout(() => setToastTitle(null), 4000);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Báo cáo
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Xuất báo cáo thống kê và phân tích dữ liệu
          </p>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <BarChart3 className="h-4 w-4 text-indigo-400" />
          <span>{REPORTS.length} loại báo cáo</span>
        </div>
      </div>

      {/* Coming soon banner */}
      <div className="mb-6 flex items-center gap-3 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
        <div className="p-2 bg-indigo-100 rounded-lg flex-shrink-0">
          <Clock className="h-4 w-4 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-indigo-800">
            Module báo cáo đang được phát triển
          </p>
          <p className="text-xs text-indigo-600 mt-0.5">
            Các báo cáo sẽ được tích hợp đầy đủ trong phiên bản tiếp theo.
            Bạn có thể đăng ký nhận thông báo khi sẵn sàng.
          </p>
        </div>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {REPORTS.map((report) => (
          <ReportCardItem
            key={report.id}
            report={report}
            onRequest={handleRequest}
          />
        ))}
      </div>

      {/* Coming soon toast */}
      {toastTitle && (
        <ComingSoonToast
          title={toastTitle}
          onClose={() => setToastTitle(null)}
        />
      )}
    </div>
  );
}
