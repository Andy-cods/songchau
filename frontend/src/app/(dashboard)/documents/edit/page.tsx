'use client';

// OnlyOffice editor page — opens an xlsx/docx from /data/onedrive-staging/ in
// the OnlyOffice DocEditor iframe.
//
// Thang 2026-05-21 rewrite: added a visible step-tracker so when the editor
// fails to mount, the user (and we) can see EXACTLY which step stalled.
// Previous version just spun forever on "Đang tải editor..." with no clue.
//
// Steps:
//   1. Đang tải JS của OnlyOffice từ /onlyoffice/web-apps/...
//   2. Đang lấy cấu hình editor từ backend
//   3. Đang khởi tạo OnlyOffice DocEditor
//   4. Editor sẵn sàng (App.Ready event fired)

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ChevronLeft, AlertCircle, Loader2, Save, Check,
  RefreshCw, ExternalLink, BugPlay, CheckCircle2, Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

declare global {
  interface Window {
    DocsAPI?: any;
  }
}

type SaveState = 'idle' | 'editing' | 'saving' | 'saved' | 'error';
type Step =
  | 'load_script'      // Loading /onlyoffice/.../api.js
  | 'fetch_config'     // GET /api/v1/onlyoffice/config
  | 'init_editor'      // new DocsAPI.DocEditor(...)
  | 'ready'            // App.Ready event fired
  | 'error';
type StepState = 'pending' | 'running' | 'done' | 'failed';

const INIT_TIMEOUT_MS = 30_000;

