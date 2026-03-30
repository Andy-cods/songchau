import Link from 'next/link';
import { Home, FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-md">
        {/* Illustration */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="h-24 w-24 rounded-full bg-indigo-100 flex items-center justify-center">
              <FileQuestion className="h-12 w-12 text-indigo-400" />
            </div>
            <div className="absolute -top-1 -right-1 h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-500">
              ?
            </div>
          </div>
        </div>

        {/* 404 */}
        <p className="text-7xl font-display font-black text-indigo-600 mb-2 tracking-tight">
          404
        </p>

        {/* Title */}
        <h1 className="text-xl font-semibold text-slate-800 mb-2">
          Trang không tồn tại
        </h1>

        {/* Description */}
        <p className="text-sm text-slate-500 mb-8 leading-relaxed">
          Trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển.
          Vui lòng kiểm tra lại đường dẫn hoặc quay về trang chủ.
        </p>

        {/* CTA */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          <Home className="h-4 w-4" />
          Về trang chủ
        </Link>

        {/* Secondary link */}
        <p className="mt-6 text-xs text-slate-400">
          Hoặc{' '}
          <Link
            href="/dashboard"
            className="text-indigo-500 hover:text-indigo-600 underline underline-offset-2"
          >
            xem tổng quan hệ thống
          </Link>
        </p>
      </div>
    </div>
  );
}
