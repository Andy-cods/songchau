'use client';

// Tổng quan: combined daily report + KPI charts on one scrollable page.
// Per user 2026-05-05: single landing for everything overview-related.
// Thang 2026-05-25: viewer (guest) bị redirect khỏi /dashboard — không
// được xem khối doanh thu/Win Rate/maker, chỉ vào /reports/daily được.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DailyReportPage from '@/app/(dashboard)/reports/daily/page';
import DashboardCharts from '@/app/(dashboard)/dashboard/charts/page';
import { useIsReadOnly } from '@/hooks/use-permissions';

export default function OverviewPage() {
  const router = useRouter();
  const isReadOnly = useIsReadOnly();

  useEffect(() => {
    if (isReadOnly) router.replace('/reports/daily');
  }, [isReadOnly, router]);

  if (isReadOnly) return null;

  return (
    <div className="space-y-10">
      <DailyReportPage />
      <div className="border-t border-slate-200 pt-8">
        <DashboardCharts />
      </div>
    </div>
  );
}
