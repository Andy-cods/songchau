'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import Link from 'next/link';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  // Log to console in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.error('[GlobalError]', error);
    }
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-lg w-full">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="h-24 w-24 rounded-full bg-red-50 flex items-center justify-center border-2 border-red-100">
            <AlertTriangle className="h-12 w-12 text-red-400" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-display font-bold text-slate-800 mb-2">
          Có lỗi xảy ra
        </h1>

        {/* Description */}
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          Ứng dụng gặp sự cố không mong muốn. Bạn có thể thử tải lại trang
          hoặc quay về trang chủ.
        </p>

        {/* Dev error details */}
        {isDev && (
          <div className="mb-6 text-left bg-red-50 border border-red-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-red-100 border-b border-red-200">
              <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
              <span className="text-xs font-mono font-semibold text-red-700">
                Error details (development only)
              </span>
            </div>
            <div className="p-4">
              <p className="text-xs font-mono text-red-700 font-semibold break-words mb-2">
                {error.name}: {error.message}
              </p>
              {error.digest && (
                <p className="text-xs font-mono text-red-500 break-words mb-2">
                  Digest: {error.digest}
                </p>
              )}
              {error.stack && (
                <pre className="text-[10px] font-mono text-red-600 overflow-x-auto whitespace-pre-wrap break-all leading-5 max-h-48 overflow-y-auto">
                  {error.stack}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm w-full sm:w-auto justify-center"
          >
            <RotateCcw className="h-4 w-4" />
            Thử lại
          </button>

          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded-lg transition-colors w-full sm:w-auto justify-center"
          >
            <Home className="h-4 w-4" />
            Về trang chủ
          </Link>
        </div>

        {/* Status */}
        <p className="mt-8 text-xs text-slate-400">
          Nếu sự cố vẫn tiếp tục, vui lòng liên hệ quản trị viên hệ thống.
        </p>
      </div>
    </div>
  );
}