export default function DocumentEditPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const path = searchParams?.get('path') || '';
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [manualSaving, setManualSaving] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [steps, setSteps] = useState<Record<Step, StepState>>({
    load_script: 'pending',
    fetch_config: 'pending',
    init_editor: 'pending',
    ready: 'pending',
    error: 'pending',
  });
  const editorMounted = useRef(false);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-page-load session id → forces fresh OnlyOffice doc_key every time
  // user opens the editor (prevents stale cached editor state on reopen).
  const sessionId = useRef<string>(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const setStep = (step: Step, state: StepState) => {
    setSteps((prev) => ({ ...prev, [step]: state }));
  };
  const logDebug = (msg: string) => {
    const ts = new Date().toISOString().split('T')[1].slice(0, 12);
    setDebugLog((prev) => [...prev, `${ts}  ${msg}`].slice(-50));
    // eslint-disable-next-line no-console
    console.info('[OO]', msg);
  };

  // 1. Fetch editor config from backend
  useEffect(() => {
    if (!path) {
      setError('Thiếu tham số ?path= trong URL');
      setStep('error', 'failed');
      return;
    }
    logDebug(`Path: ${path}`);
    logDebug(`Session: ${sessionId.current}`);
    setStep('fetch_config', 'running');
    let cancelled = false;
    (async () => {
      try {
        const url =
          `/api/v1/onlyoffice/config?path=${encodeURIComponent(path)}`
          + `&session=${encodeURIComponent(sessionId.current)}`;
        logDebug(`GET ${url}`);
        const r = await api.get<{ data: any }>(url);
        if (cancelled) return;
        setConfig(r.data);
        setStep('fetch_config', 'done');
        logDebug(`Config OK: doc_key=${r.data?.document?.key?.slice(0, 12)}…`);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.detail ?? e?.message ?? 'Không tải được editor config';
        setError(`Bước "Lấy cấu hình" thất bại: ${msg}`);
        setStep('fetch_config', 'failed');
        logDebug(`Config FAIL: ${msg}`);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  // 2. Load OnlyOffice DocsAPI script (with timeout)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.DocsAPI) {
      setStep('load_script', 'done');
      logDebug('DocsAPI already in window — skip script load');
      return;
    }
    setStep('load_script', 'running');
    logDebug('Loading /onlyoffice/web-apps/apps/api/documents/api.js …');

    const scriptTimer = setTimeout(() => {
      if (!window.DocsAPI) {
        setError('Không tải được OnlyOffice JS sau 15 giây. nginx proxy /onlyoffice/ có vấn đề?');
        setStep('load_script', 'failed');
        logDebug('Script load TIMEOUT 15s');
      }
    }, 15_000);

    const s = document.createElement('script');
    s.src = '/onlyoffice/web-apps/apps/api/documents/api.js';
    s.async = true;
    s.onload = () => {
      clearTimeout(scriptTimer);
      setStep('load_script', 'done');
      logDebug('DocsAPI script loaded');
    };
    s.onerror = () => {
      clearTimeout(scriptTimer);
      setError('Không tải được file JS của OnlyOffice — kiểm tra nginx proxy /onlyoffice/');
      setStep('load_script', 'failed');
      logDebug('Script load FAILED (network error)');
    };
    document.head.appendChild(s);
    return () => { clearTimeout(scriptTimer); };
  }, []);

  // 3. Mount the editor once both config and script are ready
  useEffect(() => {
    if (!config || steps.load_script !== 'done' || editorMounted.current) return;
    if (typeof window === 'undefined' || !window.DocsAPI) return;
    setStep('init_editor', 'running');
    logDebug('Mounting DocEditor…');

    // Init timeout: if editor doesn't fire onAppReady within 30s → declare failed
    initTimerRef.current = setTimeout(() => {
      if (steps.ready !== 'done') {
        setError(
          'Editor khởi tạo > 30 giây mà chưa sẵn sàng. '
          + 'Có thể: (a) trình duyệt chặn iframe (extension AdBlock?), '
          + '(b) WebSocket /onlyoffice/ bị nginx chặn, '
          + '(c) sc-onlyoffice container không khoẻ.',
        );
        setStep('init_editor', 'failed');
        logDebug('App.Ready TIMEOUT 30s');
      }
    }, INIT_TIMEOUT_MS);

    try {
      editorMounted.current = true;
      const fullConfig = {
        ...config,
        width: '100%',
        height: '100%',
        events: {
          onAppReady: () => {
            if (initTimerRef.current) clearTimeout(initTimerRef.current);
            setStep('init_editor', 'done');
            setStep('ready', 'done');
            logDebug('App.Ready fired ✓');
          },
          onDocumentReady: () => {
            logDebug('Document.Ready fired');
          },
          onError: (e: any) => {
            const code = e?.data?.errorCode;
            const desc = e?.data?.errorDescription;
            const hint = code === -4
              ? 'OnlyOffice không tải được file. Kiểm tra container sc-onlyoffice có thấy được sc-api không.'
              : code === -3
                ? 'Convert thất bại. File có thể đã hỏng — thử mở file gốc trước.'
                : code === -20 || code === -8
                  ? 'Phiên editor hết hạn. Bấm "Mở lại" để reset.'
                  : code === -6
                    ? 'File hỏng. Mở thử file trong Excel để kiểm tra.'
                    : '';
            const msg = `Lỗi editor (code=${code ?? '?'}): ${desc || JSON.stringify(e)}`
              + (hint ? `\n\n${hint}` : '');
            setError(msg);
            setStep('error', 'failed');
            setSaveState('error');
            logDebug(`onError: code=${code} desc=${desc}`);
          },
          onDocumentStateChange: (e: any) => {
            if (e?.data === true) setSaveState('editing');
            else if (e?.data === false) {
              setSaveState('saved');
              setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 3000);
            }
          },
          onWarning: (e: any) => {
            logDebug(`onWarning: ${JSON.stringify(e?.data ?? e)}`);
          },
          onOutdatedVersion: () => {
            logDebug('onOutdatedVersion — auto-reload');
            window.location.reload();
          },
        },
      };
      // eslint-disable-next-line new-cap
      new window.DocsAPI.DocEditor('onlyoffice-placeholder', fullConfig);
      logDebug('DocEditor constructor returned (waiting for App.Ready)');
    } catch (e: any) {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      const msg = e?.message ?? 'Unknown';
      setError(`Bước "Khởi tạo editor" thất bại: ${msg}`);
      setStep('init_editor', 'failed');
      editorMounted.current = false;
      logDebug(`Constructor THREW: ${msg}`);
    }
    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
    };
  }, [config, steps.load_script]); // eslint-disable-line react-hooks/exhaustive-deps

  const filename = path.split('/').pop() || 'document';

  const handleManualSave = async () => {
    if (manualSaving || !path) return;
    setManualSaving(true);
    setSaveState('saving');
    try {
      const r = await api.post<{ data: { error: number }; key: string }>(
        `/api/v1/onlyoffice/force-save?path=${encodeURIComponent(path)}`,
      );
      const err = r?.data?.error;
      if (err === 0 || err === 4) {
        toast.success(err === 4 ? 'Không có thay đổi để lưu' : '✓ Đã lưu');
        setSaveState('saved');
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 3000);
      } else {
        toast.warning(`OnlyOffice trả về error=${err}. File có thể chưa lưu.`);
        setSaveState('error');
      }
    } catch (e: any) {
      const msg = e?.detail ?? e?.message ?? 'Lỗi không xác định';
      toast.error(`Lưu thủ công thất bại: ${msg}`);
      setSaveState('error');
    } finally {
      setManualSaving(false);
    }
  };

  const forceReload = () => {
    // Hard reload with cache-bust
    window.location.href = window.location.pathname
      + window.location.search
      + (window.location.search.includes('?') ? '&' : '?')
      + `_t=${Date.now()}`;
  };

  function SaveIndicator() {
    if (saveState === 'editing') {
      return (
        <span className="inline-flex items-center gap-1 text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Có thay đổi chưa lưu
        </span>
      );
    }
    if (saveState === 'saving') {
      return (
        <span className="inline-flex items-center gap-1 text-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Đang lưu...
        </span>
      );
    }
    if (saveState === 'saved') {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <Check className="h-3 w-3" />
          Đã lưu
        </span>
      );
    }
    if (saveState === 'error') {
      return (
        <span className="inline-flex items-center gap-1 text-red-600">
          <AlertCircle className="h-3 w-3" />
          Lỗi lưu
        </span>
      );
    }
    return <span className="text-slate-500">Auto-save bật</span>;
  }

  function StepRow({ step, label }: { step: Step; label: string }) {
    const state = steps[step];
    return (
      <div className="flex items-center gap-2 text-xs">
        {state === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
        {state === 'running' && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin flex-shrink-0" />}
        {state === 'failed' && <AlertCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />}
        {state === 'pending' && <Circle className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />}
        <span className={
          state === 'done' ? 'text-emerald-700'
            : state === 'failed' ? 'text-red-700'
              : state === 'running' ? 'text-blue-700 font-medium'
                : 'text-slate-500'
        }>{label}</span>
      </div>
    );
  }

  const allDone = steps.ready === 'done';
  const anyRunning = !allDone && !error;

  return (
    <div className="fixed inset-0 bg-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 text-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
            Quay lại
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate" title={filename}>{filename}</div>
            <div className="text-[11px] text-slate-500 font-mono truncate" title={path}>{path}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs"><SaveIndicator /></div>
          <button
            onClick={() => setDebugOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs"
            title="Bật/tắt debug overlay — show từng bước khởi tạo"
          >
            <BugPlay className="h-3.5 w-3.5" />
            Debug
          </button>
          <button
            onClick={handleManualSave}
            disabled={manualSaving || !!error || !allDone}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm"
            title="Buộc lưu ngay (force-save). PDF tái-render trong nền."
          >
            {manualSaving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            Lưu
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative bg-white">
        {/* Step tracker — shown while loading, dismissed when editor ready */}
        {anyRunning && !error && (
          <div className="absolute top-3 right-3 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 space-y-1.5 min-w-[280px]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Đang khởi tạo editor...
            </div>
            <StepRow step="load_script" label="1. Tải JS của OnlyOffice" />
            <StepRow step="fetch_config" label="2. Lấy cấu hình từ backend" />
            <StepRow step="init_editor" label="3. Khởi tạo DocEditor" />
            <StepRow step="ready" label="4. Editor sẵn sàng" />
          </div>
        )}

        {/* Loading splash when no error yet — show while we wait for at least
            the script load to start. SSR-safe (no window reference). */}
        {anyRunning && !error && steps.load_script !== 'done' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Đang tải editor...
          </div>
        )}

        {/* Error box with actionable buttons */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-2xl bg-white border-2 border-red-300 rounded-xl shadow-xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-red-900">Không mở được editor</div>
                  <div className="text-sm text-red-700 mt-2 whitespace-pre-line">{error}</div>
                  <div className="text-[11px] text-slate-500 mt-3 font-mono break-all">{path}</div>

                  <div className="mt-4 space-y-2 text-xs text-slate-700">
                    <div className="font-semibold text-slate-800">Thử các bước sau:</div>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600">
                      <li>Bấm <strong>Mở lại</strong> (reload + bust cache)</li>
                      <li>Bấm <strong>Tab mới</strong> để mở ở tab mới — đôi khi bypass extension chặn iframe</li>
                      <li>Tắt extension AdBlock/uBlock cho domain này rồi reload</li>
                      <li>Mở DevTools (F12) → Console — gửi screenshot lại nếu vẫn lỗi</li>
                    </ol>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={forceReload}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Mở lại
                    </button>
                    <button
                      onClick={() => {
                        if (typeof window === 'undefined') return;
                        const url = `${window.location.pathname}${window.location.search}${
                          window.location.search.includes('?') ? '&' : '?'
                        }_t=${Date.now()}`;
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Tab mới
                    </button>
                    <button
                      onClick={() => setDebugOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                    >
                      <BugPlay className="h-3.5 w-3.5" />
                      Xem debug log
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Debug overlay — toggleable */}
        {debugOpen && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-[420px] z-20 bg-slate-900 text-slate-100 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-800 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Debug log
              </div>
              <button
                onClick={() => setDebugOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
            <div className="px-3 py-2 max-h-[240px] overflow-y-auto text-[11px] font-mono leading-relaxed">
              {debugLog.length === 0 ? (
                <div className="text-slate-500 italic">No events yet</div>
              ) : (
                debugLog.map((line, i) => (
                  <div key={i} className="text-slate-300 whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div id="onlyoffice-placeholder" className="w-full h-full" />
      </div>
    </div>
  );
}
