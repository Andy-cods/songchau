'use client';

import { cn } from '@/lib/utils';

interface DateRange {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-slate-500 whitespace-nowrap">Từ ngày</label>
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-slate-500 whitespace-nowrap">Đến ngày</label>
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {(value.from || value.to) && (
        <button
          onClick={() => onChange({ from: '', to: '' })}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Xóa
        </button>
      )}
    </div>
  );
}
