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

  return (
    <div className="min-h-screen bg-slate-50/40 flex flex-col">
      <TopNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
