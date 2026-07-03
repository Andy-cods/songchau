'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  PlugZap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  getScraperSettings,
  updateScraperFlag,
  updateScraperFlags,
  updateScraperCredentials,
  testScraperLogin,
  type ScraperFlagKey,
  type ScraperFlags,
  type ScraperSettings,
  type TestLoginResult,
} from '@/services/bqms';

// ─── Scraper definitions ─────────────────────────────────────────

const SCRAPERS: { key: ScraperFlagKey; label: string; hint: string }[] = [
  { key: 'periodic_scrape', label: 'Đồng bộ định kỳ', hint: 'Quét toàn bộ RFQ theo lịch' },
  { key: 'smart_sync', label: 'Đồng bộ thông minh', hint: 'Chỉ quét mã có thay đổi' },
  { key: 'smart_rescan', label: 'Rà soát lại', hint: 'Quét lại các mã nghi ngờ thiếu' },
  { key: 'code_track', label: 'Theo dõi mã', hint: 'Bám theo từng mã được đánh dấu' },
  { key: 'state_tick', label: 'State tick', hint: 'Cập nhật trạng thái máy trạng thái' },
  { key: 'won_sync', label: 'Đồng bộ trúng thầu', hint: 'Kéo dữ liệu PO/đơn trúng thầu' },
];

const FLAG_KEYS = SCRAPERS.map((s) => s.key);

// ─── Helpers ─────────────────────────────────────────────────────

function errMsg(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'detail' in err) {
    return (err as { detail: string }).detail;
  }
  return fallback;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Switch ──────────────────────────────────────────────────────

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-slate-300'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

// ─── Card ────────────────────────────────────────────────────────

