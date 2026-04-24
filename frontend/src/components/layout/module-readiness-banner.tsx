'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Info, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModuleReadinessByPath, getModuleReadinessMeta } from '@/lib/module-readiness';

export function ModuleReadinessBanner() {
  const pathname = usePathname();
  const moduleReadiness = getModuleReadinessByPath(pathname);

  if (!moduleReadiness || moduleReadiness.status === 'live') {
    return null;
  }

  const readinessMeta = getModuleReadinessMeta(moduleReadiness.status);

  return (
    <section className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-slate-50 p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Wrench className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {moduleReadiness.label}
                </h2>
                {readinessMeta && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                      readinessMeta.badgeClassName
                    )}
                  >
                    {readinessMeta.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {moduleReadiness.summary}
              </p>
            </div>
          </div>

          {moduleReadiness.notes.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Info className="h-3.5 w-3.5" />
                Trạng thái hiện tại
              </div>
              <div className="space-y-2">
                {moduleReadiness.notes.map((note) => (
                  <p key={note} className="text-sm leading-6 text-slate-600">
                    {note}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {moduleReadiness.recommendedActions.length > 0 && (
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white/80 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Hành động thay thế
            </div>
            <div className="space-y-2">
              {moduleReadiness.recommendedActions.map((action) => (
                <Link
                  key={`${moduleReadiness.key}-${action.href}`}
                  href={action.href}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span>{action.label}</span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
