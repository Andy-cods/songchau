'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down';
    value: string;
  };
  accentColor?: string; // Tailwind border color class, e.g. "border-brand-500"
  loading?: boolean;
  className?: string;
}

function KPICardSkeleton({ accentColor, className }: { accentColor?: string; className?: string }) {
  return (
    <div
      className={cn(
        'bg-white rounded-lg p-4 border-t-[3px] shadow-sm',
        accentColor || 'border-brand-500',
        className
      )}
    >
      <div className="h-3 w-24 bg-slate-200 rounded animate-pulse mb-3" />
      <div className="h-7 w-16 bg-slate-200 rounded animate-pulse mb-2" />
      <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
    </div>
  );
}

export function KPICard({
  label,
  value,
  trend,
  accentColor = 'border-brand-500',
  loading,
  className,
}: KPICardProps) {
  if (loading) {
    return <KPICardSkeleton accentColor={accentColor} className={className} />;
  }

  return (
    <div
      className={cn(
        'bg-white rounded-lg p-4 border-t-[3px] shadow-sm transition-shadow hover:shadow-md',
        accentColor,
        className
      )}
    >
      <p className="text-xs font-mono uppercase text-slate-400 tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-display font-bold text-slate-900 mt-1">
        {value}
      </p>
      {trend && (
        <div
          className={cn(
            'flex items-center gap-1 mt-1 text-xs font-medium',
            trend.direction === 'up' ? 'text-emerald-600' : 'text-red-600'
          )}
        >
          {trend.direction === 'up' ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          <span>{trend.value}</span>
        </div>
      )}
    </div>
  );
}
