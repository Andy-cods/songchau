'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  RefreshCcw,
  AlertTriangle,
  FileJson,
  ArrowRightCircle,
  Download,
  FolderOpen,
  Copy,
  ImageIcon,
  FileText,
  ChevronRight,
  ChevronDown,
  Zap,
  ListChecks,
  CircleDot,
  ClipboardList,
  Trophy,
  Truck,
  Megaphone,
  Target,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime, withToken } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface StagingRow {
  id: number;
  scraped_at: string;
  scrape_run_id: string;
  module: string;
  rfq_number: string | null;
  contract_no: string | null;
  contract_period: string | null;
  item_code: string | null;
  description: string | null;
  specification: string | null;
  quantity: number | string | null;
  unit: string | null;
  status: string;
  review_notes: string | null;
  reviewed_at: string | null;
  merged_at: string | null;
  // Bidding-specific extracted fields (matches BC BQMS THANG 5.xlsx columns)
  req_name?: string | null;            // Subject
  reg_dt?: string | null;              // Ngày tháng (request date)
  deadline_dt?: string | null;         // Hạn BG
  submit_dt?: string | null;
  bd_status?: string | null;           // Hiện trạng (request/Submit)
  psincharge_name?: string | null;     // Người PT (Procurement Manager)
  currency?: string | null;
  item_cnt_text?: string | null;       // "8 Items"
  dday_html?: string | null;           // "<span class='badge red'>D-4</span>"
  ctr_type_nm?: string | null;         // Equipment MRO
  classification?: string | null;      // TM | GC
  detail_version?: string | null;
  items_count?: number | null;
  attachments_count?: number | null;
  detail_error?: string | null;
  first_maker?: string | null;
  first_part_no?: string | null;
  first_cis_code?: string | null;
  first_moq?: string | null;
}

interface ScrapeSummary {
  run_id: string;
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  list_count: number;
  drilled_count: number;
  json_path?: string;
  item_total?: number;
  mode?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case 'pending_review': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'approved': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'rejected': return 'bg-red-100 text-red-700 border-red-200';
    case 'skipped': return 'bg-slate-100 text-slate-600 border-slate-300';
    case 'merged': return 'bg-blue-100 text-blue-700 border-blue-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending_review': return 'Chờ duyệt';
    case 'approved': return 'Đã duyệt';
    case 'rejected': return 'Bị từ chối';
    case 'skipped': return 'Skip';
    case 'merged': return 'Đã merge';
    default: return status;
  }
}

