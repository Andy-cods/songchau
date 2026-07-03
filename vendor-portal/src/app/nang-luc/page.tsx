'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDate, formatMoneyNum } from '@/lib/format';
import type { MyScorecard, MyScorecardResponse } from '@/lib/types';

// Grade → tone + neutral interpretation. Functional palette only (emerald/amber/
// rose for A/B/C, slate for "chưa đủ dữ liệu"). Wording is intentionally NEUTRAL:
// no negative phrasing even at C (Q4 = Option A, chốt 26/06).
const GRADE_META: Record<
  'A' | 'B' | 'C',
  { badge: string; title: string; desc: string }
> = {
  A: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    title: 'Hạng A — Đối tác tin cậy',
    desc: 'Bạn đang là đối tác tin cậy của Song Châu.',
  },
  B: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    title: 'Hạng B — Ổn định, còn dư địa cải thiện',
    desc: 'Kết quả ổn định, vẫn còn dư địa để cải thiện thêm.',
  },
  C: {
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    title: 'Hạng C — Cần cải thiện',
    desc: 'Cần cải thiện giao hàng đúng hạn và chất lượng.',
  },
};

// One reusable metric tile (Giao đúng hạn / Đạt chất lượng / Phản hồi mời thầu).
// rate === null → hiện "—" + "chưa có dữ liệu", progress bar 0%. Bar nền slate,
// fill brand (indigo) — KHÔNG dùng màu trạng thái cho thanh tiến độ.
function MetricTile({
  label,
  rate,
  subtitle,
}: {
  label: string;
  rate: number | null;
  subtitle: string;
}) {
  const hasData = rate != null;
  const pct = hasData ? Math.max(0, Math.min(100, rate)) : 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums text-slate-800">
          {hasData ? Math.round(rate) : '—'}
        </span>
        {hasData && <span className="text-sm font-medium text-slate-400">%</span>}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {hasData ? subtitle : 'chưa có dữ liệu'}
      </p>
    </div>
  );
}

export default function NangLucPage() {
  const [sc, setSc] = useState<MyScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get<MyScorecardResponse>('/api/vendor/scorecard')
      .then(res => setSc(res.data))
      .catch(() => setError('Không tải được dữ liệu năng lực'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        title="Năng lực"
        subtitle="Đánh giá hợp tác của bạn với Song Châu"
      />

      {loading ? (
        <div className="space-y-4">
          <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
            <div className="h-7 w-40 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-64 rounded bg-slate-100" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="h-2.5 w-24 rounded bg-slate-200" />
                <div className="mt-3 h-7 w-16 rounded bg-slate-100" />
                <div className="mt-3 h-1.5 w-full rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      ) : error || !sc ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{error || 'Không tải được dữ liệu năng lực'}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
          >
            Thử lại
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Đánh giá nhà cung cấp (grade badge) ─────────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Đánh giá nhà cung cấp
            </h2>
            {sc.insufficient || !sc.grade ? (
              <div className="mt-3 flex flex-col gap-2">
                <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-lg font-bold text-slate-500">
                  Chưa đủ dữ liệu
                </span>
                <p className="text-sm text-slate-500">
                  Cần thêm lượt mời thầu và đơn hàng để xếp hạng. Các chỉ số bên
                  dưới vẫn cập nhật theo hoạt động của bạn.
                </p>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <span
                  className={`inline-flex h-16 w-16 items-center justify-center rounded-full border text-4xl font-bold ${GRADE_META[sc.grade].badge}`}
                >
                  {sc.grade}
                </span>
                <div>
                  <p className="text-base font-semibold text-slate-800">
                    {GRADE_META[sc.grade].title}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {GRADE_META[sc.grade].desc}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* ── 3 metric tiles ──────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricTile
              label="Giao đúng hạn"
              rate={sc.on_time_rate}
              subtitle={`${sc.on_time_ok}/${sc.on_time_n} đơn`}
            />
            <MetricTile
              label="Đạt chất lượng"
              rate={sc.quality_rate}
              subtitle={`${sc.quality_ok}/${sc.quality_n} mục`}
            />
            <MetricTile
              label="Phản hồi mời thầu"
              rate={sc.response_rate}
              subtitle={`${sc.response_submitted}/${sc.response_n} lượt`}
            />
          </section>

          {/* ── Đơn được duyệt gần đây (recent_awards) ──────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Đơn được duyệt gần đây
            </h2>
            {sc.recent_awards.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                Chưa có đơn nào được duyệt
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {sc.recent_awards.map(a => (
                  <li
                    key={a.award_id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-medium text-brand-700">
                          {a.batch_code}
                        </span>
                        {a.bqms_code && (
                          <span className="font-mono text-[11px] text-slate-500">
                            {a.bqms_code}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-700">
                        {a.batch_title}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm tabular-nums text-slate-800">
                        {formatMoneyNum(a.awarded_price, a.currency)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {formatDate(a.awarded_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
