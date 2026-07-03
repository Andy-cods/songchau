'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Paperclip, Send, Inbox, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';

// ─── Types ─────────────────────────────────────────────────────

interface EmailItem {
  id: string;
  direction: 'inbound' | 'outbound';
  from_email: string;
  to_email: string;
  subject: string;
  body_preview: string;
  has_attachments: boolean;
  received_at: string;
  is_read?: boolean;
}

interface EmailDetail extends EmailItem {
  body_html: string;
}

interface EmailStats {
  sent_count: number;
  received_count: number;
  by_month: Array<{ month: string; sent: number; received: number }>;
}

type Direction = 'all' | 'outbound' | 'inbound';

const TABS: { value: Direction; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'outbound', label: 'Đã gửi' },
  { value: 'inbound', label: 'Đã nhận' },
];

// ─── Page ───────────────────────────────────────────────────────

export default function EmailsPage() {
  const [direction, setDirection] = useState<Direction>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: statsRaw } = useQuery<{ data: EmailStats }>({
    queryKey: ['emails', 'stats'],
    queryFn: () => api.get('/api/v1/emails/stats'),
    retry: 1,
  });

  const stats = statsRaw?.data;

  const { data: listRaw, isLoading, error } = useQuery<{
    data: { items: EmailItem[]; total: number };
  }>({
    queryKey: ['emails', direction, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (direction !== 'all') params.set('direction', direction);
      return api.get(`/api/v1/emails?${params}`);
    },
    retry: 1,
  });

  const { data: detailRaw, isLoading: detailLoading } = useQuery<{
    data: EmailDetail;
  }>({
    queryKey: ['emails', 'detail', expandedId],
    queryFn: () => api.get(`/api/v1/emails/${expandedId}`),
    enabled: !!expandedId,
    retry: 1,
  });

  const emails = listRaw?.data?.items ?? [];
  const total = listRaw?.data?.total ?? 0;

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Mail}
        title="Email Samsung"
        subtitle="Lịch sử email giao dịch với Samsung"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Tổng gửi"
          value={stats?.sent_count?.toLocaleString('vi-VN') ?? '—'}
          icon={Send}
          tone="info"
        />
        <StatCard
          label="Tổng nhận"
          value={stats?.received_count?.toLocaleString('vi-VN') ?? '—'}
          icon={Inbox}
          tone="success"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setDirection(tab.value);
              setPage(1);
              setExpandedId(null);
            }}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              direction === tab.value
                ? 'bg-brand-600 text-white'
                : 'text-slate-500 hover:bg-slate-50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && !isLoading && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <EmptyState variant="error" heading="Có lỗi khi tải email" />
        </div>
      )}

      {/* Email List */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <EmailListSkeleton />
        ) : emails.length === 0 ? (
          <EmptyState icon={Mail} heading="Không có email nào" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {emails.map((email) => {
              const isExpanded = expandedId === email.id;
              const detail = detailRaw?.data;
              const isOutbound = email.direction === 'outbound';

              return (
                <li key={email.id}>
                  <button
                    className="w-full text-left px-4 py-3 hover:bg-slate-50/50 transition-colors"
                    onClick={() => toggleExpand(email.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold',
                          isOutbound
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-emerald-100 text-emerald-700'
                        )}
                      >
                        {isOutbound ? 'G' : 'N'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'text-sm truncate',
                              !email.is_read
                                ? 'font-semibold text-slate-900'
                                : 'text-slate-700'
                            )}
                          >
                            {email.subject}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {email.has_attachments && (
                              <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                            )}
                            <span className="text-xs text-slate-400">
                              {new Date(email.received_at).toLocaleDateString('vi-VN')}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isOutbound
                            ? `Đến: ${email.to_email}`
                            : `Từ: ${email.from_email}`}
                        </p>
                        {!isExpanded && (
                          <p className="text-xs text-slate-400 mt-1 truncate">
                            {email.body_preview}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Body */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
                      <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
                        <span>
                          <strong>Từ:</strong> {email.from_email}
                        </span>
                        <span>
                          <strong>Đến:</strong> {email.to_email}
                        </span>
                        <span>
                          {new Date(email.received_at).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      {detailLoading && expandedId === email.id ? (
                        <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">Đang tải nội dung...</span>
                        </div>
                      ) : detail && expandedId === email.id ? (
                        <div
                          className="prose prose-sm max-w-none text-slate-700 bg-white rounded border border-slate-200 p-4 overflow-auto"
                          dangerouslySetInnerHTML={{
                            __html: detail.body_html || detail.body_preview || '',
                          }}
                        />
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Hiển thị {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} / {total} email
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Trước
            </button>
            <button
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function EmailListSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="h-7 w-7 rounded-full bg-slate-200 animate-pulse flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-1/2 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-20 bg-slate-200 rounded animate-pulse" />
            </div>
            <div className="h-3 w-1/3 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
