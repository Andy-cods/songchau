import { useState } from 'react'
import { Search, Bell } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useNotifications } from '@/hooks/useNotifications'
import NotificationPanel from './NotificationPanel'

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
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const { count } = useNotifications()

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-xl border-b border-stone-200 flex items-center px-8 gap-6">
      {/* Page Title */}
      <h1 className="font-display font-semibold text-lg text-stone-900">{title}</h1>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search Trigger */}
      <button
        className="w-72 h-9 rounded-lg bg-stone-50 border border-stone-200 hover:border-stone-600 hover:bg-stone-100/70 transition-all duration-200 flex items-center gap-3 px-3 group"
        onClick={() => {
          const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true })
          window.dispatchEvent(event)
        }}
      >
        <Search className="h-4 w-4 text-stone-500 group-hover:text-stone-400 transition-colors" strokeWidth={1.5} />
        <span className="flex-1 text-left text-sm text-stone-500 group-hover:text-stone-400 transition-colors">
          Tìm kiếm...
        </span>
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded bg-white border border-stone-200 px-1.5 font-mono text-[10px] text-stone-500">
          ⌘K
        </kbd>
      </button>

      {/* Notifications */}
      <div className="relative">
        <button
          onClick={() => setIsNotifOpen((prev) => !prev)}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-stone-50 text-stone-400 hover:text-stone-700 transition-all duration-200"
        >
          <Bell className="h-5 w-5" strokeWidth={1.5} />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white ring-2 ring-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
        <NotificationPanel isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
      </div>
    </header>
  )
}
