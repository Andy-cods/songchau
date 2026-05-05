'use client';

// Tổng quan: combined daily report + KPI charts on one scrollable page.
// Per user 2026-05-05: single landing for everything overview-related.
import DailyReportPage from '@/app/(dashboard)/reports/daily/page';
import DashboardCharts from '@/app/(dashboard)/dashboard/charts/page';

export default function OverviewPage() {
  return (
    <div className="space-y-10">
      <DailyReportPage />
      <div className="border-t border-slate-200 pt-8">
        <DashboardCharts />
      </div>
    </div>
  );
}
