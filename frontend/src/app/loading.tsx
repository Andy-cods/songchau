export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-4">
        {/* Logo with shimmer */}
        <div className="relative">
          <div className="h-14 w-14 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-display font-bold text-xl">SC</span>
          </div>
          {/* Shimmer overlay */}
          <div className="absolute inset-0 rounded-xl overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>
        </div>

        {/* Text */}
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <span className="text-sm text-slate-500 font-medium">Đang tải...</span>
        </div>
      </div>
    </div>
  );
}
