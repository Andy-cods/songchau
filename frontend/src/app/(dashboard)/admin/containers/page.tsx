'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Server,
  Loader2,
  ChevronRight,
  X,
  Terminal,
  Cpu,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ───────────────────────────────────────────────────────

interface ContainerInfo {
  name: string;
  status: string;
  memory_limit: string;
  uptime: string;
}

interface ContainerLogs {
  container: string;
  logs: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes('up') || s === 'running') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (s.includes('restart')) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function statusDotClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes('up') || s === 'running') return 'bg-emerald-400';
  if (s.includes('restart')) return 'bg-amber-400 animate-pulse';
  return 'bg-red-400';
}

function cardBorderClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes('up') || s === 'running') return 'border-emerald-100 hover:border-emerald-200';
  if (s.includes('restart')) return 'border-amber-100 hover:border-amber-200';
  return 'border-red-100 hover:border-red-200';
}

// ─── Log Viewer Modal ─────────────────────────────────────────────

function LogViewer({
  containerName,
  onClose,
}: {
  containerName: string;
  onClose: () => void;
}) {
  const { data: logsRaw, isLoading } = useQuery({
    queryKey: ['container-logs', containerName],
    queryFn: () =>
      api.get<{ data: ContainerLogs }>(
        `/api/v1/containers/logs/${containerName}?lines=50`
      ),
    refetchInterval: 5_000,
  });

  const logs: string = logsRaw?.data?.logs ?? (logsRaw as any)?.logs ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-mono font-medium text-slate-900">{containerName}</span>
            <span className="text-xs text-slate-500">— 50 dòng cuối</span>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <button
              onClick={onClose}
              className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Logs */}
        <div className="flex-1 bg-slate-950 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-slate-500 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-mono">Đang tải logs...</span>
            </div>
          ) : logs ? (
            <pre className="text-xs font-mono text-slate-200 p-4 whitespace-pre-wrap leading-relaxed">
              {logs}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500">
              <span className="text-sm font-mono">Không có log</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Container Card ────────────────────────────────────────────────

function ContainerCard({
  container,
  onClick,
}: {
  container: ContainerInfo;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-white rounded-xl border shadow-sm p-4 text-left transition-all hover:shadow-md group w-full',
        cardBorderClass(container.status)
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('h-2 w-2 rounded-full flex-shrink-0', statusDotClass(container.status))} />
          <span className="text-sm font-mono font-semibold text-slate-800 truncate">
            {container.name}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 transition-colors" />
      </div>

      <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', statusBadgeClass(container.status))}>
        {container.status}
      </span>

      <div className="mt-3 space-y-1.5">
        {container.memory_limit && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            <span>Bộ nhớ: {container.memory_limit}</span>
          </div>
        )}
        {container.uptime && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span>Uptime: {container.uptime}</span>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-400 group-hover:text-brand-600 transition-colors">
        Nhấn để xem logs →
      </p>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function ContainersPage() {
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);

  const { data: containersRaw, isLoading } = useQuery({
    queryKey: ['containers-list'],
    queryFn: () => api.get<{ data: ContainerInfo[] }>('/api/v1/containers'),
    refetchInterval: 15_000,
  });

  const containers: ContainerInfo[] = containersRaw?.data ?? (containersRaw as any) ?? [];

  const upCount = containers.filter(
    (c) => c.status.toLowerCase().includes('up') || c.status.toLowerCase() === 'running'
  ).length;

  const downCount = containers.filter(
    (c) => !c.status.toLowerCase().includes('up') && c.status.toLowerCase() !== 'running'
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Server}
        title="Containers"
        subtitle="Theo dõi trạng thái và logs containers"
        actions={
          !isLoading && containers.length > 0 ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {upCount} hoạt động
              </span>
              {downCount > 0 && (
                <span className="flex items-center gap-1.5 text-red-600">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  {downCount} dừng
                </span>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Container Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : containers.length === 0 ? (
        <EmptyState
          icon={Server}
          heading="Không có dữ liệu container"
          className="py-12"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {containers.map((c) => (
            <ContainerCard
              key={c.name}
              container={c}
              onClick={() => setSelectedContainer(c.name)}
            />
          ))}
        </div>
      )}

      {/* Log Viewer Modal */}
      {selectedContainer && (
        <LogViewer
          containerName={selectedContainer}
          onClose={() => setSelectedContainer(null)}
        />
      )}
    </div>
  );
}
