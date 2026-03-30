'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExportButtonProps {
  onClick: () => Promise<void>;
  label?: string;
  className?: string;
}

export function ExportButton({ onClick, label = 'Xuất Excel', className }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await onClick();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg',
        'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        'disabled:opacity-50 transition-colors',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </button>
  );
}