export default function ScraperSettingsCard() {
  const qc = useQueryClient();
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [testResult, setTestResult] = useState<TestLoginResult | null>(null);

  const { data, isLoading, isError } = useQuery<ScraperSettings>({
    queryKey: ['bqms', 'scraper-settings'],
    queryFn: getScraperSettings,
    retry: false,
  });

  const flags = data?.flags;
  const creds = data?.credentials;
  const anyOn = flags ? FLAG_KEYS.some((k) => flags[k]) : false;
  const allOn = flags ? FLAG_KEYS.every((k) => flags[k]) : false;

  // Resolved username shown in the input: local draft (if editing) else server value.
  const usernameValue =
    usernameDraft !== null ? usernameDraft : creds?.username ?? '';

  // Optimistically update the cached flags after a flag mutation succeeds.
  function writeFlags(next: ScraperFlags) {
    qc.setQueryData<ScraperSettings>(['bqms', 'scraper-settings'], (prev) =>
      prev ? { ...prev, flags: next } : prev
    );
  }

  const flagMutation = useMutation({
    mutationFn: ({ key, value }: { key: ScraperFlagKey; value: boolean }) =>
      updateScraperFlag(key, value),
    onSuccess: (res, vars) => {
      writeFlags(res.flags);
      const meta = SCRAPERS.find((s) => s.key === vars.key);
      toast.success(
        `${meta?.label ?? vars.key}: ${vars.value ? 'đã bật' : 'đã tắt'}`
      );
    },
    onError: (err) => toast.error(errMsg(err, 'Không cập nhật được công tắc')),
  });

  const bulkMutation = useMutation({
    mutationFn: (value: boolean) =>
      updateScraperFlags(
        Object.fromEntries(FLAG_KEYS.map((k) => [k, value])) as Partial<ScraperFlags>
      ),
    onSuccess: (res, value) => {
      writeFlags(res.flags);
      toast.success(value ? 'Đã bật tất cả scraper' : 'Đã tắt tất cả scraper');
    },
    onError: (err) => toast.error(errMsg(err, 'Không cập nhật được công tắc')),
  });

  const credMutation = useMutation({
    mutationFn: (body: { username?: string; password?: string }) =>
      updateScraperCredentials(body),
    onSuccess: (res) => {
      qc.setQueryData<ScraperSettings>(['bqms', 'scraper-settings'], (prev) =>
        prev
          ? {
              ...prev,
              credentials: {
                ...prev.credentials,
                username: res.username,
                password_set: res.password_set,
                updated_at: res.updated_at,
                source: 'db',
              },
            }
          : prev
      );
      setUsernameDraft(null);
      const changedPassword = passwordDraft.length > 0;
      setPasswordDraft('');
      setTestResult(null);
      toast.success(
        changedPassword
          ? 'Đã lưu thông tin Samsung — hãy Test đăng nhập trước khi bật scraper'
          : 'Đã lưu tên đăng nhập Samsung'
      );
    },
    onError: (err) => toast.error(errMsg(err, 'Không lưu được thông tin đăng nhập')),
  });

  const testMutation = useMutation({
    mutationFn: testScraperLogin,
    onSuccess: (res) => {
      setTestResult(res);
      if (res.ok) toast.success('Đăng nhập Samsung thành công');
      else toast.error(res.message || 'Đăng nhập Samsung thất bại');
    },
    onError: (err) => {
      const message = errMsg(err, 'Test đăng nhập thất bại');
      setTestResult({ ok: false, message });
      toast.error(message);
    },
  });

  function saveCredentials() {
    const body: { username?: string; password?: string } = {};
    if (usernameDraft !== null && usernameDraft.trim() !== (creds?.username ?? '')) {
      body.username = usernameDraft.trim();
    }
    if (passwordDraft.length > 0) {
      body.password = passwordDraft;
    }
    if (Object.keys(body).length === 0) {
      toast.info('Chưa có thay đổi nào để lưu');
      return;
    }
    credMutation.mutate(body);
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2 bg-brand-50 rounded-lg mt-0.5">
          <PlugZap className="h-4 w-4 text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            BQMS / Đồng bộ Samsung
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Điều khiển các scraper kéo dữ liệu từ Samsung BQMS — chỉ quản trị viên
          </p>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 mb-5">
        <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-800 leading-relaxed">
          Bật scraper khi pass cũ sẽ làm Samsung khoá tài khoản — đổi pass + test
          trước khi bật.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 py-6">
          <div className="h-4 w-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <span className="text-sm">Đang tải cài đặt…</span>
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-red-500 py-6">
          <XCircle className="h-4 w-4" />
          <span className="text-sm">Không tải được cài đặt scraper</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Toggles ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Công tắc scraper
                </h4>
              </div>
              {/* Master toggle */}
              <button
                type="button"
                disabled={bulkMutation.isPending || flagMutation.isPending}
                onClick={() => bulkMutation.mutate(!allOn)}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
              >
                {allOn ? 'Tắt tất cả' : 'Bật tất cả'}
              </button>
            </div>

            {/* Paused note */}
            {!anyOn && (
              <p className="text-xs text-slate-400 mb-3">
                Tất cả scraper đang TẮT (tạm dừng). Bật từng cái khi đã sẵn sàng.
              </p>
            )}

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {SCRAPERS.map(({ key, label, hint }) => {
                const checked = flags?.[key] ?? false;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{label}</p>
                      <p className="text-xs text-slate-400 truncate">{hint}</p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'text-[11px] font-medium tabular-nums',
                          checked ? 'text-brand-600' : 'text-slate-400'
                        )}
                      >
                        {checked ? 'BẬT' : 'TẮT'}
                      </span>
                      <Switch
                        label={label}
                        checked={checked}
                        disabled={flagMutation.isPending || bulkMutation.isPending}
                        onChange={(value) => flagMutation.mutate({ key, value })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Credentials ── */}
          <section className="border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tài khoản Samsung
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Tên đăng nhập
                </label>
                <input
                  value={usernameValue}
                  onChange={(e) => setUsernameDraft(e.target.value)}
                  placeholder="Tài khoản Samsung BQMS"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Đổi mật khẩu Samsung
                </label>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                Mật khẩu:
                {creds?.password_set ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" /> đã đặt
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                    <XCircle className="h-3.5 w-3.5" /> chưa đặt
                  </span>
                )}
              </span>
              <span>
                Nguồn:{' '}
                <span className="font-medium text-slate-600">
                  {creds?.source === 'db' ? 'ghi đè (DB)' : 'mặc định (ENV)'}
                </span>
              </span>
              <span>
                Cập nhật:{' '}
                <span className="font-medium text-slate-600">
                  {formatDateTime(creds?.updated_at ?? null)}
                </span>
              </span>
            </div>

            <div className="mt-4">
              <Button
                type="button"
                onClick={saveCredentials}
                loading={credMutation.isPending}
              >
                Lưu thông tin Samsung
              </Button>
            </div>
          </section>

          {/* ── Test login ── */}
          <section className="border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setTestResult(null);
                  testMutation.mutate();
                }}
                loading={testMutation.isPending}
              >
                Test đăng nhập Samsung
              </Button>

              {testMutation.isPending && (
                <span className="text-xs text-slate-400">
                  Đang thử đăng nhập…
                </span>
              )}

              {testResult && !testMutation.isPending && (
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 text-sm font-medium',
                    testResult.ok ? 'text-emerald-600' : 'text-red-600'
                  )}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Test một lần đăng nhập với thông tin hiện tại. Không bật bất kỳ scraper nào.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
