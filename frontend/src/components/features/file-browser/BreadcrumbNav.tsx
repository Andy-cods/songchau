'use client';

import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  id: number | null;
  graph_item_id: string;
  name: string;
  is_folder: boolean;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  onNavigate: (graphItemId: string | null) => void;
}

export default function BreadcrumbNav({ items, onNavigate }: BreadcrumbNavProps) {
  return (
    <nav className="flex items-center gap-1 text-sm text-slate-600 overflow-x-auto">
      {items.map((crumb, idx) => {
        const isLast = idx === items.length - 1;
        const isRoot = crumb.graph_item_id === 'root';

        return (
          <div key={crumb.graph_item_id} className="flex items-center gap-1 shrink-0">
            {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            <button
              onClick={() => onNavigate(isRoot ? null : crumb.graph_item_id)}
              disabled={isLast}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors
                ${isLast
                  ? 'text-slate-900 font-medium cursor-default'
                  : 'hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                }`}
            >
              {isRoot && <Home className="w-3.5 h-3.5" />}
              <span className="whitespace-nowrap">{crumb.name}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