const STATUS_TABS = [
  { value: '', label: 'Tất cả' },
  { value: 'pending_review', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Bị từ chối' },
  { value: 'skipped', label: 'Skip' },
  { value: 'merged', label: 'Đã merge' },
];

// ─── Page ─────────────────────────────────────────────────────────

export default function VendorStagingPage() {
  const queryClient = useQueryClient();
  const [activeModule, setActiveModule] =
    useState<'contract' | 'po' | 'bidding' | 'announcement' | 'selection_result'>('bidding');
  const [activeTab, setActiveTab] = useState<string>('pending_review');
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [scrapeLimit, setScrapeLimit] = useState<number>(10);
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [drillDetails, setDrillDetails] = useState<boolean>(false);
  const [bdPageSize, setBdPageSize] = useState<number>(100);
  const [bdPageNum, setBdPageNum] = useState<number>(1);
  const [folderRfq, setFolderRfq] = useState<string | null>(null);
  const [lastScrape, setLastScrape] = useState<ScrapeSummary | null>(null);

  const params = new URLSearchParams({ module: activeModule, limit: '200', offset: '0' });
  if (activeTab) params.set('status', activeTab);

  const { data: rowsRaw, isLoading: rowsLoading, refetch: refetchRows } = useQuery({
    queryKey: ['vendor-staging', activeModule, activeTab],
    queryFn: () =>
      api.get<{ data: { items: StagingRow[]; total: number } }>(
        `/api/v1/bqms/vendor-staging?${params.toString()}`
      ),
    refetchInterval: 30_000,
  });

  const rows: StagingRow[] = rowsRaw?.data?.items ?? [];
  const total = rowsRaw?.data?.total ?? 0;

  const { data: previewRaw } = useQuery({
    queryKey: ['vendor-staging-preview', previewId],
    enabled: previewId !== null,
    queryFn: () =>
      api.get<{ data: StagingRow & { raw_json: unknown } }>(
        `/api/v1/bqms/vendor-staging/${previewId}`
      ),
  });

  const scrapeMutation = useMutation({
    mutationFn: () => {
      const ps = `&page_size=${bdPageSize}&page_num=${bdPageNum}`;
      const url =
        activeModule === 'contract'
          ? `/api/v1/bqms/scrape-contracts?limit=${scrapeLimit}&dry_run=${dryRun}&drill_items=true`
          : activeModule === 'po'
          ? `/api/v1/bqms/scrape-mro-po?limit=${scrapeLimit}&dry_run=${dryRun}`
          : activeModule === 'announcement'
          ? `/api/v1/bqms/scrape-announcement?limit=${scrapeLimit}&dry_run=${dryRun}${ps}`
          : activeModule === 'selection_result'
          ? `/api/v1/bqms/scrape-selection-result?limit=${scrapeLimit}&dry_run=${dryRun}&auto_mark_result=true${ps}`
          : `/api/v1/bqms/scrape-bidding?limit=${scrapeLimit}&dry_run=${dryRun}&drill_details=${drillDetails}${ps}`;
      return api.post<{ data: ScrapeSummary }>(url, {});
    },
    onSuccess: (resp) => {
      const summary = (resp as any).data ?? resp;
      setLastScrape(summary);
      queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
    },
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision, notes }: { id: number; decision: 'approve' | 'reject'; notes?: string }) =>
      api.post(`/api/v1/bqms/vendor-staging/${id}/decide`, { decision, notes: notes || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-staging-preview'] });
    },
  });

  // Bidding-specific: "Báo giá" = upsert bqms_rfq + download files (long-running)
  const quoteMutation = useMutation({
    mutationFn: ({ id, downloadFiles }: { id: number; downloadFiles: boolean }) =>
      api.post<{
        data: {
          bqms_rfq_upserts: number;
          download?: { downloaded_count: number; images_extracted: number; folder: string };
          staging_status: string;
        };
      }>(`/api/v1/bqms/vendor-staging/${id}/quote?download_files=${downloadFiles}`, {}),
    onSuccess: (resp, vars) => {
      const r = (resp as any).data ?? resp;
      const dl = r.download;
      const msg =
        `Đã đánh dấu RFQ là "Báo giá":\n` +
        `• ${r.bqms_rfq_upserts} item đã đẩy vào bảng bqms_rfq\n` +
        (dl ? `• ${dl.downloaded_count} file tải về (${dl.images_extracted} ảnh)\n• Folder: ${dl.folder}` : '• (Đã skip download files)');
      window.alert(msg);
      queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
      // Also pop the folder drawer for quick visual confirmation
      if (dl) setFolderRfq(rows.find((r) => r.id === vars.id)?.rfq_number || null);
    },
    onError: (err: any) => window.alert(`Báo giá lỗi: ${err.message}`),
  });

  // Bidding-specific: "Skip" = mark for later review
  const skipMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/api/v1/bqms/vendor-staging/${id}/skip`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
    },
  });

  // ── Option B: batch /quote via background queue ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);

  // Reset selection khi đổi tab/module để tránh leak ids cũ
  // (giữ lại nếu user vẫn ở same tab)
  const _moduleTabKey = `${activeModule}|${activeTab}`;
  const [_lastModuleTabKey, _setLastModuleTabKey] = useState(_moduleTabKey);
  if (_lastModuleTabKey !== _moduleTabKey) {
    _setLastModuleTabKey(_moduleTabKey);
    if (selectedIds.size) setSelectedIds(new Set());
  }

  const quoteBatchMutation = useMutation({
    mutationFn: (ids: number[]) =>
      api.post<{ data: { batch_id: number; total_count: number } }>(
        `/api/v1/bqms/vendor-staging/quote-batch`,
        { staging_ids: ids }
      ),
    onSuccess: (resp) => {
      const r = (resp as any).data ?? resp;
      setActiveBatchId(r.batch_id);
      setSelectedIds(new Set());
    },
    onError: (err: any) => window.alert(`Tạo batch lỗi: ${err.message}`),
  });

  // Poll batch status mỗi 3s khi đang chạy
  const { data: batchProgressRaw } = useQuery({
    queryKey: ['quote-batch', activeBatchId],
    enabled: activeBatchId !== null,
    queryFn: () =>
      api.get<{
        data: {
          batch: {
            id: number;
            total_count: number;
            pending_count: number;
            running_count: number;
            done_count: number;
            error_count: number;
            status: 'running' | 'done' | 'partial' | 'error';
            created_at: string;
            completed_at: string | null;
          };
          items: {
            id: number;
            staging_id: number;
            rfq_number: string | null;
            status: 'pending' | 'running' | 'done' | 'error';
            items_count: number | null;
            files_count: number | null;
            images_count: number | null;
            upserts_count: number | null;
            classification: string | null;
            error_message: string | null;
            started_at: string | null;
            completed_at: string | null;
          }[];
        };
      }>(`/api/v1/bqms/vendor-staging/quote-batch/${activeBatchId}`),
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.data?.batch?.status;
      return s === 'running' ? 3000 : false;
    },
  });
  const batchProgress = (batchProgressRaw as any)?.data;

  // Khi batch xong (done/partial/error) → invalidate staging để hiển thị approved mới
  const _batchStatus = batchProgress?.batch?.status;
  const [_lastBatchStatus, _setLastBatchStatus] = useState<string | null>(null);
  if (_batchStatus && _batchStatus !== 'running' && _batchStatus !== _lastBatchStatus) {
    _setLastBatchStatus(_batchStatus);
    queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-staging-counts'] });
  }

  const downloadFilesMutation = useMutation({
    mutationFn: (id: number) =>
      api.post<{
        data: {
          rfq_number: string;
          folder: string;
          folder_pre_existed: boolean;
          downloaded_count: number;
          downloaded_total_bytes: number;
          images_extracted: number;
          errors: string[];
          duration_seconds: number;
        };
      }>(`/api/v1/bqms/bidding/${id}/download-files`, {}),
    onSuccess: (resp) => {
      const r = (resp as any).data ?? resp;
      // Auto-open the folder browser drawer after download
      setFolderRfq(r.rfq_number);
    },
    onError: (err: any) => {
      window.alert(`Tải file lỗi: ${err.message}`);
    },
  });

  const { data: folderInfo, isLoading: folderLoading } = useQuery({
    queryKey: ['vendor-staging-folder', folderRfq],
    enabled: folderRfq !== null,
    queryFn: () =>
      api.get<{
        data: {
          exists: boolean;
          rfq_number: string;
          folder?: string;
          files?: { name: string; size: number; modified: number }[];
          images?: { name: string; size: number; modified: number }[];
          probed?: string[];
        };
      }>(`/api/v1/bqms/bidding/folder?rfq_number=${encodeURIComponent(folderRfq!)}`),
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: { merged: number; skipped_duplicate: number; errors: { id: number; error: string }[] } }>(
        `/api/v1/bqms/vendor-staging/merge-approved?module=${activeModule}`,
        {}
      ),
    onSuccess: (resp) => {
      const r = (resp as any).data ?? resp;
      const msg =
        `Đã merge ${r.merged} dòng vào Trúng BG.` +
        (r.skipped_duplicate ? ` Bỏ qua trùng: ${r.skipped_duplicate}.` : '') +
        (r.errors?.length ? ` Lỗi: ${r.errors.length}.` : '');
      window.alert(msg);
      queryClient.invalidateQueries({ queryKey: ['vendor-staging'] });
    },
  });

  // Count rows that are approved-but-not-yet-merged across the loaded page
  const approvedPending = rows.filter((r) => r.status === 'approved').length;

  // Phase J: Excel-vs-Portal coverage report
  const { data: coverageRaw } = useQuery({
    queryKey: ['vendor-staging-coverage'],
    queryFn: () => api.get<any>(`/api/v1/bqms/coverage/excel-vs-portal`),
    staleTime: 60_000,
  });
  const coverage = coverageRaw?.data;

  // Per-module pending count (for badge on each pill)
  const { data: countsRaw } = useQuery({
    queryKey: ['vendor-staging-counts'],
    queryFn: async () => {
      const modules = ['contract', 'po', 'bidding', 'announcement', 'selection_result'];
      const results = await Promise.all(
        modules.map((m) =>
          api.get<{ data: { total: number } }>(
            `/api/v1/bqms/vendor-staging?module=${m}&status=pending_review&limit=1`
          ).then((r) => ({ module: m, total: (r as any).data?.total ?? 0 }))
            .catch(() => ({ module: m, total: 0 }))
        )
      );
      return results.reduce<Record<string, number>>((acc, r) => {
        acc[r.module] = r.total;
        return acc;
      }, {});
    },
    staleTime: 30_000,
  });
  const counts = countsRaw ?? {};

  return (
    <div className="space-y-5">
      {/* Header — flat brand block, Samsung BQMS branding */}
      <div className="rounded-xl bg-brand-600 text-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/15 backdrop-blur rounded-full text-[11px] font-mono uppercase tracking-wider mb-2 border border-white/20">
              <CloudDownloadHero />
              Samsung BQMS Vendor Portal
            </div>
            <h1 className="text-2xl md:text-3xl font-display font-bold leading-tight">
              Duyệt dữ liệu Vendor Portal
            </h1>
            <p className="text-sm text-white/80 mt-1 max-w-2xl">
              Cào trực tiếp từ <strong>sec-bqms.com</strong> · Bỏ qua trung gian Excel ·
              Duyệt thủ công trước khi đẩy vào BQMS / Trúng BG / Giao hàng
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {activeTab === 'approved' && approvedPending > 0 && (activeModule === 'contract' || activeModule === 'po') && (
              <button
                onClick={() => {
                  const target = activeModule === 'contract' ? 'Trúng BG' : 'Giao hàng';
                  if (window.confirm(`Merge ${approvedPending} dòng đã duyệt vào bảng ${target}?`)) {
                    mergeMutation.mutate();
                  }
                }}
                disabled={mergeMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold shadow-md shadow-emerald-500/30 disabled:opacity-60 transition-all"
              >
                {mergeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
                Merge → {activeModule === 'contract' ? 'Trúng BG' : 'Giao hàng'}
              </button>
            )}
            <button
              onClick={() => {
                refetchRows();
                queryClient.invalidateQueries({ queryKey: ['vendor-staging-counts'] });
                queryClient.invalidateQueries({ queryKey: ['vendor-staging-coverage'] });
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur transition-colors"
            >
              <RefreshCcw className="w-4 h-4" />
              Làm mới
            </button>
          </div>
        </div>

        {/* Coverage stat strip — shows DB vs Excel migration progress */}
        {coverage && (
          <div className="relative mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroStat
              label="Đã cào (Vendor Portal)"
              value={coverage.rfq_overlap?.portal_total_distinct ?? 0}
              suffix="RFQ"
              color="text-emerald-200"
            />
            <HeroStat
              label="Excel cũ (legacy)"
              value={coverage.rfq_overlap?.legacy_total_distinct ?? 0}
              suffix="RFQ"
              color="text-amber-200"
            />
            <HeroStat
              label="Coverage"
              value={`${coverage.coverage_pct ?? 0}`}
              suffix="%"
              color={coverage.coverage_pct >= 95 ? 'text-emerald-200' : 'text-yellow-200'}
            />
            <HeroStat
              label={coverage.ready_to_deprecate_excel ? "Sẵn sàng bỏ Excel" : "Chỉ Excel cũ có"}
              value={coverage.ready_to_deprecate_excel ? '✓' : (coverage.rfq_overlap?.only_legacy ?? 0)}
              suffix={coverage.ready_to_deprecate_excel ? '' : 'RFQ'}
              color={coverage.ready_to_deprecate_excel ? 'text-emerald-200' : 'text-rose-200'}
            />
          </div>
        )}
      </div>

      {/* 5-module switch — modern card-style pills with badges */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {([
          { v: 'bidding',          label: 'Bidding',         sub: 'RFQ chờ báo giá',     target: 'BQMS',       Icon: ClipboardList },
          { v: 'contract',         label: 'Contract Mgmt',   sub: 'Báo giá đã trúng',    target: 'Trúng BG',   Icon: Trophy },
          { v: 'po',               label: 'MRO P/O Receipt', sub: 'PO đã nhận',          target: 'Giao hàng',  Icon: Truck },
          { v: 'announcement',     label: 'Announcement',    sub: 'Đang mời thầu',       target: 'Tham khảo',  Icon: Megaphone },
          { v: 'selection_result', label: 'Selection Result',sub: 'Trúng / Trượt',       target: 'BQMS auto',  Icon: Target },
        ] as const).map((m) => {
          const isActive = activeModule === m.v;
          const cnt = counts[m.v] ?? 0;
          return (
            <button
              key={m.v}
              onClick={() => {
                setActiveModule(m.v);
                setActiveTab('pending_review');
                setLastScrape(null);
              }}
              className={cn(
                'group relative text-left p-3.5 rounded-xl border-2 bg-white transition-all duration-200',
                isActive
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20'
                  : 'border-slate-200 hover:border-brand-300'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <m.Icon className={cn('w-5 h-5', isActive ? 'text-brand-600' : 'text-slate-400')} aria-hidden />
                {cnt > 0 && (
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full',
                    isActive ? 'bg-brand-600 text-white' : 'bg-slate-700 text-white'
                  )}>
                    {cnt}
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900 truncate">{m.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{m.sub}</div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mt-1.5 flex items-center gap-1">
                <ArrowRightCircle className="w-2.5 h-2.5" />
                {m.target}
              </div>
            </button>
          );
        })}
      </div>

      {/* Scrape trigger card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <PlayCircle className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Chạy scrape {
                activeModule === 'contract' ? 'Contract Mgmt' :
                activeModule === 'po' ? 'MRO P/O Receipt' :
                'Bidding · Quotation Submit'
              }
            </h3>
            <p className="text-xs text-slate-500">
              {activeModule === 'contract'
                ? '1 lần đăng nhập / lần chạy. Khoảng 12 giây / contract (vì phải drill chi tiết).'
                : activeModule === 'po'
                ? '1 lần đăng nhập / lần chạy. Lấy data trực tiếp từ list, không drill — nhanh hơn nhiều.'
                : '1 lần đăng nhập / lần chạy. Lấy ~10 RFQ trên trang đầu (REQUEST-level, không có item chi tiết).'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-mono uppercase">Số contract</span>
            <input
              type="number"
              min={1}
              max={50}
              value={scrapeLimit}
              onChange={(e) => setScrapeLimit(Math.max(1, Math.min(50, +e.target.value || 10)))}
              className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Dry-run (chỉ lưu file, không ghi staging)</span>
          </label>
          {activeModule === 'bidding' && (
            <>
              <label className="flex items-center gap-2 px-3 py-2 border border-brand-200 bg-brand-50/40 rounded-lg text-sm cursor-pointer hover:bg-brand-50">
                <input
                  type="checkbox"
                  checked={drillDetails}
                  onChange={(e) => setDrillDetails(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Cào chi tiết items (cần để Báo giá)</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 font-mono uppercase">Page size</span>
                <select
                  value={bdPageSize}
                  onChange={(e) => setBdPageSize(+e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {[10, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>{n} rows</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 font-mono uppercase">Page #</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={bdPageNum}
                  onChange={(e) => setBdPageNum(Math.max(1, Math.min(100, +e.target.value || 1)))}
                  className="w-20 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </label>
            </>
          )}
          <button
            onClick={() => scrapeMutation.mutate()}
            disabled={scrapeMutation.isPending}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {scrapeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang chạy... (~{
                  activeModule === 'contract' ? Math.round(scrapeLimit * 12) :
                  activeModule === 'po' ? 30 :
                  20
                }s)
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Chạy scrape
              </>
            )}
          </button>
        </div>

        {scrapeMutation.error && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>{(scrapeMutation.error as Error).message}</div>
          </div>
        )}

        {lastScrape && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 p-3 bg-slate-50 rounded-lg text-sm">
            <Stat label="Run ID" value={lastScrape.run_id?.slice(0, 8)} mono />
            <Stat label="List rows" value={lastScrape.list_count} />
            <Stat label="Drilled" value={lastScrape.drilled_count} />
            <Stat label="Items" value={lastScrape.item_total ?? '–'} />
            <Stat label="Thời gian" value={`${(lastScrape.duration_seconds || 0).toFixed(1)}s`} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.value
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto text-xs text-slate-400 pb-2">{total} dòng</div>
      </div>

      {/* Batch action bar — chỉ hiển thị cho bidding khi có row được tick */}
      {activeModule === 'bidding' && activeTab === 'pending_review' && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-brand-50 border border-brand-200 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-brand-900">
            <ListChecks className="w-4 h-4" />
            Đã chọn <strong>{selectedIds.size}</strong> RFQ
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-2 text-xs text-brand-600 hover:underline"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <button
            onClick={() => {
              const ids = Array.from(selectedIds);
              if (window.confirm(
                `Báo giá ${ids.length} RFQ qua background queue?\n` +
                `Worker sẽ chạy lần lượt (~30-90s/RFQ → tổng ~${Math.ceil(ids.length * 60 / 60)} phút).\n` +
                `Bạn có thể đóng tab — kết quả lưu vào DB.`
              )) {
                quoteBatchMutation.mutate(ids);
              }
            }}
            disabled={quoteBatchMutation.isPending}
            className="flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold shadow-md shadow-brand-500/30 disabled:opacity-60 transition-all"
          >
            {quoteBatchMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Báo {selectedIds.size} RFQ (chạy nền)
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {rowsLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Không có dòng nào ở trạng thái này.
          </div>
        ) : activeModule === 'bidding' ? (
          /* Bidding rich view — column set matches BC BQMS THANG 5.xlsx */
          <BiddingRichTable
            rows={rows}
            quoteMutation={quoteMutation}
            skipMutation={skipMutation}
            decideMutation={decideMutation}
            downloadFilesMutation={downloadFilesMutation}
            setFolderRfq={setFolderRfq}
            setPreviewId={setPreviewId}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
          />
        ) : (
          /* Contract / MRO / Announcement / Selection — generic compact view */
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-mono">
              <tr>
                <th className="px-3 py-2 text-left">
                  {activeModule === 'po' ? 'PO No' : 'Contract'}
                </th>
                <th className="px-3 py-2 text-left">Request</th>
                <th className="px-3 py-2 text-left">Item Code</th>
                <th className="px-3 py-2 text-left">Mô tả</th>
                <th className="px-3 py-2 text-right">SL</th>
                <th className="px-3 py-2 text-left">ĐVT</th>
                <th className="px-3 py-2 text-left">
                  {activeModule === 'po' ? 'Delivery date' : 'Period'}
                </th>
                <th className="px-3 py-2 text-left">Cào lúc</th>
                <th className="px-3 py-2 text-left">Trạng thái</th>
                <th className="px-3 py-2 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-700">{r.contract_no || '–'}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">{r.rfq_number || '–'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.item_code || '–'}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={r.description || ''}>
                    {r.description || '–'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{r.quantity ?? '–'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.unit || '–'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.contract_period || '–'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatRelativeTime(r.scraped_at)}</td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded border', statusBadge(r.status))}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setPreviewId(r.id)}
                        className="p-1.5 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
                        title="Xem raw JSON"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {r.status === 'pending_review' && (
                        <>
                          <button
                            onClick={() => decideMutation.mutate({ id: r.id, decision: 'approve' })}
                            disabled={decideMutation.isPending}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50"
                            title="Duyệt"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              const notes = window.prompt('Lý do từ chối (tùy chọn):') ?? '';
                              decideMutation.mutate({ id: r.id, decision: 'reject', notes });
                            }}
                            disabled={decideMutation.isPending}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="Từ chối"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview drawer — pretty hierarchical viewer */}
      {previewId !== null && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex justify-end"
          onClick={() => setPreviewId(null)}
        >
          <div
            className="w-full max-w-3xl bg-white h-full overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <FileJson className="w-5 h-5 text-brand-600" />
                <h3 className="font-semibold text-slate-800">Chi tiết staging #{previewId}</h3>
              </div>
              <button
                onClick={() => setPreviewId(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              {!previewRaw ? (
                <div className="text-slate-400 text-sm">Đang tải...</div>
              ) : (
                <PrettyStagingDetail data={(previewRaw as any).data ?? previewRaw} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Folder drawer — file/image browser */}
      {folderRfq !== null && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex justify-end"
          onClick={() => setFolderRfq(null)}
        >
          <div
            className="w-full max-w-3xl bg-white h-full overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-slate-800">Folder của {folderRfq}</h3>
              </div>
              <button
                onClick={() => setFolderRfq(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              {folderLoading ? (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang quét folder...
                </div>
              ) : !folderInfo?.data?.exists ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Folder chưa tồn tại</div>
                      <div className="text-xs mt-1">
                        Bấm nút ⬇ Tải file để tạo folder và download file đính kèm về.
                      </div>
                    </div>
                  </div>
                  {folderInfo?.data?.probed && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer">Đã quét các path</summary>
                      <ul className="mt-2 space-y-0.5 font-mono">
                        {folderInfo.data.probed.map((p: string) => (
                          <li key={p}>· {p}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : (
                <FolderContents
                  data={folderInfo.data}
                  rfqNumber={folderRfq}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quote-batch progress modal */}
      {activeBatchId !== null && batchProgress && (
        <QuoteBatchModal
          batch={batchProgress.batch}
          items={batchProgress.items}
          onClose={() => setActiveBatchId(null)}
        />
      )}
    </div>
  );
}

// ─── Quote-batch progress modal ─────────────────────────────────

function QuoteBatchModal({
  batch,
  items,
  onClose,
}: {
  batch: any;
  items: any[];
  onClose: () => void;
}) {
  const isRunning = batch.status === 'running';
  const completed = batch.done_count + batch.error_count;
  const pct = batch.total_count > 0 ? Math.round((completed / batch.total_count) * 100) : 0;

  const statusColor: Record<string, string> = {
    pending: 'bg-slate-200 text-slate-600',
    running: 'bg-blue-100 text-blue-700 animate-pulse',
    done: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-700',
  };
  const statusLabel: Record<string, string> = {
    pending: 'Chờ',
    running: 'Đang chạy',
    done: 'Xong',
    error: 'Lỗi',
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={isRunning ? undefined : onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header với progress bar */}
        <div className="bg-brand-600 text-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <h3 className="font-bold text-lg">Batch /quote #{batch.id}</h3>
              <span className={cn(
                'inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full border',
                isRunning ? 'bg-white/20 border-white/30 text-white' :
                batch.status === 'done' ? 'bg-emerald-400/30 border-emerald-200/40 text-white' :
                batch.status === 'partial' ? 'bg-amber-400/30 border-amber-200/40 text-white' :
                'bg-red-400/30 border-red-200/40 text-white'
              )}>
                {batch.status.toUpperCase()}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white"
              title={isRunning ? 'Đóng (worker vẫn chạy nền)' : 'Đóng'}
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <div className="text-sm text-white/90 mb-2 flex items-center gap-3">
            <span>{completed}/{batch.total_count} hoàn tất</span>
            <span className="text-white/60">·</span>
            <span>{batch.running_count} đang chạy</span>
            <span className="text-white/60">·</span>
            <span>{batch.pending_count} chờ</span>
            {batch.error_count > 0 && (
              <>
                <span className="text-white/60">·</span>
                <span className="text-red-200 font-semibold">{batch.error_count} lỗi</span>
              </>
            )}
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Body — per-row progress */}
        <div className="overflow-y-auto p-4 flex-1">
          <table className="w-full text-xs">
            <thead className="text-[11px] uppercase text-slate-500 font-mono">
              <tr className="border-b border-slate-200">
                <th className="px-2 py-2 text-left">RFQ</th>
                <th className="px-2 py-2 text-left">Trạng thái</th>
                <th className="px-2 py-2 text-right">Items</th>
                <th className="px-2 py-2 text-right">Files</th>
                <th className="px-2 py-2 text-right">Ảnh</th>
                <th className="px-2 py-2 text-left">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-mono font-semibold text-slate-700">
                    {it.rfq_number || `#${it.staging_id}`}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0 text-[11px] font-medium rounded',
                      statusColor[it.status] || 'bg-slate-100 text-slate-600'
                    )}>
                      {it.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      {it.status === 'done' && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {it.status === 'error' && <XCircle className="w-2.5 h-2.5" />}
                      {it.status === 'pending' && <CircleDot className="w-2.5 h-2.5" />}
                      {statusLabel[it.status] || it.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {it.items_count !== null ? it.items_count : <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {it.files_count !== null ? it.files_count : <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {it.images_count !== null ? it.images_count : <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {it.error_message ? (
                      <span className="text-red-600 truncate block max-w-xs" title={it.error_message}>
                        {it.error_message}
                      </span>
                    ) : it.classification ? (
                      <span className="font-mono text-[11px]">{it.classification}</span>
                    ) : (
                      <span className="text-slate-300">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-between bg-slate-50">
          <div className="text-xs text-slate-500">
            {isRunning ? 'Worker đang xử lý — bạn có thể đóng modal, tiến độ vẫn lưu.' : 'Hoàn tất.'}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pretty staging detail ──────────────────────────────────────

function PrettyStagingDetail({ data }: { data: any }) {
  if (!data || typeof data !== 'object') return null;

  // Top-level metadata fields to highlight
  const META_KEYS = [
    'id', 'module', 'status', 'rfq_number', 'contract_no', 'item_code',
    'description', 'specification', 'quantity', 'unit', 'contract_period',
    'scraped_at', 'created_at', 'reviewed_at', 'merged_at',
    'review_notes', 'error_message',
  ];

  const meta: Record<string, any> = {};
  for (const k of META_KEYS) if (k in data) meta[k] = data[k];

  // Parse raw_json if it's a JSON string
  let raw = data.raw_json;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch {}
  }

  return (
    <div className="space-y-5 text-sm">
      <section>
        <h4 className="text-xs uppercase tracking-wide font-mono text-slate-400 mb-2">Metadata</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 bg-slate-50 rounded-lg p-3 border border-slate-200">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <span className="text-slate-500 font-mono text-xs flex-shrink-0">{k}:</span>
              <span className="text-slate-800 break-words text-xs">
                {v === null || v === undefined ? (
                  <span className="text-slate-400 italic">null</span>
                ) : typeof v === 'string' && v.length > 80 ? (
                  <span title={v}>{v.slice(0, 80)}…</span>
                ) : (
                  String(v)
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {raw && typeof raw === 'object' && (
        <section>
          <h4 className="text-xs uppercase tracking-wide font-mono text-slate-400 mb-2">
            Raw data từ Vendor Portal
          </h4>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 font-mono text-xs">
            <PrettyJsonNode value={raw} depth={0} />
          </div>
        </section>
      )}
    </div>
  );
}

function PrettyJsonNode({ value, depth }: { value: any; depth: number }) {
  const [open, setOpen] = useState(depth < 1);

  if (value === null) return <span className="text-slate-400">null</span>;
  if (value === undefined) return <span className="text-slate-400">undefined</span>;
  if (typeof value === 'boolean') return <span className="text-brand-600">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-blue-600">{value}</span>;

  if (typeof value === 'string') {
    // Try parse as nested JSON
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
      try {
        const inner = JSON.parse(value);
        return <PrettyJsonNode value={inner} depth={depth} />;
      } catch {}
    }
    // Strip HTML tags from text (e.g. <span class="badge red">D-4</span>)
    const cleaned = value.replace(/<[^>]+>/g, '').trim();
    return (
      <span className="text-emerald-700 break-all">
        {cleaned !== value ? `"${cleaned}"` : `"${value}"`}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>;
    return (
      <div>
        <button
          type="button"
          className="inline-flex items-center text-slate-500 hover:text-slate-700"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>[</span>
          {!open && <span className="text-slate-400 ml-1">{value.length} items</span>}
        </button>
        {open && (
          <div className="ml-4 border-l border-slate-200 pl-3 space-y-1 mt-1">
            {value.map((item, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="text-slate-400">{i}:</span>
                <PrettyJsonNode value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
        {open && <span>]</span>}
      </div>
    );
  }

  // Object
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-slate-400">{'{}'}</span>;
  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center text-slate-500 hover:text-slate-700"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{'{'}</span>
        {!open && <span className="text-slate-400 ml-1">{entries.length} keys</span>}
      </button>
      {open && (
        <div className="ml-4 border-l border-slate-200 pl-3 space-y-1 mt-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-1.5 items-start">
              <span className="text-slate-700 font-semibold">{k}:</span>
              <div className="flex-1 min-w-0"><PrettyJsonNode value={v} depth={depth + 1} /></div>
            </div>
          ))}
        </div>
      )}
      {open && <span>{'}'}</span>}
    </div>
  );
}

// ─── Folder contents (file list + image grid) ──────────────────

function FolderContents({ data, rfqNumber }: { data: any; rfqNumber: string }) {
  const folderPath = data.folder as string;
  const files = (data.files || []) as { name: string; size: number; modified: number }[];
  const images = (data.images || []) as { name: string; size: number }[];

  // require_role accepts ?token= query param for direct <a> / <img> links
  const fileUrl = (kind: 'raw' | 'images', name: string) =>
    withToken(
      `/api/v1/bqms/bidding/folder/file?rfq_number=${encodeURIComponent(rfqNumber)}` +
        `&kind=${kind}&name=${encodeURIComponent(name)}`
    );

  const totalRawBytes = files.reduce((s, f) => s + f.size, 0);

  // Strip the VPS prefix → relative path the file-browser endpoint expects
  // (`Puplic/BQMS/RFQ/RFQ 2026/THANG 5/QT26060689`).
  const VPS_PREFIX = '/data/onedrive-staging/';
  const docPath = folderPath.startsWith(VPS_PREFIX)
    ? folderPath.slice(VPS_PREFIX.length)
    : folderPath;
  const docHref = `/documents/browser?path=${encodeURIComponent(docPath)}`;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(folderPath);
    } catch {}
  };

  return (
    <div className="space-y-5 text-sm">
      {/* Folder path → Quản lý tài liệu */}
      <section>
        <h4 className="text-xs uppercase tracking-wide font-mono text-slate-400 mb-2">
          Đường dẫn folder
        </h4>
        <Link
          href={docHref}
          className="block bg-amber-50 border border-amber-200 rounded-lg p-3 hover:bg-amber-100 hover:border-amber-300 transition-colors group"
          title="Click để mở trong Quản lý tài liệu"
        >
          <div className="flex items-center gap-2 text-xs text-amber-900 font-mono break-all">
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span className="flex-1">{docPath}</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0 text-amber-600 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            type="button"
            onClick={copyPath}
            className="text-[11px] text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
            title="Copy full VPS path"
          >
            <Copy className="w-3 h-3" /> Copy path
          </button>
          <span className="text-[11px] text-slate-400">
            📂 Click vào ô vàng để mở folder trong "Quản lý tài liệu"
          </span>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-2">
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="text-[11px] uppercase font-mono text-slate-400">Files (raw)</div>
          <div className="text-lg font-bold text-slate-800 mt-0.5">{files.length}</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="text-[11px] uppercase font-mono text-slate-400">Tổng dung lượng</div>
          <div className="text-lg font-bold text-slate-800 mt-0.5">
            {(totalRawBytes / 1_048_576).toFixed(1)} MB
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="text-[11px] uppercase font-mono text-slate-400">Ảnh extract</div>
          <div className="text-lg font-bold text-slate-800 mt-0.5">{images.length}</div>
        </div>
      </section>

      {/* Image grid */}
      {images.length > 0 && (
        <section>
          <h4 className="text-xs uppercase tracking-wide font-mono text-slate-400 mb-2 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" />
            Ảnh linh kiện ({images.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img) => (
              <a
                key={img.name}
                href={fileUrl('images', img.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-white border border-slate-200 rounded-lg overflow-hidden hover:shadow-md hover:border-brand-300 transition-all"
              >
                <div className="aspect-square bg-slate-100 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl('images', img.name)}
                    alt={img.name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                  />
                </div>
                <div className="px-2 py-1.5 border-t border-slate-100">
                  <div className="text-xs font-mono text-slate-700 truncate" title={img.name}>
                    {img.name}
                  </div>
                  <div className="text-[11px] text-slate-400">{(img.size / 1024).toFixed(0)} KB</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* File list */}
      {files.length > 0 && (
        <section>
          <h4 className="text-xs uppercase tracking-wide font-mono text-slate-400 mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            File đính kèm ({files.length})
          </h4>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 font-mono uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Tên file</th>
                  <th className="px-3 py-2 text-right">Dung lượng</th>
                  <th className="px-3 py-2 text-right">Tải</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const isDrawing = /(_Drawing_|^Drawing_)/i.test(f.name);
                  const isRfq = /^RFQ_/i.test(f.name);
                  return (
                    <tr key={f.name} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono break-all">
                        {f.name}
                        {isDrawing && (
                          <span className="ml-2 inline-flex px-1.5 py-0 text-[11px] bg-orange-100 text-orange-700 border border-orange-200 rounded">
                            Drawing
                          </span>
                        )}
                        {isRfq && (
                          <span className="ml-2 inline-flex px-1.5 py-0 text-[11px] bg-brand-100 text-brand-700 border border-brand-200 rounded">
                            RFQ form
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {(f.size / 1024).toFixed(0)} KB
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <a
                          href={fileUrl('raw', f.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Stat helper ──────────────────────────────────────────────────

function Stat({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-400 font-mono uppercase">{label}</div>
      <div className={cn('text-sm font-semibold text-slate-800 mt-0.5', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

// Hero stat used inside the gradient header
function HeroStat({
  label, value, suffix, color = 'text-white',
}: {
  label: string; value: string | number; suffix?: string; color?: string;
}) {
  return (
    <div className="bg-white/10 backdrop-blur rounded-lg p-3 border border-white/15">
      <div className="text-[11px] uppercase tracking-wider text-white/70 font-mono">{label}</div>
      <div className={cn('text-2xl font-bold mt-0.5 leading-tight tabular-nums', color)}>
        {value}
        {suffix && <span className="text-sm font-normal text-white/60 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Bidding rich table — columns match BC BQMS THANG 5.xlsx ──────────
//
// Reference (from THANG 5 sheet, 14 cols):
//   Ngày Tháng · Đơn hàng · BQMS · Tên hàng hóa(SPEC) · Explain · Loại hàng
//   · Maker · Mark · Hình ảnh · Đơn vị · Số lượng · Hạn BG · Hiện trạng · Ghi chú
//
// We add per-row action column at the right + sticky RFQ on the left.
//
function BiddingRichTable({
  rows,
  quoteMutation,
  skipMutation,
  decideMutation,
  downloadFilesMutation,
  setFolderRfq,
  setPreviewId,
  selectedIds,
  setSelectedIds,
}: {
  rows: StagingRow[];
  quoteMutation: any;
  skipMutation: any;
  decideMutation: any;
  downloadFilesMutation: any;
  setFolderRfq: (rfq: string | null) => void;
  setPreviewId: (id: number | null) => void;
  selectedIds: Set<number>;
  setSelectedIds: (s: Set<number>) => void;
}) {
  // Chỉ row pending mới được tick
  const selectableIds = rows.filter((r) => r.status === 'pending_review').map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      selectableIds.forEach((id) => next.delete(id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      selectableIds.forEach((id) => next.add(id));
      setSelectedIds(next);
    }
  };
  const toggleOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  // Strip HTML from dday like '<span class="badge red">D-4</span>' → 'D-4'
  const cleanText = (s?: string | null): string => {
    if (!s) return '';
    return s.replace(/<[^>]+>/g, '').trim();
  };

  // Format date string. "2026-05-08" → "08/05" (compact)
  const fmtDate = (s?: string | null): string => {
    if (!s) return '–';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}`;
    return s.length > 12 ? s.slice(0, 12) : s;
  };

  // Compact deadline like "(GMT+07:00) 5/12/2026 17:00" → "12/05 17h"
  const fmtDeadline = (s?: string | null): string => {
    if (!s) return '–';
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/\d{4}\s+(\d{1,2}):(\d{2})/);
    if (m) {
      const dd = m[2].padStart(2, '0');
      const mm = m[1].padStart(2, '0');
      return `${dd}/${mm} ${m[3]}h${m[4] === '00' ? '' : m[4]}`;
    }
    return s.length > 18 ? s.slice(0, 18) : s;
  };

  // D-day color: red if D-N ≤ 2, amber if ≤ 4, default
  const ddayBadge = (s?: string | null) => {
    const t = cleanText(s);
    if (!t) return null;
    const num = parseInt(t.replace(/[^\d]/g, '') || '99', 10);
    const cls = num <= 2 ? 'bg-red-100 text-red-700 border-red-200' :
                num <= 4 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                           'bg-slate-100 text-slate-600 border-slate-200';
    return (
      <span className={cn('inline-flex px-1.5 py-0 text-[11px] font-bold rounded border', cls)}>
        {t}
      </span>
    );
  };

  // Loại badge TM/GC
  const loaiBadge = (s?: string | null) => {
    if (!s) return <span className="text-slate-300">–</span>;
    const isGC = s.toUpperCase() === 'GC';
    return (
      <span className={cn(
        'inline-flex px-1.5 py-0 text-[11px] font-bold rounded border',
        isGC ? 'bg-orange-100 text-orange-700 border-orange-200'
             : 'bg-blue-50 text-blue-700 border-blue-200'
      )}>
        {isGC ? 'GC' : 'TM'}
      </span>
    );
  };

  // BD status pill: request (chưa báo) vs Submit (đã báo)
  const bdStatusPill = (s?: string | null) => {
    if (!s) return null;
    const isSubmit = s.toLowerCase().includes('submit');
    return (
      <span className={cn(
        'inline-flex px-1.5 py-0 text-[11px] font-medium rounded border',
        isSubmit ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                 : 'bg-slate-50 text-slate-600 border-slate-200'
      )}>
        {isSubmit ? 'Đã báo' : 'Chờ báo'}
      </span>
    );
  };

  // Image thumbnail — try first item_code via /rfq/image endpoint
  const ImageCell = ({ rfq, code }: { rfq?: string | null; code?: string | null }) => {
    const [errored, setErrored] = useState(false);
    if (!rfq || errored) return <span className="text-slate-300 text-xs">–</span>;
    const params = new URLSearchParams({ bqms_code: code || rfq, rfq_number: rfq });
    const src = withToken(`/api/v1/bqms/rfq/image?${params.toString()}`);
    return (
      <div className="inline-block w-7 h-7 rounded border border-slate-200 bg-slate-50 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="w-full h-full object-contain"
          onError={() => setErrored(true)}
        />
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-mono sticky top-0 z-10">
          <tr className="border-b border-slate-200">
            <th className="px-2 py-2 text-center w-8 sticky left-0 bg-slate-50 z-20">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={selectableIds.length === 0}
                className="w-3.5 h-3.5 accent-brand-600 cursor-pointer disabled:cursor-not-allowed"
                title={allSelected ? 'Bỏ chọn hết' : 'Chọn hết (chỉ row chờ duyệt)'}
              />
            </th>
            <th className="px-2 py-2 text-left whitespace-nowrap sticky left-8 bg-slate-50 z-20 border-r border-slate-100">RFQ</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Ngày</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">D-N</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Loại</th>
            <th className="px-2 py-2 text-left">Subject (Tên hàng)</th>
            <th className="px-2 py-2 text-center w-9">Ảnh</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">BQMS code</th>
            <th className="px-2 py-2 text-left">Maker</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">Items</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">SL</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">ĐVT</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">MOQ</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">CIS</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Part No</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Người PT</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Hạn BG</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Hiện trạng</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Trạng thái</th>
            <th className="px-2 py-2 text-right whitespace-nowrap sticky right-0 bg-slate-50 z-20 border-l border-slate-100">Hành động</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn(
              'border-b border-slate-100 hover:bg-brand-50/30 transition-colors',
              selectedIds.has(r.id) && 'bg-brand-50/40'
            )}>
              {/* Checkbox — sticky left */}
              <td className="px-2 py-1.5 text-center sticky left-0 bg-white z-10 group-hover:bg-brand-50/30">
                {r.status === 'pending_review' ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleOne(r.id)}
                    className="w-3.5 h-3.5 accent-brand-600 cursor-pointer"
                  />
                ) : (
                  <span className="text-slate-200">·</span>
                )}
              </td>
              {/* RFQ — sticky left */}
              <td className="px-2 py-1.5 font-mono font-semibold text-brand-700 whitespace-nowrap sticky left-8 bg-white hover:bg-brand-50/30 z-10 border-r border-slate-100">
                {r.rfq_number || '–'}
                {r.detail_version && parseInt(r.detail_version) > 1 && (
                  <span className="ml-1 inline-flex items-center px-1 py-0 text-[11px] font-bold rounded bg-orange-100 text-orange-700 border border-orange-200">
                    V{r.detail_version}
                  </span>
                )}
              </td>
              {/* Ngày tháng */}
              <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{fmtDate(r.reg_dt)}</td>
              {/* D-N */}
              <td className="px-2 py-1.5 whitespace-nowrap">{ddayBadge(r.dday_html)}</td>
              {/* Loại */}
              <td className="px-2 py-1.5 whitespace-nowrap">{loaiBadge(r.classification)}</td>
              {/* Subject */}
              <td
                className="px-2 py-1.5 max-w-[300px] truncate text-slate-800"
                title={r.req_name || r.description || ''}
              >
                {r.req_name || r.description || '–'}
              </td>
              {/* Ảnh */}
              <td className="px-2 py-1.5 text-center">
                <ImageCell rfq={r.rfq_number} code={r.item_code} />
              </td>
              {/* BQMS code */}
              <td className="px-2 py-1.5 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                {r.item_code || <span className="text-slate-300">–</span>}
              </td>
              {/* Maker */}
              <td
                className="px-2 py-1.5 max-w-[140px] truncate text-slate-600"
                title={r.first_maker || ''}
              >
                {r.first_maker || <span className="text-slate-300">–</span>}
              </td>
              {/* Items count */}
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.items_count !== null && r.items_count !== undefined && r.items_count > 0 ? (
                  <span className="inline-flex items-center px-1.5 py-0 text-[11px] font-bold rounded bg-brand-100 text-brand-700">
                    {r.items_count}
                  </span>
                ) : r.detail_error ? (
                  <span className="text-red-400 text-[11px]" title={r.detail_error}>err</span>
                ) : (
                  <span className="text-slate-300">–</span>
                )}
              </td>
              {/* SL */}
              <td className="px-2 py-1.5 text-right text-slate-700 tabular-nums">
                {r.quantity ?? <span className="text-slate-300">–</span>}
              </td>
              {/* ĐVT */}
              <td className="px-2 py-1.5 text-slate-600">{r.unit || <span className="text-slate-300">–</span>}</td>
              {/* MOQ */}
              <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">
                {r.first_moq || <span className="text-slate-300">–</span>}
              </td>
              {/* CIS */}
              <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">
                {r.first_cis_code || <span className="text-slate-300">–</span>}
              </td>
              {/* Part No */}
              <td
                className="px-2 py-1.5 max-w-[120px] truncate font-mono text-[11px] text-slate-500"
                title={r.first_part_no || ''}
              >
                {r.first_part_no || <span className="text-slate-300">–</span>}
              </td>
              {/* Người PT */}
              <td
                className="px-2 py-1.5 max-w-[120px] truncate text-slate-600 text-[11px]"
                title={r.psincharge_name || ''}
              >
                {(r.psincharge_name || '').split('/')[0] || <span className="text-slate-300">–</span>}
              </td>
              {/* Hạn BG */}
              <td className="px-2 py-1.5 whitespace-nowrap text-slate-600 text-[11px]">{fmtDeadline(r.deadline_dt)}</td>
              {/* Hiện trạng */}
              <td className="px-2 py-1.5 whitespace-nowrap">{bdStatusPill(r.bd_status)}</td>
              {/* Trạng thái nội bộ */}
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className={cn('inline-flex px-1.5 py-0 text-[11px] font-medium rounded border', statusBadge(r.status))}>
                  {statusLabel(r.status)}
                </span>
              </td>
              {/* Action — sticky right */}
              <td className="px-2 py-1.5 text-right whitespace-nowrap sticky right-0 bg-white hover:bg-brand-50/30 z-10 border-l border-slate-100">
                <div className="flex items-center justify-end gap-0.5">
                  <button
                    onClick={() => setPreviewId(r.id)}
                    className="p-1 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
                    title="Xem chi tiết"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setFolderRfq(r.rfq_number || '')}
                    className="p-1 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                    title="Mở folder"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  {r.status === 'pending_review' && (
                    <>
                      <button
                        onClick={() => {
                          if (window.confirm(`Báo giá ${r.rfq_number}? (~30-90s)`)) {
                            quoteMutation.mutate({ id: r.id, downloadFiles: true });
                          }
                        }}
                        disabled={quoteMutation.isPending}
                        className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        title="Báo giá"
                      >
                        {quoteMutation.isPending && quoteMutation.variables?.id === r.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        Báo
                      </button>
                      <button
                        onClick={() => skipMutation.mutate(r.id)}
                        disabled={skipMutation.isPending}
                        className="p-1 text-slate-500 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                        title="Skip"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const notes = window.prompt('Lý do từ chối:') ?? '';
                          decideMutation.mutate({ id: r.id, decision: 'reject', notes });
                        }}
                        disabled={decideMutation.isPending}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        title="Từ chối"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Tải lại file của ${r.rfq_number}?`)) {
                          downloadFilesMutation.mutate(r.id);
                        }
                      }}
                      disabled={downloadFilesMutation.isPending}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                      title="Tải lại file"
                    >
                      {downloadFilesMutation.isPending && downloadFilesMutation.variables === r.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tiny cloud-download icon for the header chip
function CloudDownloadHero() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 13v8" /><path d="m8 17 4 4 4-4" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
    </svg>
  );
}
