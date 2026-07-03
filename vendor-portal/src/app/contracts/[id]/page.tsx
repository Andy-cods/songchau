'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate, formatMoneyNum } from '@/lib/format';
import type { ContractDetail, ContractItem } from '@/lib/types';
import { StatusChip } from '@/components/ui/StatusChip';
import { FieldGrid, type Field } from '@/components/ui/FieldGrid';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Deadline } from '@/components/ui/Deadline';

// Static Song Châu (Bên A) legal details so the contract document reads balanced
// against Bên B. Display-only copy — official identity taken verbatim from the
// real "Mẫu báo giá" + seeded companies row (MST 2500574479), matching the PDF
// letterhead rendered server-side in backend/app/services/procurement_docs.py.
const SONG_CHAU_PARTY = {
  name: 'CÔNG TY TNHH MỘT THÀNH VIÊN SONG CHÂU',
  taxCode: '2500574479',
  address: 'TDP 4 Đạm Nội, P. Tiền Châu, TP. Phúc Yên, Vĩnh Phúc',
  phone: '0984716995',
};

function num(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString('vi-VN');
}

export default function ContractDetailPage() {
  const params = useParams();
  const contractId = Number(params.id);

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // PDF
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  // Fallback blob URL surfaced as an <a download> when window.open is popup-blocked.
  const [pdfFallbackUrl, setPdfFallbackUrl] = useState('');

  // E-sign
  const [signatureName, setSignatureName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  const load = async () => {
    try {
      const res = await api.get<{ data: ContractDetail }>(`/api/vendor/contracts/${contractId}`);
      setContract(res.data);
    } catch (err: any) {
      setError(err?.detail ?? 'Không tải được hợp đồng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!contractId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const handleViewPdf = async () => {
    setPdfLoading(true);
    setPdfError('');
    try {
      const blob = await api.blob(`/api/vendor/contracts/${contractId}/pdf`);
      const url = URL.createObjectURL(blob);
      // window.open is popup-blocker-prone; always surface a download fallback from the same blob.
      setPdfFallbackUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Release the object URL after a delay so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      setPdfError(err?.detail ?? 'Không mở được file PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSign = async () => {
    if (!signatureName.trim()) {
      setSignError('Vui lòng nhập họ tên người ký');
      return;
    }
    if (!agree) {
      setSignError('Vui lòng xác nhận đồng ý với điều khoản hợp đồng');
      return;
    }
    setSigning(true);
    setSignError('');
    try {
      await api.post(`/api/vendor/contracts/${contractId}/sign`, {
        signature_name: signatureName.trim(),
        agree: true,
      });
      // Reload to reflect the signed state from the server (signed_at, status, signer).
      await load();
    } catch (err: any) {
      setSignError(err?.detail ?? 'Ký hợp đồng thất bại');
    } finally {
      setSigning(false);
    }
  };

  if (loading)
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-5">
        {/* Layout-mirroring skeleton: back link + header card + meta grid + table block */}
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-slate-100" />
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
              <div className="h-5 w-56 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-72 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        </div>
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-9 border-b border-slate-200 bg-slate-50" />
          <div className="divide-y divide-slate-100">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 px-3 py-2.5">
                <div className="h-3 w-6 animate-pulse rounded bg-slate-100" />
                <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-12 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );

  if (error || !contract) {
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm text-rose-700"
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p>{error || 'Không tìm thấy hợp đồng'}</p>
          </div>
          <Link href="/contracts" className="font-medium text-brand-600 hover:underline">
            ← Về danh sách hợp đồng
          </Link>
        </div>
      </main>
    );
  }

  const c = contract;
  const hasPdf = !!c.contract_file_path;
  const canSign = c.status === 'sent';
  const isSigned = ['signed', 'active', 'completed'].includes(c.status);

  // Contract meta — dense label/value grid. null values auto-render "—".
  const metaFields: Field[] = [
    {
      label: 'Số HĐ',
      value: <span className="text-brand-600">{c.contract_no}</span>,
      mono: true,
    },
    { label: 'Đợt', value: c.batch_code, mono: true },
    {
      label: 'Tổng tiền',
      value: formatMoneyNum(c.total_amount, c.currency),
      mono: true,
      tone: 'brand',
    },
    { label: 'Tiền tệ', value: c.currency },
    { label: 'ĐK thanh toán', value: c.payment_terms, colSpan: 2 },
    { label: 'ĐK giao hàng', value: c.delivery_terms, colSpan: 2 },
    { label: 'ĐK bảo hành', value: c.warranty_terms, colSpan: 2 },
    { label: 'Ngày HĐ', value: c.contract_date ? formatDate(c.contract_date) : null, mono: true },
    { label: 'Hiệu lực', value: c.effective_date ? formatDate(c.effective_date) : null, mono: true },
    {
      label: 'Hết hạn',
      value: c.expiry_date ? <Deadline date={c.expiry_date} /> : null,
    },
    {
      label: 'Ký lúc',
      value: c.signed_at ? formatDate(c.signed_at) : null,
      mono: true,
      tone: isSigned ? 'emerald' : undefined,
    },
  ];

  const itemColumns: Column<ContractItem>[] = [
    { key: 'item_no', header: 'STT', w: 56, align: 'right', className: 'text-slate-400', format: 'num' },
    {
      key: 'specification',
      header: 'Mã / Quy cách',
      render: item => (
        <div className="min-w-0">
          <p className="text-[11px] text-slate-700">{item.specification}</p>
          {item.bqms_code && (
            <p className="font-mono text-[10px] text-slate-400">{item.bqms_code}</p>
          )}
          {item.notes && <p className="text-[10px] text-slate-400">{item.notes}</p>}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'SL',
      w: 72,
      align: 'right',
      render: item => <span className="font-mono tabular-nums">{num(item.quantity)}</span>,
    },
    {
      key: 'unit',
      header: 'ĐVT',
      w: 64,
      render: item => <span className="text-slate-500">{item.unit || 'EA'}</span>,
    },
    {
      key: 'unit_price',
      header: `Đơn giá (${c.currency ?? ''})`.trim(),
      w: 130,
      align: 'right',
      render: item => <span className="font-mono tabular-nums">{num(item.unit_price)}</span>,
    },
    {
      key: 'total_price',
      header: 'Thành tiền',
      w: 140,
      align: 'right',
      render: item => (
        <span className="font-mono tabular-nums text-slate-800">{num(item.total_price)}</span>
      ),
    },
    {
      key: 'lead_time_days',
      header: 'Lead (ngày)',
      w: 96,
      align: 'right',
      render: item => (
        <span className="font-mono tabular-nums">
          {item.lead_time_days == null ? '—' : item.lead_time_days}
        </span>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      {/* Back link */}
      <Link
        href="/contracts"
        className="mb-4 inline-block text-sm text-slate-400 transition-colors hover:text-brand-600"
      >
        ← Danh sách hợp đồng
      </Link>

      {/* Header card */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 shadow-sm">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm text-brand-600">{c.contract_no}</span>
                <StatusChip kind="contract" status={c.status} withDot />
              </div>
              <h1 className="text-xl font-bold text-slate-800">Hợp đồng cung cấp</h1>
              <p className="mt-1 text-xs text-slate-500">
                {c.batch_code && <>Đợt {c.batch_code} · </>}
                {c.items.length} mục
                {c.sent_to_vendor_at && <> · Gửi ngày {formatDate(c.sent_to_vendor_at)}</>}
              </p>
            </div>
          </div>
          {hasPdf ? (
            <button
              onClick={handleViewPdf}
              disabled={pdfLoading}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {pdfLoading ? 'Đang mở...' : 'Xem PDF'}
            </button>
          ) : (
            <span className="shrink-0 self-center text-xs text-slate-400">PDF chưa sẵn sàng</span>
          )}
        </div>
        {pdfError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p>{pdfError}</p>
              {pdfFallbackUrl && (
                <a
                  href={pdfFallbackUrl}
                  download
                  className="mt-1 inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"
                >
                  Tải xuống PDF
                </a>
              )}
            </div>
          </div>
        )}
        {/* Always surface a download fallback after a successful open (popup-blocker safety). */}
        {!pdfError && pdfFallbackUrl && (
          <p className="mt-3 text-xs text-slate-500">
            Không thấy tab PDF mở ra?{' '}
            <a href={pdfFallbackUrl} download className="font-semibold text-brand-600 hover:underline">
              Tải xuống PDF
            </a>
          </p>
        )}
      </div>

      {/* Signed banner */}
      {isSigned && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="text-sm font-medium text-emerald-700">Hợp đồng đã được ký điện tử.</p>
            <p className="mt-0.5 text-xs text-emerald-600/80">
              {c.signed_by_vendor && <>Người ký: {c.signed_by_vendor}. </>}
              {c.signed_at && <>Ký ngày {formatDate(c.signed_at)}.</>}
            </p>
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {c.status === 'cancelled' && (
        <div className="mb-5 rounded-2xl bg-rose-50 p-4 ring-1 ring-inset ring-rose-200">
          <p className="text-sm font-medium text-rose-700">Hợp đồng này đã bị hủy.</p>
        </div>
      )}

      {/* Contract meta (FieldGrid) */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Thông tin hợp đồng
        </h3>
        <FieldGrid fields={metaFields} />
      </div>

      {/* Parties */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Bên A — Bên mua
          </p>
          <p className="text-sm font-semibold text-slate-800">{SONG_CHAU_PARTY.name}</p>
          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
            <p>MST: {SONG_CHAU_PARTY.taxCode}</p>
            <p>{SONG_CHAU_PARTY.address}</p>
            <p>ĐT: {SONG_CHAU_PARTY.phone}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Bên B — Nhà cung cấp
          </p>
          <p className="text-sm font-semibold text-slate-800">{c.vendor_name || '—'}</p>
          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
            {c.vendor_tax_code && <p>MST: {c.vendor_tax_code}</p>}
            {c.vendor_address && <p>{c.vendor_address}</p>}
            {c.vendor_phone && <p>ĐT: {c.vendor_phone}</p>}
            {c.vendor_email && <p>Email: {c.vendor_email}</p>}
          </div>
        </div>
      </div>

      {/* Items (dense DataTable) */}
      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Danh mục hàng hóa ({c.items.length})
          </h3>
          <p className="text-xs text-slate-500">
            Tổng cộng:{' '}
            <span className="font-mono font-bold tabular-nums text-brand-700">
              {formatMoneyNum(c.total_amount, c.currency)}
            </span>
          </p>
        </div>
        <DataTable<ContractItem>
          columns={itemColumns}
          rows={c.items}
          emptyLabel="Hợp đồng chưa có mục hàng nào"
          stickyHeader={false}
        />
      </div>

      {/* E-sign block (only when status = sent) — highest-stakes screen, visually primary */}
      {canSign && (
        <div className="rounded-2xl bg-brand-50/40 p-6 ring-1 ring-brand-200">
          <h3 className="mb-1 text-base font-bold text-slate-800">Ký hợp đồng điện tử</h3>
          <p className="mb-4 text-sm text-slate-500">
            Vui lòng xem kỹ nội dung hợp đồng (nhấn &quot;Xem PDF&quot;) trước khi ký. Sau khi ký, hợp đồng có
            giá trị pháp lý và không thể chỉnh sửa.
          </p>

          {/* Trust signals: signing identity + binding reaffirmation + timestamp note */}
          <div className="mb-4 rounded-lg border border-brand-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-700">
              Bạn đang ký với tư cách:{' '}
              <span className="font-semibold text-slate-900">{c.vendor_name || '—'}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Chữ ký điện tử này có giá trị ràng buộc pháp lý. Thời điểm ký sẽ được hệ thống ghi nhận tự động.
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="signature-name" className="mb-1 block text-xs text-slate-500">
              Họ và tên người ký *
            </label>
            <input
              id="signature-name"
              type="text"
              value={signatureName}
              onChange={e => setSignatureName(e.target.value)}
              placeholder="Nguyễn Văn A"
              aria-required="true"
              aria-invalid={!!signError}
              aria-describedby={signError ? 'sign-error' : undefined}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:max-w-md"
            />
          </div>

          <label className="mb-4 flex cursor-pointer select-none items-start gap-2">
            <input
              type="checkbox"
              checked={agree}
              onChange={e => setAgree(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600"
            />
            <span className="text-sm text-slate-700">Tôi đồng ý với điều khoản hợp đồng</span>
          </label>

          {signError && (
            <div
              id="sign-error"
              role="alert"
              aria-live="polite"
              className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p>{signError}</p>
            </div>
          )}

          <button
            onClick={handleSign}
            disabled={signing || !signatureName.trim() || !agree}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signing ? 'Đang ký...' : 'Ký hợp đồng'}
          </button>
        </div>
      )}
    </main>
  );
}
