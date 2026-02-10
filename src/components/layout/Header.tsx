import { Search, Bell } from 'lucide-react'
import { useLocation } from 'react-router-dom'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/product-lookup': 'Tra cứu nhanh',
  '/products': 'Sản phẩm',
  '/customers': 'Khách hàng',
  '/suppliers': 'Nhà cung cấp',
  '/quotations': 'Báo giá',
  '/orders': 'Đơn hàng',
  '/pipeline': 'Pipeline',
  '/settings': 'Cài đặt',
}

export default function Header() {
  const location = useLocation()
  const title = pageTitles[location.pathname] || 'Dashboard'

  return (
    <header className="sticky top-0 z-30 h-16 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50 flex items-center px-8 gap-6">
      {/* Page Title */}
      <h1 className="font-display font-semibold text-lg text-white">{title}</h1>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search Trigger */}
      <button
        className="w-72 h-9 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/70 transition-all duration-200 flex items-center gap-3 px-3 group"
        onClick={() => {
          const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true })
          window.dispatchEvent(event)
        }}
      >
        <Search className="h-4 w-4 text-slate-500 group-hover:text-slate-400 transition-colors" strokeWidth={1.5} />
        <span className="flex-1 text-left text-sm text-slate-500 group-hover:text-slate-400 transition-colors">
          Tìm kiếm...
        </span>
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded bg-slate-900 border border-slate-700 px-1.5 font-mono text-[10px] text-slate-500">
          ⌘K
        </kbd>
      </button>

      {/* Notifications */}
      <button className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-slate-200 transition-all duration-200">
        <Bell className="h-5 w-5" strokeWidth={1.5} />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white ring-2 ring-slate-900">
          3
        </span>
      </button>
    </header>
  )
}
