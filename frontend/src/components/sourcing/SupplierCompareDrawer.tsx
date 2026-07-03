'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Building2, Loader2, X } from 'lucide-react';

import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { useModalA11y } from '@/hooks/useModalA11y';

interface CompareEntry {
  id: number;
  supplier_name: string;
  supplier_phone: string | null;
  supplier_email: string | null;
  maker: string | null;
  cost_jpy: number | null;
  cost_usd: number | null;
  cost_krw: number | null;
  cost_rmb: number | null;
  cost_vnd: number | null;
  sale_vnd: number | null;
  quantity: number | null;
  coefficient: number | null;
  tax_pct: number | null;
  hs_code: string | null;
  weight_kg: number | null;
  notes: string | null;
  row_classification: string | null;
  image_url: string | null;
  inquiry_date: string | null;
  created_at: string;
}

interface CompareResponse {
  data: {
    summary: {
      code: string;
      supplier_count: number;
      cost_min_vnd: number | null;
      cost_max_vnd: number | null;
      cost_avg_vnd: number | null;
      sale_min_vnd: number | null;
      sale_max_vnd: number | null;
      spread_pct: number | null;
    };
    entries: CompareEntry[];
  };
}

interface Props {
  bqmsCode: string | null;
  onClose: () => void;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v).toLocaleString('vi-VN')} ₫`;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('vi-VN');
}

export function SupplierCompareDrawer({ bqmsCode, onClose }: Props) {
  const { data, isLoading } = useQuery<CompareResponse>({
    queryKey: ['sourcing-compare', bqmsCode],
    queryFn: () => api.get(`/api/v1/sourcing/compare/${encodeURIComponent(bqmsCode as string)}`),
    enabled: !!bqmsCode,
    retry: false,
  });

  // ICE a11y: dialog focus trap + Esc + restore focus to opener button.
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y({ active: !!bqmsCode, containerRef: dialogRef, onClose });

  const body = data?.data;
  const entries = body?.entries ?? [];

  const bestId = useMemo(() => {
    if (entries.length === 0) return null;
    return entries.reduce((best, e) => {
      if (e.cost_vnd == null) return best;
      if (best == null || (e.cost_vnd ?? Infinity) < (best.cost_vnd ?? Infinity)) return e;
      return best;
    }, null as CompareEntry | null)?.id ?? null;
  }, [entries]);

  if (!bqmsCode) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng (Esc)"
        className="flex-1 cursor-default bg-slate-950/40 backdrop-blur-sm"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full max-w-[1100px] flex-col overflow-hidden bg-slate-50 shadow-2xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">So sánh nhà cung cấp</p>
            <h2 id={titleId} className="font-mono text-xl font-semibold text-slate-900">{bqmsCode}</h2>
            {body && (
              <p className="text-sm text-slate-600">
                {body.summary.supplier_count} NCC đã có giá · spread{' '}
                <span className="font-semibold text-amber-700">
                  {body.summary.spread_pct != null ? `${body.summary.spread_pct}%` : '—'}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng so sánh nhà cung cấp (Esc)"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {!isLoading && body && (
            <div className="space-y-4">
              {body.summary.supplier_count > 0 && (
                <section className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="Rẻ nhất" value={fmtMoney(body.summary.cost_min_vnd)} tone="emerald" />
                  <SummaryCard label="Đắt nhất" value={fmtMoney(body.summary.cost_max_vnd)} tone="rose" />
                  <SummaryCard label="Trung bình" value={fmtMoney(body.summary.cost_avg_vnd)} tone="sky" />
                  <SummaryCard
                    label="Chênh lệch"
                    value={body.summary.spread_pct != null ? `${body.summary.spread_pct}%` : '—'}
                    tone="amber"
                  />
                </section>
              )}

              {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
                  <Building2 className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 font-medium text-slate-700">Chưa có NCC nào cho mã này</p>
                  <p className="text-xs">Vào /sourcing thêm entry với mã = {bqmsCode}</p>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {entries.map((e, idx) => {
                    const isBest = e.id === bestId;
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          'relative rounded-xl border bg-white p-4 shadow-sm transition',
                          isBest ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-200',
                        )}
                      >
                        {isBest && (
                          <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                            <Award className="h-3 w-3" />
                            Giá tốt nhất
                          </span>
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              #{idx + 1} · {e.supplier_name}
                            </p>
                            {e.maker && <p className="truncate text-xs text-slate-500">Maker: {e.maker}</p>}
                          </div>
                          {e.row_classification && (
                            <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                              {e.row_classification}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 space-y-1.5 text-xs">
                          <Row label="Giá nhập VND" value={fmtMoney(e.cost_vnd)} bold />
                          {e.cost_jpy != null && <Row label="JPY (¥)" value={`¥${e.cost_jpy.toLocaleString('vi-VN')}`} />}
                          {e.cost_usd != null && <Row label="USD ($)" value={`$${e.cost_usd.toLocaleString('vi-VN')}`} />}
                          {e.cost_krw != null && <Row label="KRW (₩)" value={`₩${e.cost_krw.toLocaleString('vi-VN')}`} />}
                          {e.cost_rmb != null && <Row label="RMB (¥)" value={`¥${e.cost_rmb.toLocaleString('vi-VN')} RMB`} />}
                          <Row label="Giá bán đã chào" value={fmtMoney(e.sale_vnd)} color="emerald" bold />
                          <Row label="Hệ số" value={e.coefficient != null ? `×${e.coefficient}` : '—'} />
                          <Row label="Qty" value={e.quantity != null ? e.quantity.toLocaleString('vi-VN') : '—'} />
                          {e.tax_pct != null && <Row label="Thuế" value={`${e.tax_pct}%`} />}
                          {e.hs_code && <Row label="HS" value={e.hs_code} mono />}
                          {e.weight_kg != null && <Row label="Cân nặng" value={`${e.weight_kg} kg`} />}
                        </div>

                        <div className="mt-3 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                          {e.supplier_phone && <p>📞 {e.supplier_phone}</p>}
                          {e.supplier_email && <p>✉️ {e.supplier_email}</p>}
                          <p>Hỏi: {fmtDate(e.inquiry_date)}</p>
                        </div>

                        {e.notes && (
                          <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">📝 {e.notes}</p>
                        )}

                        {e.image_url && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={withToken(e.image_url)}
                            alt={e.supplier_name}
                            className="mt-2 h-20 w-full rounded-lg border border-slate-200 object-cover"
                            onError={(ev) => ((ev.currentTarget.style.display = 'none'))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  color,
  mono,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: 'emerald' | 'rose';
  mono?: boolean;
}) {
  const colorClass = color === 'emerald' ? 'text-emerald-700' : color === 'rose' ? 'text-rose-700' : 'text-slate-800';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={cn('text-right', bold && 'font-semibold', mono && 'font-mono', colorClass)}>{value}</span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'sky' | 'amber';
}) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50/60',
    rose: 'border-rose-200 bg-rose-50/60',
    sky: 'border-sky-200 bg-sky-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
  }[tone];
  return (
    <div className={cn('rounded-xl border bg-white p-3 text-center', toneClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
