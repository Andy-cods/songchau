'use client';

import { TopNav } from '@/components/layout/top-nav';
import { useAuth } from '@/providers/auth-provider';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return null;
  }

  // FIX (Thang 2026-06-21): thêm `dark:bg-white` belt-and-suspenders.
  // Nếu html.dark còn sót từ localStorage cũ, wrapper vẫn trắng → không thấy
  // vạch đen kể cả khi body bg chưa được apply. Sẽ revert khi Phase 2 dark-mode ship.
  return (
    <div className="min-h-screen bg-white dark:bg-white flex flex-col">
      <TopNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
